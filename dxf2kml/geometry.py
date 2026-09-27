"""
Geometry reconstruction engine.

* Closed paths become Polygons (when valid).
* Open paths sharing layer *and* style are joined: endpoints within ``merge_distance``
  are snapped together, closed faces are detected with GEOS ``polygonize_full`` and the
  remaining edges are joined through degree-2 nodes with ``linemerge``. Every input edge
  ends up either on a polygon boundary or in an output LineString - never both, never
  neither - and a line's color is never changed by merging.
* HATCH boundary rings are nested by containment depth and assembled into polygons
  with holes/islands according to the hatch style.

All GEOS operations used here are O(n log n); no graph library is needed.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.validation import make_valid
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.errors import LimitExceededError
from dxf2kml.parser import ParsedHatch, ParsedPath

Coord = Tuple[float, float]
StyleKey = Tuple[str, Optional[int], Optional[Tuple[int, int, int]], Optional[float]]


@dataclass
class ReconstructedGeometry:
    """Output primitive containing processed Shapely geometries ready for CRS transform."""
    layer: str
    geometry_type: str  # "Polygon" or "LineString"
    geom: Union[LineString, Polygon]
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None
    lineweight: Optional[float] = None  # millimetres
    filled: bool = False  # True for HATCH areas
    source: str = ""  # originating entity type(s), informational


@dataclass
class GeometryStats:
    """Statistics for geometry reconstruction."""
    input_paths_count: int = 0
    merged_lines_count: int = 0  # input segments absorbed into longer lines
    detected_polygons_count: int = 0
    output_linestrings_count: int = 0
    duplicate_segments_removed: int = 0
    collapsed_segments: int = 0  # shorter than merge_distance
    invalid_hatches: int = 0


def _polygon_parts(geom: BaseGeometry) -> List[Polygon]:
    """Return the non-empty polygonal parts of any geometry."""
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    parts: List[Polygon] = []
    for sub in getattr(geom, "geoms", []):
        parts.extend(_polygon_parts(sub))
    return parts


def _flat_coords(vertex_lists: List[List[Coord]]) -> Tuple[np.ndarray, np.ndarray]:
    """Flatten ragged vertex lists into (coords, indices) for vectorized shapely constructors."""
    counts = np.fromiter((len(v) for v in vertex_lists), dtype=np.int64, count=len(vertex_lists))
    coords = np.fromiter((c for v in vertex_lists for xy in v for c in xy), dtype=float,
                         count=int(counts.sum()) * 2).reshape(-1, 2)
    return coords, np.repeat(np.arange(len(vertex_lists)), counts)


class _EndpointSnapper:
    """
    Greedy distance-based clustering of endpoints using a hash grid.

    Each new point is attached to the first existing representative within ``tol``
    (searching the 3x3 neighbouring cells), otherwise it becomes a new representative.
    O(n) expected time; deterministic for a given input order.
    """

    def __init__(self, tol: float):
        self.tol = tol
        self.tol2 = tol * tol
        self.cells: Dict[Tuple[int, int], List[Coord]] = {}

    def snap(self, pt: Coord) -> Coord:
        if self.tol <= 0:
            return pt
        cx, cy = math.floor(pt[0] / self.tol), math.floor(pt[1] / self.tol)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for rep in self.cells.get((cx + dx, cy + dy), ()):
                    if (rep[0] - pt[0]) ** 2 + (rep[1] - pt[1]) ** 2 <= self.tol2:
                        return rep
        self.cells.setdefault((cx, cy), []).append(pt)
        return pt


class GeometryEngine:
    """Geometry processing & topology reconstruction engine."""

    def __init__(self, config: ConverterConfig, deadline: Optional[float] = None):
        self.config = config
        self.deadline = deadline

    def _check_deadline(self) -> None:
        if self.deadline is not None and time.monotonic() > self.deadline:
            raise LimitExceededError("Conversion took too long and was aborted (time limit exceeded).")

    # ------------------------------------------------------------------ hatches

    def _hatch_polygons(self, hatch: ParsedHatch) -> List[Polygon]:
        """
        Assemble hatch rings into polygons.

        Ring nesting depth = number of other rings that contain it.
        * normal (0): even depths are filled, odd depths are holes (islands alternate)
        * outer  (1): only depth 0 is filled, depth-1 rings are holes
        * ignore (2): only depth-0 rings are filled, inner rings are ignored
        """
        rings: List[Polygon] = []
        seen = set()
        for ring in hatch.paths:
            key = tuple(ring)
            if key in seen:
                continue
            seen.add(key)
            for part in _polygon_parts(make_valid(Polygon(ring))):
                if part.area > 0:
                    rings.append(Polygon(part.exterior))
        if not rings:
            return []

        tree = STRtree(rings)
        depth = [0] * len(rings)
        for i, ring in enumerate(rings):
            depth[i] = sum(1 for j in tree.query(ring, predicate="within") if j != i)

        style = hatch.hatch_style if hatch.hatch_style in (0, 1, 2) else 0
        output: List[Polygon] = []
        for i, ring in enumerate(rings):
            d = depth[i]
            if d % 2 == 1 or (style in (1, 2) and d > 0):
                continue
            shape: BaseGeometry = ring
            if style != 2:
                holes = [rings[j] for j in tree.query(ring, predicate="contains")
                         if j != i and depth[j] == d + 1]
                for hole in holes:
                    shape = shape.difference(hole)
            output.extend(p for p in _polygon_parts(shape) if p.area > 0)
        return output

    # ------------------------------------------------------------------ main entry

    def process(
        self,
        paths: List[ParsedPath],
        hatches: List[ParsedHatch]
    ) -> Tuple[List[ReconstructedGeometry], GeometryStats]:
        """Convert parsed paths and hatches into polygons and (optionally merged) lines."""
        stats = GeometryStats(input_paths_count=len(paths))
        results: List[ReconstructedGeometry] = []

        for hatch in hatches:
            try:
                polys = self._hatch_polygons(hatch)
            except Exception as e:  # GEOS topology errors on pathological input
                logger.warning(f"Error building HATCH polygon on layer '{hatch.layer}': {e}")
                polys = []
            if not polys:
                stats.invalid_hatches += 1
                continue
            for poly in polys:
                results.append(ReconstructedGeometry(
                    layer=hatch.layer, geometry_type="Polygon", geom=poly,
                    color_aci=hatch.color_aci, rgb_color=hatch.rgb_color,
                    filled=self.config.fill_hatches, source="HATCH",
                ))
                stats.detected_polygons_count += 1

        # Group by layer AND style so merging never changes a line's appearance.
        groups: Dict[StyleKey, List[ParsedPath]] = {}
        for p in paths:
            key = (p.layer, p.color_aci, p.rgb_color, p.lineweight)
            groups.setdefault(key, []).append(p)

        for (layer, aci, rgb, lw), group in groups.items():
            self._check_deadline()

            def emit(geom, gtype: str, source: str, layer=layer, aci=aci, rgb=rgb, lw=lw) -> None:
                results.append(ReconstructedGeometry(
                    layer=layer, geometry_type=gtype, geom=geom,
                    color_aci=aci, rgb_color=rgb, lineweight=lw, source=source,
                ))
                if gtype == "Polygon":
                    stats.detected_polygons_count += 1
                else:
                    stats.output_linestrings_count += 1

            open_paths: List[ParsedPath] = []
            closed_paths: List[ParsedPath] = []
            for p in group:
                # A ring needs >= 3 distinct vertices; anything less stays a line.
                if p.closed and len(p.vertices) >= 3 and len(set(p.vertices)) >= 3:
                    closed_paths.append(p)
                else:
                    open_paths.append(p)

            if closed_paths:
                coords, index = _flat_coords([p.vertices for p in closed_paths])
                polys = shapely.polygons(shapely.linearrings(coords, indices=index))
                ok = shapely.is_valid(polys) & (shapely.area(polys) > 0)
                for p, poly, valid in zip(closed_paths, polys, ok):
                    if valid:
                        emit(poly, "Polygon", p.entity_type)
                    else:
                        # Self-intersecting ring: keep it visible as a closed line.
                        ring = list(p.vertices)
                        if ring[0] != ring[-1]:
                            ring.append(ring[0])
                        emit(LineString(ring), "LineString", p.entity_type)

            if not open_paths:
                continue

            if not self.config.merge_lines:
                for p in open_paths:
                    emit(LineString(p.vertices), "LineString", p.entity_type)
                continue

            try:
                self._merge_group(open_paths, emit, stats)
            except LimitExceededError:
                raise
            except Exception as e:
                logger.warning(f"Line merging failed for layer '{layer}'; exporting segments unmerged: {e}")
                for p in open_paths:
                    emit(LineString(p.vertices), "LineString", p.entity_type)

        logger.info(
            f"Geometry Engine finished: {stats.detected_polygons_count} polygons, "
            f"{stats.output_linestrings_count} linestrings ({stats.merged_lines_count} segments merged, "
            f"{stats.duplicate_segments_removed} duplicates removed)."
        )
        return results, stats

    def _merge_group(self, open_paths: List[ParsedPath], emit, stats: GeometryStats) -> None:
        snapper = _EndpointSnapper(self.config.merge_distance)
        kept: List[List[Coord]] = []
        seen = set()
        sources = set()
        for p in open_paths:
            verts = list(p.vertices)
            verts[0] = snapper.snap(verts[0])
            verts[-1] = snapper.snap(verts[-1])
            if len(verts) == 2 and verts[0] == verts[1]:
                stats.collapsed_segments += 1
                continue
            key = tuple(verts)
            if key in seen or tuple(reversed(verts)) in seen:
                stats.duplicate_segments_removed += 1
                continue
            seen.add(key)
            sources.add(p.entity_type)
            kept.append(verts)

        if not kept:
            return
        self._check_deadline()
        source = "+".join(sorted(sources))

        # Faces bounded by the (snapped) segments; every edge not used by a face comes
        # back as a cut edge, dangle or invalid ring - nothing is lost or duplicated.
        coords, index = _flat_coords(kept)
        lines = shapely.linestrings(coords, indices=index)
        polygons, cuts, dangles, invalid_rings = shapely.polygonize_full(lines)
        faces = shapely.get_parts(polygons)
        if len(faces):
            ok = shapely.is_valid(faces) & (shapely.area(faces) > 0)
            for poly in faces[ok]:
                emit(poly, "Polygon", source)

        leftovers = np.concatenate([shapely.get_parts(c) for c in (cuts, dangles, invalid_rings)])
        leftovers = leftovers[shapely.get_type_id(leftovers) == 1]  # LineStrings only
        if len(leftovers) == 0:
            return
        merged = shapely.get_parts(shapely.line_merge(shapely.multilinestrings(leftovers)))
        out_lines = merged if len(merged) else leftovers
        stats.merged_lines_count += max(0, len(leftovers) - len(out_lines))
        for ls in out_lines:
            emit(ls, "LineString", source)
