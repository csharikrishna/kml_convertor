"""
End-to-end conversion pipeline shared by the CLI and the web application.

    input file ──► [DWG? ODA File Converter] ──► DXF load (ezdxf, recovery fallback)
               ──► parse (block expansion, style resolution, tessellation)
               ──► geometry reconstruction (polygons, line merging, hatches)
               ──► frame/border filter
               ──► CRS transform (validated) + KML export ──► optional KMZ packaging
"""

from __future__ import annotations

import gc
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.dwg import convert_dwg_to_dxf, is_dwg_file
from dxf2kml.exporter import ExportStats, KMLExporter
from dxf2kml.filters import BoundaryFilter
from dxf2kml.geometry import GeometryEngine, GeometryStats
from dxf2kml.parser import DXFParser, DXFParseResult
from dxf2kml.transformer import CoordinateTransformer


@dataclass
class ConversionResult:
    output_path: Path
    output_format: str
    parse_result: DXFParseResult
    geometry_stats: GeometryStats
    export_stats: ExportStats
    ignored_frames: int
    warnings: List[str] = field(default_factory=list)
    timings: Dict[str, float] = field(default_factory=dict)
    preview: Optional[Dict[str, Any]] = None
    preview_truncated: bool = False

    def summary(self) -> Dict[str, Any]:
        """Flat, JSON-serialisable summary for logs and API responses."""
        pr = self.parse_result
        return {
            "source_format": pr.source_format,
            "total_entities": pr.total_entities_processed,
            "total_vertices": pr.total_vertices,
            "polygons": self.export_stats.polygons_exported,
            "polylines": self.export_stats.polylines_exported,
            "points": self.export_stats.points_exported,
            "labels": self.export_stats.labels_exported,
            "ignored_frames": self.ignored_frames,
            "merged_segments": self.geometry_stats.merged_lines_count,
            "duplicate_segments_removed": self.geometry_stats.duplicate_segments_removed,
            "unsupported_entities": dict(pr.unsupported_counts),
            "skipped_entities": dict(pr.skipped),
            "drawing_units": pr.drawing_units,
        }


def _drawing_bounds(parse_result: DXFParseResult):
    """(min_x, min_y, max_x, max_y) over all parsed coordinates, or None if empty."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    def extend(coords) -> None:
        nonlocal min_x, min_y, max_x, max_y
        for c in coords:
            x, y = c[0], c[1]
            if x < min_x:
                min_x = x
            if x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            if y > max_y:
                max_y = y

    for p in parse_result.paths:
        extend(p.vertices)
    for h in parse_result.hatches:
        for ring in h.paths:
            extend(ring)
    extend(pt.position for pt in parse_result.points)
    extend(lbl.position for lbl in parse_result.labels)
    if min_x == float("inf"):
        return None
    return (min_x, min_y, max_x, max_y)


def _collect_warnings(parse_result: DXFParseResult, geom_stats: GeometryStats) -> List[str]:
    warnings: List[str] = []
    if parse_result.unsupported_counts:
        listing = ", ".join(f"{k} x{v}" for k, v in sorted(parse_result.unsupported_counts.items()))
        warnings.append(f"Unsupported entities were not converted: {listing}.")
    serious = {k: v for k, v in parse_result.skipped.items()
               if k not in ("invisible entity", "invisible attribute", "HATCH export disabled")}
    if serious:
        listing = ", ".join(f"{k} x{v}" for k, v in sorted(serious.items()))
        warnings.append(f"Some entities were skipped: {listing}.")
    if geom_stats.invalid_hatches:
        warnings.append(f"{geom_stats.invalid_hatches} HATCH entities had no valid boundary and were skipped.")
    return warnings


def convert(
    input_path: Path,
    output_path: Path,
    config: ConverterConfig,
    *,
    output_format: Optional[str] = None,
    collect_preview: bool = False,
    preview_max_vertices: int = 250_000,
) -> ConversionResult:
    """
    Convert a DXF or DWG drawing to KML/KMZ.

    ``output_format`` is 'kml' or 'kmz'; if omitted it is derived from ``output_path``.
    Raises ``dxf2kml.errors.ConversionError`` subclasses for expected failures.
    """
    t0 = time.monotonic()
    deadline = (t0 + config.timeout_seconds) if config.timeout_seconds else None
    timings: Dict[str, float] = {}
    fmt = (output_format or output_path.suffix.lstrip(".") or "kml").lower()
    if fmt not in ("kml", "kmz"):
        raise ValueError(f"Unsupported output format '{fmt}' (expected kml or kmz)")

    # Validate the CRS before doing any expensive work.
    transformer = CoordinateTransformer(source_crs=config.input_epsg, target_crs=config.output_epsg)

    with tempfile.TemporaryDirectory(prefix="dxf2kml_job_") as work:
        work_dir = Path(work)
        parser = DXFParser(config, deadline=deadline)

        t = time.monotonic()
        source_format = "DXF"
        dxf_path = input_path
        if is_dwg_file(input_path):
            source_format = "DWG"
            dxf_path = convert_dwg_to_dxf(input_path, work_dir / "dwg")
            timings["dwg_to_dxf"] = time.monotonic() - t
            t = time.monotonic()

        doc = parser.load_document(dxf_path)
        timings["load"] = time.monotonic() - t

        t = time.monotonic()
        parse_result = parser.parse_document(doc)
        parse_result.source_format = source_format
        del doc  # release the ezdxf document (reference cycles -> collect) before geometry work
        gc.collect()
        timings["parse"] = time.monotonic() - t

        t = time.monotonic()
        geometries, geom_stats = GeometryEngine(config, deadline=deadline).process(
            parse_result.paths, parse_result.hatches
        )
        filtered, ignored = BoundaryFilter(config).filter_geometries(geometries)
        timings["geometry"] = time.monotonic() - t

        warnings = _collect_warnings(parse_result, geom_stats)
        bounds = _drawing_bounds(parse_result)
        if bounds is None:
            warnings.append("The drawing's model space contains no convertible geometry.")
        else:
            warnings.extend(transformer.check_extent(bounds))

        t = time.monotonic()
        exporter = KMLExporter(
            config, transformer, collect_preview=collect_preview,
            preview_max_vertices=preview_max_vertices, deadline=deadline,
            document_name=input_path.stem,
        )
        exporter.export_geometries(filtered)
        exporter.export_points(parse_result.points)
        exporter.export_labels(parse_result.labels)
        exporter.save(output_path, fmt)  # CRS transform + streaming KML/KMZ write
        timings["transform_write"] = time.monotonic() - t

    timings["total"] = time.monotonic() - t0
    for w in warnings:
        logger.warning(w)

    return ConversionResult(
        output_path=output_path,
        output_format=fmt,
        parse_result=parse_result,
        geometry_stats=geom_stats,
        export_stats=exporter.stats,
        ignored_frames=ignored,
        warnings=warnings,
        timings={k: round(v, 3) for k, v in timings.items()},
        preview=exporter.preview_geojson() if collect_preview else None,
        preview_truncated=exporter.preview_truncated,
    )
