"""
DXF Parser module using ezdxf.

Reads AutoCAD modelspace, recursively expands block references (INSERT / MINSERT)
and explodable entities (DIMENSION, LEADER, MLINE, ...), resolves BYLAYER / BYBLOCK
properties with AutoCAD inheritance semantics, converts curves into WCS vertices and
extracts everything into plain geometric primitives.

Design notes
------------
* All geometry is produced in WCS. 2D entities (LWPOLYLINE, ARC, CIRCLE, TEXT, HATCH...)
  store coordinates in their OCS; mirrored blocks give them an extrusion of (0, 0, -1).
  Curves therefore go through ``ezdxf.path`` (which applies the OCS) unless a cheap
  fast path is provably equivalent.
* Nothing is dropped silently: every skipped or unsupported entity is counted in
  ``DXFParseResult.skipped`` / ``unsupported_counts`` and surfaced to callers.
* Resource limits (entity count, vertex count, block depth, deadline) bound the work
  a single hostile drawing can cause.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Set, Tuple

import ezdxf
import ezdxf.colors
import ezdxf.path
import ezdxf.recover
from ezdxf.entities import Ellipse
from ezdxf.entities.boundary_paths import PolylinePath
from ezdxf.math import NonUniformScalingError
from ezdxf.math import BoundingBox, Matrix44, Vec3, bulge_to_arc
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.errors import InputFileError, LimitExceededError
from dxf2kml.labels import LabelData, parse_mtext_entity, parse_text_entity

RGB = Tuple[int, int, int]

# DXF $INSUNITS value mapping
DXF_UNITS_MAP = {
    0: "Unitless",
    1: "Inches",
    2: "Feet",
    3: "Miles",
    4: "Millimeters",
    5: "Centimeters",
    6: "Meters",
    7: "Kilometers",
    8: "Microinches",
    9: "Mils",
    10: "Yards",
    11: "Angstroms",
    12: "Nanometers",
    13: "Microns",
    14: "Decimeters",
    15: "Decameters",
    16: "Hectometers",
}


@dataclass
class ParsedPoint:
    """Parsed AutoCAD POINT entity."""
    position: Tuple[float, float, float]
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[RGB] = None


@dataclass
class ParsedPath:
    """Parsed linear/curve path entity (LINE, (LW)POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE, SOLID...)."""
    vertices: List[Tuple[float, float]]
    closed: bool
    entity_type: str
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[RGB] = None
    lineweight: Optional[float] = None  # millimetres; None = default width


@dataclass
class ParsedHatch:
    """Parsed AutoCAD HATCH entity boundary paths (rings in WCS, nesting not yet resolved)."""
    paths: List[List[Tuple[float, float]]]
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[RGB] = None
    hatch_style: int = 0  # 0 = normal (odd parity), 1 = outer, 2 = ignore
    solid_fill: bool = False


@dataclass
class DXFParseResult:
    """Container for all parsed DXF drawing elements."""
    paths: List[ParsedPath] = field(default_factory=list)
    points: List[ParsedPoint] = field(default_factory=list)
    labels: List[LabelData] = field(default_factory=list)
    hatches: List[ParsedHatch] = field(default_factory=list)
    layers: Set[str] = field(default_factory=set)
    unsupported_counts: Dict[str, int] = field(default_factory=dict)
    skipped: Dict[str, int] = field(default_factory=dict)  # reason -> count
    total_entities_processed: int = 0
    total_vertices: int = 0
    # Drawing metadata
    drawing_units: str = "Unitless"
    drawing_units_code: int = 0
    source_format: str = "DXF"

    def skip(self, reason: str, count: int = 1) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + count


# Entity types turned into geometry by this parser
SUPPORTED_ENTITIES = {
    "LINE", "LWPOLYLINE", "POLYLINE", "POINT", "TEXT", "MTEXT", "ATTRIB",
    "INSERT", "HATCH", "MPOLYGON", "ARC", "CIRCLE", "ELLIPSE", "SPLINE",
    "SOLID", "TRACE", "3DFACE",
}
# Entities that are rendered by exploding them into simpler virtual entities.
# Their sub-entities inherit BYBLOCK properties from the parent, like block content.
EXPLODABLE_ENTITIES = {
    "DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION", "LEADER",
    "MULTILEADER", "MLEADER", "MLINE",
}
# Everything else (3DSOLID, REGION, MESH, IMAGE, XLINE, RAY, ACAD_TABLE, ...) has no
# meaningful 2D map representation and is counted in `unsupported_counts`.

_DEADLINE_CHECK_INTERVAL = 512


@dataclass(frozen=True)
class _BlockContext:
    """Effective properties of the enclosing block reference (for BYBLOCK / layer 0)."""
    layer: str
    aci: Optional[int]
    rgb: Optional[RGB]
    lineweight: Optional[float]
    depth: int
    chain: Tuple[str, ...]


class DXFParser:
    """Safe, robust AutoCAD DXF parser with AutoCAD-accurate property inheritance."""

    def __init__(self, config: ConverterConfig, deadline: Optional[float] = None):
        self.config = config
        self.deadline = deadline  # time.monotonic() value, or None
        self._layer_props: Dict[str, Tuple[Optional[int], Optional[RGB], Optional[float]]] = {}
        self._entity_count = 0

    # ------------------------------------------------------------------ loading

    def load_document(self, dxf_filepath: Path):
        """Load a DXF document, falling back to ezdxf's recovery reader for damaged files."""
        if not dxf_filepath.exists():
            raise FileNotFoundError(f"DXF file not found: {dxf_filepath}")
        if dxf_filepath.stat().st_size == 0:
            raise InputFileError("The uploaded file is empty.")

        try:
            return ezdxf.readfile(str(dxf_filepath))
        except Exception as first_error:  # structure errors, encoding problems, ...
            logger.info(f"Standard DXF read failed ({type(first_error).__name__}: {first_error}); trying recovery mode")
        try:
            doc, auditor = ezdxf.recover.readfile(str(dxf_filepath))
        except Exception as ex:
            logger.warning(f"DXF recovery failed for '{dxf_filepath.name}': {type(ex).__name__}: {ex}")
            raise InputFileError(
                f"Unable to parse '{dxf_filepath.name}'. Please ensure it is a valid ASCII or binary DXF file."
            ) from ex
        if auditor.has_errors:
            logger.warning(f"Recovered DXF with {len(auditor.errors)} unrecoverable issue(s)")
        else:
            logger.info(f"Recovered DXF file ({len(auditor.fixes)} issue(s) fixed)")
        return doc

    def parse(self, dxf_filepath: Path) -> DXFParseResult:
        """Read and process a DXF (or DWG, via ODA File Converter) file."""
        from dxf2kml.dwg import is_dwg_file, convert_dwg_to_dxf

        if not dxf_filepath.exists():
            raise FileNotFoundError(f"DXF file not found: {dxf_filepath}")
        if is_dwg_file(dxf_filepath):
            import tempfile
            with tempfile.TemporaryDirectory(prefix="dxf2kml_dwg_") as tmp:
                dxf_path = convert_dwg_to_dxf(dxf_filepath, Path(tmp))
                logger.info(f"Loading DXF converted from DWG: {dxf_filepath.name}")
                result = self.parse_document(self.load_document(dxf_path))
                result.source_format = "DWG"
                return result
        logger.info(f"Loading DXF file: {dxf_filepath.name}")
        return self.parse_document(self.load_document(dxf_filepath))

    def parse_document(self, doc) -> DXFParseResult:
        """Extract primitives from an already loaded ezdxf document."""
        result = DXFParseResult()
        self._entity_count = 0

        try:
            units_code = int(doc.header.get("$INSUNITS", 0))
        except (TypeError, ValueError):
            units_code = 0
        result.drawing_units_code = units_code
        result.drawing_units = DXF_UNITS_MAP.get(units_code, "Unknown")
        logger.info(f"DXF drawing units header: {result.drawing_units} (code={units_code})")

        self._build_layer_table(doc)
        for layer in doc.layers:
            result.layers.add(layer.dxf.name)

        for entity, ctx in self._iter_primitives(doc.modelspace(), None, result):
            self._entity_count += 1
            result.total_entities_processed += 1
            if self._entity_count > self.config.max_entities:
                raise LimitExceededError(
                    f"Drawing contains more than {self.config.max_entities:,} entities "
                    f"(after block expansion), which exceeds this server's limit."
                )
            if self._entity_count % _DEADLINE_CHECK_INTERVAL == 0:
                self._check_deadline()

            dxftype = entity.dxftype()
            if dxftype not in SUPPORTED_ENTITIES:
                result.unsupported_counts[dxftype] = result.unsupported_counts.get(dxftype, 0) + 1
                continue
            try:
                self._process_entity(entity, ctx, result)
            except LimitExceededError:
                raise
            except Exception as e:
                result.skip(f"malformed {dxftype}")
                logger.warning(
                    f"Skipping malformed {dxftype} entity (handle={entity.dxf.get('handle')}): "
                    f"{type(e).__name__}: {e}"
                )

        if result.unsupported_counts:
            logger.warning(f"Unsupported entities skipped: {result.unsupported_counts}")
        if result.skipped:
            logger.warning(f"Entities skipped: {result.skipped}")
        logger.info(
            f"Parsed: {len(result.paths)} paths, {len(result.points)} points, "
            f"{len(result.labels)} labels, {len(result.hatches)} hatches, "
            f"{result.total_vertices} vertices. Layers found: {len(result.layers)}"
        )
        return result

    # ------------------------------------------------------------------ limits

    def _check_deadline(self) -> None:
        if self.deadline is not None and time.monotonic() > self.deadline:
            raise LimitExceededError("Conversion took too long and was aborted (time limit exceeded).")

    def _account_vertices(self, result: DXFParseResult, count: int) -> None:
        result.total_vertices += count
        if result.total_vertices > self.config.max_vertices:
            raise LimitExceededError(
                f"Drawing geometry exceeds {self.config.max_vertices:,} vertices, "
                f"which exceeds this server's limit."
            )

    # ------------------------------------------------------------------ properties

    def _build_layer_table(self, doc) -> None:
        """Layer name (case-insensitive) -> (aci, rgb, lineweight_mm)."""
        self._layer_props = {}
        for layer in doc.layers:
            try:
                aci = abs(int(layer.color))  # negative ACI only means "layer off"
                rgb = layer.rgb  # layer true color (group 420), if any
                if rgb is None and 1 <= aci <= 255:
                    rgb = ezdxf.colors.aci2rgb(aci)
                lw = layer.dxf.get("lineweight", -3)
                lw_mm = lw / 100.0 if lw is not None and lw >= 0 else None
                self._layer_props[layer.dxf.name.upper()] = (
                    aci if 1 <= aci <= 255 else None,
                    tuple(rgb) if rgb is not None else None,
                    lw_mm,
                )
            except Exception as ex:
                logger.warning(f"Could not read properties of layer '{layer.dxf.name}': {ex}")

    def _resolve_style(
        self, entity, ctx: Optional[_BlockContext]
    ) -> Tuple[str, Optional[int], Optional[RGB], Optional[float]]:
        """
        Resolve (layer, aci, rgb, lineweight_mm) with AutoCAD semantics:

        * Entities on layer "0" inside a block take the layer of the block reference.
        * BYBLOCK (color 0 / lineweight -2) takes the block reference's effective value.
        * BYLAYER (color 256 / lineweight -1) takes the value of the effective layer.
        * A true color (group 420) overrides the ACI value.
        """
        dxf = entity.dxf
        layer = str(dxf.get("layer", "0") or "0")
        if ctx is not None and layer == "0":
            layer = ctx.layer
        layer_aci, layer_rgb, layer_lw = self._layer_props.get(layer.upper(), (7, (255, 255, 255), None))

        aci = dxf.get("color", 256)
        true_color = dxf.get("true_color", None)
        if true_color is not None and aci != 0:
            rgb: Optional[RGB] = ezdxf.colors.int2rgb(true_color)
            out_aci: Optional[int] = None
        elif aci == 0:  # BYBLOCK
            if ctx is not None:
                out_aci, rgb = ctx.aci, ctx.rgb
            else:  # BYBLOCK outside a block renders as white/black (ACI 7)
                out_aci, rgb = 7, ezdxf.colors.aci2rgb(7)
        elif aci is not None and 1 <= aci <= 255:
            out_aci, rgb = aci, ezdxf.colors.aci2rgb(aci)
        else:  # BYLAYER (256), BYOBJECT (257) or invalid
            out_aci, rgb = layer_aci, layer_rgb

        lw = dxf.get("lineweight", -1)
        if lw is not None and lw >= 0:
            lw_mm: Optional[float] = lw / 100.0
        elif lw == -2:  # BYBLOCK
            lw_mm = ctx.lineweight if ctx is not None else None
        elif lw == -1:  # BYLAYER
            lw_mm = layer_lw
        else:  # DEFAULT (-3) or invalid
            lw_mm = None

        return layer, out_aci, (tuple(rgb) if rgb is not None else None), lw_mm

    # ------------------------------------------------------------------ traversal
    #
    # Block references are expanded by composing transformation matrices
    # (entity -> nested block -> ... -> WCS) and transforming *leaf* entities only.
    # ezdxf's Insert.virtual_entities() instead re-expresses nested INSERTs as new
    # INSERT entities, which is wrong for non-uniform scaling combined with rotation
    # (the result would need shear, which an INSERT cannot represent).

    def _child_context(self, entity, ctx: Optional[_BlockContext], name: str) -> _BlockContext:
        layer, aci, rgb, lw = self._resolve_style(entity, ctx)
        depth = (ctx.depth if ctx else 0) + 1
        chain = (ctx.chain if ctx else ()) + (name,)
        return _BlockContext(layer=layer, aci=aci, rgb=rgb, lineweight=lw, depth=depth, chain=chain)

    def _iter_primitives(
        self,
        entities: Iterable,
        ctx: Optional[_BlockContext],
        result: DXFParseResult,
        matrix: Optional[Matrix44] = None,
    ) -> Iterator[Tuple[object, Optional[_BlockContext]]]:
        """Yield (WCS entity, block_context) for every primitive, expanding blocks recursively."""
        for entity in entities:
            dxftype = entity.dxftype()
            if entity.dxf.get("invisible", 0):
                result.skip("invisible entity")
                continue
            if dxftype == "INSERT":
                yield from self._expand_insert(entity, ctx, result, matrix)
            elif dxftype in EXPLODABLE_ENTITIES:
                yield from self._expand_virtual(entity, ctx, result, matrix)
            elif dxftype == "ATTDEF" and ctx is not None:
                continue  # attribute templates; the values live in the INSERT's ATTRIBs
            elif dxftype == "POLYLINE" and (entity.is_poly_face_mesh or entity.is_polygon_mesh):
                key = "POLYLINE (3D mesh)"
                result.unsupported_counts[key] = result.unsupported_counts.get(key, 0) + 1
            elif matrix is None:
                yield entity, ctx
            else:
                for transformed in self._transformed_copies(entity, matrix, result):
                    yield transformed, ctx

    def _transformed_copies(self, entity, matrix: Matrix44, result: DXFParseResult) -> Iterator[object]:
        """Copy a block entity and transform it into WCS (mirrors ezdxf's explode fallbacks)."""
        try:
            copy = entity.copy()
        except Exception:  # CopyNotSupported and friends
            if hasattr(entity, "virtual_entities"):
                for sub in entity.virtual_entities():
                    yield from self._transformed_copies(sub, matrix, result)
            else:
                result.skip(f"block entity not copyable ({entity.dxftype()})")
            return
        yield from self._transform_entity(copy, matrix, result)

    def _transform_entity(self, entity, matrix: Matrix44, result: DXFParseResult) -> Iterator[object]:
        dxftype = entity.dxftype()
        try:
            entity.transform(matrix)
        except NonUniformScalingError:
            if dxftype in ("ARC", "CIRCLE"):
                if abs(entity.dxf.radius) > 1e-12:
                    yield Ellipse.from_arc(entity).transform(matrix)
            elif dxftype in ("LWPOLYLINE", "POLYLINE"):  # bulges become ARCs -> ELLIPSEs
                for sub in entity.virtual_entities():
                    yield from self._transform_entity(sub, matrix, result)
            else:
                result.skip(f"non-uniform scaling unsupported for {dxftype}")
        except NotImplementedError:
            result.skip(f"block entity not transformable ({dxftype})")
        else:
            yield entity

    def _expand_insert(
        self, insert, ctx: Optional[_BlockContext], result: DXFParseResult, parent: Optional[Matrix44]
    ) -> Iterator[Tuple[object, Optional[_BlockContext]]]:
        name = insert.dxf.get("name", "?")
        depth = ctx.depth if ctx else 0
        if depth >= self.config.max_block_depth:
            result.skip(f"block nesting deeper than {self.config.max_block_depth}")
            return
        if ctx is not None and name in ctx.chain:
            result.skip("recursive block reference")
            logger.warning(f"Recursive block reference detected: {' -> '.join(ctx.chain + (name,))}")
            return
        block = insert.block()
        if block is None:
            result.skip("INSERT of undefined block")
            logger.warning(f"INSERT (handle={insert.dxf.get('handle')}) references undefined block '{name}'")
            return

        child_ctx = self._child_context(insert, ctx, name)
        try:
            references = list(insert.multi_insert()) if insert.mcount > 1 else [insert]
        except Exception as ex:
            result.skip("malformed INSERT")
            logger.warning(f"Could not expand MINSERT '{name}': {ex}")
            return

        for ref in references:
            try:
                local = ref.matrix44()  # block coords (base point, scale, rotation, OCS) -> parent coords
            except Exception as ex:
                result.skip("malformed INSERT")
                logger.warning(f"Invalid transformation for block '{name}': {ex}")
                continue
            matrix = local if parent is None else local @ parent

            # ATTRIBs belong to the INSERT and live in the *parent* coordinate space.
            for attrib in getattr(ref, "attribs", ()):
                if attrib.is_invisible:
                    result.skip("invisible attribute")
                    continue
                if parent is None:
                    yield attrib, child_ctx
                else:
                    for transformed in self._transformed_copies(attrib, parent, result):
                        yield transformed, child_ctx

            try:
                yield from self._iter_primitives(block, child_ctx, result, matrix)
            except LimitExceededError:
                raise
            except Exception as ex:
                result.skip("malformed INSERT")
                logger.warning(
                    f"Could not expand block '{name}' (handle={insert.dxf.get('handle')}): "
                    f"{type(ex).__name__}: {ex}"
                )

    def _expand_virtual(
        self, entity, ctx: Optional[_BlockContext], result: DXFParseResult, matrix: Optional[Matrix44]
    ) -> Iterator[Tuple[object, Optional[_BlockContext]]]:
        """Explode DIMENSION/LEADER/MLINE/... (in their own coordinate space), then transform the parts."""
        dxftype = entity.dxftype()
        depth = ctx.depth if ctx else 0
        if depth >= self.config.max_block_depth:
            result.skip(f"block nesting deeper than {self.config.max_block_depth}")
            return
        try:
            children = list(entity.virtual_entities())
        except Exception as ex:
            result.skip(f"malformed {dxftype}")
            logger.warning(
                f"Could not explode {dxftype} (handle={entity.dxf.get('handle')}): {type(ex).__name__}: {ex}"
            )
            return
        child_ctx = self._child_context(entity, ctx, f"<{dxftype}>")
        yield from self._iter_primitives(children, child_ctx, result, matrix)

    # ------------------------------------------------------------------ curve tessellation

    def _arc_segment_count(self, radius: float, sweep: float) -> int:
        """
        Segments needed so the chord-to-arc distance (sagitta) stays within
        ``flattening_distance``; at least ``tessellation_segments`` per full circle and
        never more than ``max_vertices_per_curve`` per full circle (pathological radii).
        """
        radius = abs(radius)
        sweep = abs(sweep)
        if radius <= 0 or sweep <= 0:
            return 1
        d = self.config.flattening_distance
        step = 2.0 * math.acos(1.0 - d / radius) if d < radius else math.pi
        n = math.ceil(sweep / step)
        n_min = math.ceil(self.config.tessellation_segments * sweep / math.tau)
        n_max = max(1, math.ceil(self.config.max_vertices_per_curve * sweep / math.tau))
        return max(1, min(max(n, n_min), n_max))

    def _arc_points(self, cx: float, cy: float, radius: float, start: float, sweep: float) -> List[Tuple[float, float]]:
        """Exact on-circle points from angle ``start`` over signed ``sweep`` (radians), inclusive."""
        n = self._arc_segment_count(radius, sweep)
        return [(cx + radius * math.cos(start + sweep * k / n), cy + radius * math.sin(start + sweep * k / n))
                for k in range(n + 1)]

    def _bulge_vertices(self, points, closed: bool, ocs, elevation: float) -> List[Tuple[float, float]]:
        """
        Vertices of a 2D polyline with bulges, in WCS.

        bulge = tan(theta / 4): theta is the included angle of the arc from this vertex to
        the next one, positive = counter-clockwise (in OCS). Arc points are generated
        exactly on the circle (no Bezier approximation).
        """
        pts = [(float(p[0]), float(p[1]), float(p[2]) if len(p) > 2 else 0.0) for p in points]
        n = len(pts)
        if n == 0:
            return []
        out: List[Tuple[float, float]] = []
        for i in range(n if closed else n - 1):
            x0, y0, bulge = pts[i]
            x1, y1, _ = pts[(i + 1) % n]
            out.append((x0, y0))
            if bulge and (x0, y0) != (x1, y1):
                center, _, _, radius = bulge_to_arc((x0, y0), (x1, y1), bulge)
                sweep = 4.0 * math.atan(bulge)
                start = math.atan2(y0 - center.y, x0 - center.x)
                out.extend(self._arc_points(center.x, center.y, radius, start, sweep)[1:-1])
        out.append((pts[0][0], pts[0][1]) if closed else (pts[-1][0], pts[-1][1]))
        return self._ocs_to_wcs_2d(out, ocs, elevation)

    @staticmethod
    def _ocs_to_wcs_2d(points: List[Tuple[float, float]], ocs, elevation: float) -> List[Tuple[float, float]]:
        if ocs is None or not ocs.transform:
            return points
        return [(float(v.x), float(v.y)) for v in ocs.points_to_wcs(Vec3(x, y, elevation) for x, y in points)]

    def _flatten_distance(self, control_points) -> float:
        """
        Adaptive flattening tolerance for generic curves (ellipses, splines, hatch edges).

        A curve of size S flattened with sagitta tolerance d needs roughly
        pi * sqrt(S / (4 d)) segments. Raising d to S * pi^2 / (4 N^2) caps a single
        curve at ~N vertices while leaving normal-sized curves at the configured
        tolerance (e.g. a 1 km curve still uses <1 mm tolerance).
        """
        d = self.config.flattening_distance
        bbox = BoundingBox(control_points)
        if bbox.has_data:
            size = bbox.size
            diag = math.hypot(size.x, size.y)
            n = self.config.max_vertices_per_curve
            d = max(d, diag * (math.pi ** 2) / (4.0 * n * n))
        return d

    def _flatten_path(self, path) -> List[Tuple[float, float]]:
        if len(path) == 0:
            return []
        distance = self._flatten_distance(path.control_vertices())
        segments = max(1, self.config.tessellation_segments // 4)  # per Bezier quarter-circle
        return [(float(v.x), float(v.y)) for v in path.flattening(distance, segments=segments)]

    def _flatten_spline(self, spline) -> Tuple[List[Tuple[float, float]], bool]:
        """
        Flatten a SPLINE on its *valid* parameter domain [t_p, t_n].

        ezdxf's path conversion evaluates over the full knot vector, which is wrong for
        unclamped (periodic / closed) splines as written by AutoCAD's "Close" option.
        """
        bspline = spline.construction_tool()  # handles control points, fit points, weights
        knots = list(bspline.knots())
        degree = bspline.degree
        n_ctrl = bspline.count
        t_start, t_end = knots[degree], knots[n_ctrl]
        if not (t_end > t_start):
            raise ValueError("degenerate spline parameter domain")

        control = list(bspline.control_points)
        distance = self._flatten_distance(control)
        # Long splines (e.g. contours) legitimately need vertices proportional to their spans.
        spans = max(1, n_ctrl - degree)
        max_points = max(self.config.max_vertices_per_curve, spans * 16)

        # Initial uniform sampling: a few samples per knot span, then adaptive refinement.
        initial = max(8, spans * 4)
        ts = [t_start + (t_end - t_start) * i / initial for i in range(initial + 1)]
        pts = list(bspline.points(ts))

        out_p = [pts[0]]
        budget = max_points - initial

        def refine(t0, p0, t1, p1, level):
            nonlocal budget
            tm = (t0 + t1) / 2.0
            pm = bspline.point(tm)
            chord = p1 - p0
            length = chord.magnitude
            dev = abs((pm - p0).cross(chord).z) / length if length > 0 else (pm - p0).magnitude
            if dev > distance and level < 12 and budget > 0:
                budget -= 1
                refine(t0, p0, tm, pm, level + 1)
                refine(tm, pm, t1, p1, level + 1)
            else:
                out_p.append(p1)

        for i in range(len(ts) - 1):
            refine(ts[i], pts[i], ts[i + 1], pts[i + 1], 0)

        vertices = [(float(v.x), float(v.y)) for v in out_p]
        closed = bool(spline.closed) or out_p[0].isclose(out_p[-1], abs_tol=1e-9)
        return vertices, closed

    def _hatch_rings(self, hatch, result: DXFParseResult) -> List[List[Tuple[float, float]]]:
        """Boundary rings in WCS: polyline loops exactly (bulges), edge loops via ezdxf.path."""
        ocs = hatch.ocs()
        elevation = float(Vec3(hatch.dxf.get("elevation", (0, 0, 0))).z)
        rings: List[List[Tuple[float, float]]] = []
        for boundary in hatch.paths:
            if isinstance(boundary, PolylinePath):
                vertices = self._bulge_vertices(boundary.vertices, True, ocs, elevation)
            else:
                path = ezdxf.path.from_hatch_edge_path(boundary, ocs, elevation)
                vertices = self._flatten_path(path)
            ring = self._clean_vertices(vertices)
            if ring is None:
                result.skip("non-finite coordinates in HATCH boundary")
            elif len(ring) >= 3:
                rings.append(ring)
            else:
                result.skip("degenerate HATCH boundary")
        return rings

    @staticmethod
    def _clean_vertices(vertices: List[Tuple[float, float]]) -> Optional[List[Tuple[float, float]]]:
        """Drop consecutive duplicates; reject non-finite coordinates."""
        out: List[Tuple[float, float]] = []
        for x, y in vertices:
            if not (math.isfinite(x) and math.isfinite(y)):
                return None
            if not out or out[-1] != (x, y):
                out.append((x, y))
        return out

    def _add_path(self, result, vertices, closed, dxftype, layer, aci, rgb, lw) -> None:
        cleaned = self._clean_vertices(vertices)
        if cleaned is None:
            result.skip(f"non-finite coordinates in {dxftype}")
            return
        if len(cleaned) < 2:
            result.skip(f"degenerate {dxftype} (zero length)")
            return
        self._account_vertices(result, len(cleaned))
        result.paths.append(ParsedPath(
            vertices=cleaned, closed=closed, entity_type=dxftype, layer=layer,
            color_aci=aci, rgb_color=rgb, lineweight=lw,
        ))

    # ------------------------------------------------------------------ entity processing

    def _process_entity(self, entity, ctx: Optional[_BlockContext], result: DXFParseResult) -> None:
        """Process a single (WCS) DXF primitive into the DXFParseResult object."""
        dxftype = entity.dxftype()
        layer, aci, rgb, lw = self._resolve_style(entity, ctx)
        result.layers.add(layer)

        if dxftype == "POINT":
            pos = entity.dxf.location  # WCS
            position = (float(pos.x), float(pos.y), float(pos.z))
            if not all(math.isfinite(c) for c in position):
                result.skip("non-finite coordinates in POINT")
                return
            self._account_vertices(result, 1)
            result.points.append(ParsedPoint(position=position, layer=layer, color_aci=aci, rgb_color=rgb))

        elif dxftype in ("TEXT", "ATTRIB", "MTEXT"):
            label = parse_mtext_entity(entity) if dxftype == "MTEXT" else parse_text_entity(entity)
            if label is None:
                result.skip(f"empty or malformed {dxftype}")
                return
            if not all(math.isfinite(c) for c in label.position):
                result.skip(f"non-finite coordinates in {dxftype}")
                return
            label.layer = layer
            label.color_aci = aci
            label.rgb_color = rgb
            self._account_vertices(result, 1)
            result.labels.append(label)

        elif dxftype == "LINE":
            s, e = entity.dxf.start, entity.dxf.end  # WCS
            self._add_path(result, [(float(s.x), float(s.y)), (float(e.x), float(e.y))],
                           False, dxftype, layer, aci, rgb, lw)

        elif dxftype == "LWPOLYLINE":
            closed = bool(entity.closed)
            points = entity.get_points(format="xyb")  # OCS
            elevation = float(entity.dxf.get("elevation", 0.0))
            vertices = self._bulge_vertices(points, closed, entity.ocs(), elevation)
            self._add_path(result, vertices, closed, dxftype, layer, aci, rgb, lw)

        elif dxftype == "POLYLINE":  # meshes are filtered out during traversal
            closed = bool(entity.is_closed)
            # Spline-fit polylines keep their frame control points (flag 16) - not displayed.
            vertex_entities = [v for v in entity.vertices if not (v.dxf.get("flags", 0) & 16)]
            if entity.is_3d_polyline:
                vertices = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in vertex_entities]
                if closed and len(vertices) > 2:
                    vertices.append(vertices[0])
            else:
                points = [(v.dxf.location.x, v.dxf.location.y, v.dxf.get("bulge", 0.0)) for v in vertex_entities]
                elevation = float(Vec3(entity.dxf.get("elevation", (0, 0, 0))).z)
                vertices = self._bulge_vertices(points, closed, entity.ocs(), elevation)
            self._add_path(result, vertices, closed, dxftype, layer, aci, rgb, lw)

        elif dxftype in ("ARC", "CIRCLE"):
            radius = float(entity.dxf.get("radius", 0.0))
            if not radius > 0:
                result.skip(f"degenerate {dxftype} (radius <= 0)")
                return
            c = entity.dxf.center  # OCS
            if dxftype == "CIRCLE":
                start, sweep, closed = 0.0, math.tau, True
            else:
                start = math.radians(entity.dxf.start_angle)
                span = (entity.dxf.end_angle - entity.dxf.start_angle) % 360.0
                sweep, closed = math.radians(span if span > 0 else 360.0), False
            ocs_points = self._arc_points(float(c.x), float(c.y), radius, start, sweep)
            if closed:
                ocs_points[-1] = ocs_points[0]
            vertices = self._ocs_to_wcs_2d(ocs_points, entity.ocs(), float(c.z))
            self._add_path(result, vertices, closed, dxftype, layer, aci, rgb, lw)

        elif dxftype == "ELLIPSE":
            center = Vec3(entity.dxf.center)
            major = Vec3(entity.dxf.major_axis)
            distance = self._flatten_distance([center - major, center + major])
            segments = max(4, self.config.tessellation_segments)
            vertices = [(float(v.x), float(v.y)) for v in entity.flattening(distance, segments=segments)]
            span = abs(entity.dxf.get("end_param", math.tau) - entity.dxf.get("start_param", 0.0))
            closed = math.isclose(span, math.tau, abs_tol=1e-9) or math.isclose(span, 0.0, abs_tol=1e-12)
            if closed and vertices and vertices[0] != vertices[-1]:
                vertices.append(vertices[0])
            self._add_path(result, vertices, closed, dxftype, layer, aci, rgb, lw)

        elif dxftype == "SPLINE":
            vertices, closed = self._flatten_spline(entity)
            self._add_path(result, vertices, closed, dxftype, layer, aci, rgb, lw)

        elif dxftype in ("SOLID", "TRACE", "3DFACE"):
            vertices = self._flatten_path(ezdxf.path.make_path(entity))
            self._add_path(result, vertices, True, dxftype, layer, aci, rgb, lw)

        elif dxftype in ("HATCH", "MPOLYGON"):
            if not self.config.export_hatches:
                result.skip("HATCH export disabled")
                return
            rings = self._hatch_rings(entity, result)
            if not rings:
                result.skip("HATCH without usable boundary")
                return
            self._account_vertices(result, sum(len(r) for r in rings))
            result.hatches.append(ParsedHatch(
                paths=rings, layer=layer, color_aci=aci, rgb_color=rgb,
                hatch_style=int(entity.dxf.get("hatch_style", 0) or 0),
                solid_fill=bool(entity.dxf.get("solid_fill", 0)),
            ))
