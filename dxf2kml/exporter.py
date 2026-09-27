"""
Streaming KML/KMZ exporter.

Features are grouped into one KML Folder per AutoCAD layer and written directly to the
output stream (no in-memory document tree). Measured on a 35k-entity drawing, the
previous simplekml-based exporter accounted for ~80% of peak memory (~500 MB) and more
than half of the runtime, because it built the whole document as objects and then as a
single string before writing.

KML semantics:
- coordinates are WGS84 lon,lat[,alt] with 9 decimals (~0.1 mm)
- geometry is clampToGround with <tessellate> so long segments follow the terrain
- polygon rings are oriented per KML convention (outer counter-clockwise, holes clockwise)
- feature attributes (layer, type, area, length, text...) are written as <ExtendedData>,
  which Google Earth shows as a balloon table and GIS tools import as attribute fields
- all drawing-supplied text is XML-escaped and stripped of XML-illegal control characters
- the file is written to a temporary name and atomically renamed on success
"""

import io
import os
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.errors import LimitExceededError
from dxf2kml.geometry import ReconstructedGeometry
from dxf2kml.labels import LabelData
from dxf2kml.parser import ParsedPoint
from dxf2kml.styles import KMLStyle, StyleManager
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.utils import aci_to_rgb, rgb_to_css_hex, xml_attr, xml_text

_DEADLINE_CHECK_INTERVAL = 256
KML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n'
KML_FOOTER = "</Document>\n</kml>\n"


@dataclass
class ExportStats:
    """Export summary statistics."""
    polygons_exported: int = 0
    polylines_exported: int = 0
    points_exported: int = 0
    labels_exported: int = 0


def _coords_text(coords: Sequence[Tuple[float, float, float]]) -> str:
    return " ".join(
        f"{lon:.9f},{lat:.9f},{z:.3f}" if z else f"{lon:.9f},{lat:.9f}"
        for lon, lat, z in coords
    )


class KMLExporter:
    """Collects processed features and streams them into a KML (or KMZ) document."""

    def __init__(
        self,
        config: ConverterConfig,
        transformer: CoordinateTransformer,
        *,
        collect_preview: bool = False,
        preview_max_vertices: int = 250_000,
        deadline: Optional[float] = None,
        document_name: str = "dxf2kml",
    ):
        self.config = config
        self.transformer = transformer
        self.style_manager = StyleManager(config)
        self.stats = ExportStats()
        self.deadline = deadline
        self.document_name = document_name
        self.unit = transformer.source_unit_label
        self._geometries: List[ReconstructedGeometry] = []
        self._points: List[ParsedPoint] = []
        self._labels: List[LabelData] = []
        self._counter = 0
        # GeoJSON preview (web UI), collected while writing
        self.collect_preview = collect_preview
        self.preview_features: List[Dict[str, Any]] = []
        self.preview_budget = preview_max_vertices
        self.preview_truncated = False

    # ------------------------------------------------------------------ collection

    def export_geometries(self, geometries: List[ReconstructedGeometry]):
        for g in geometries:
            if g.geometry_type == "Polygon" and isinstance(g.geom, Polygon):
                self.stats.polygons_exported += 1
            elif g.geometry_type == "LineString" and isinstance(g.geom, LineString):
                self.stats.polylines_exported += 1
            else:
                continue
            self._geometries.append(g)

    def export_points(self, points: List[ParsedPoint]):
        if self.config.export_points:
            self._points.extend(points)
            self.stats.points_exported += len(points)

    def export_labels(self, labels: List[LabelData]):
        if self.config.export_text:
            self._labels.extend(labels)
            self.stats.labels_exported += len(labels)

    # ------------------------------------------------------------------ helpers

    def _tick(self) -> None:
        self._counter += 1
        if self.deadline is not None and self._counter % _DEADLINE_CHECK_INTERVAL == 0:
            if time.monotonic() > self.deadline:
                raise LimitExceededError("Conversion took too long and was aborted (time limit exceeded).")

    def _format_length(self, length: float) -> str:
        if self.unit == "m":
            return f"{length:.2f} m" if length < 1000 else f"{length / 1000:.3f} km"
        return f"{length:.2f} {self.unit}"

    def _format_area(self, area: float) -> str:
        if self.unit == "m":
            return f"{area:.2f} sq m" if area < 10000 else f"{area / 10000:.4f} hectares"
        return f"{area:.2f} sq {self.unit}"

    def _calculate_label_scale(self, text_height: float) -> float:
        """Text at reference_text_height renders at default_label_scale; clamp to 0.2 - 3.0."""
        if not self.config.auto_scale_text or text_height <= 0:
            return self.config.default_label_scale
        relative = (text_height / self.config.reference_text_height) * self.config.default_label_scale
        return round(max(0.2, min(3.0, relative)), 3)

    @staticmethod
    def _resolved_rgb(aci: Optional[int], rgb: Optional[Tuple[int, int, int]]) -> Optional[Tuple[int, int, int]]:
        if rgb:
            return tuple(rgb)
        if aci is not None and 1 <= aci <= 255:
            return aci_to_rgb(aci)
        return None

    def _default_css(self) -> str:
        c = self.config.default_line_color.lower()
        return "#" + c[6:8] + c[4:6] + c[2:4]

    def _preview_add(self, geometry: Dict[str, Any], properties: Dict[str, Any], vertex_count: int) -> None:
        if not self.collect_preview:
            return
        if vertex_count > self.preview_budget:
            self.preview_truncated = True
            return
        self.preview_budget -= vertex_count
        self.preview_features.append({"type": "Feature", "geometry": geometry, "properties": properties})

    @staticmethod
    def _placemark(name: Optional[str], style: KMLStyle, data: Dict[str, str], geometry: str) -> str:
        parts = ["<Placemark>"]
        if name:
            parts.append(f"<name>{xml_text(name)}</name>")
        parts.append(f"<styleUrl>#{style.id}</styleUrl>")
        if data:
            parts.append("<ExtendedData>")
            parts.extend(f'<Data name="{xml_attr(k)}"><value>{xml_text(v)}</value></Data>' for k, v in data.items())
            parts.append("</ExtendedData>")
        parts.append(geometry)
        parts.append("</Placemark>\n")
        return "".join(parts)

    # ------------------------------------------------------------------ styles

    def _geometry_style(self, g: ReconstructedGeometry) -> KMLStyle:
        color = self.style_manager.get_color_kml(aci_color=g.color_aci, rgb_color=g.rgb_color)
        if g.geometry_type == "LineString":
            return self.style_manager.get_line_style(color, width=g.lineweight)
        if g.filled:  # HATCH area: filled with its own color at fill_opacity
            return self.style_manager.get_polygon_style(color, width=g.lineweight, fill=True,
                                                        fill_color=color, fill_opacity=self.config.fill_opacity)
        return self.style_manager.get_polygon_style(
            color, width=g.lineweight, fill=self.config.fill_polygons,
            fill_color=self.config.fill_color if self.config.fill_polygons else None,
            fill_opacity=self.config.fill_opacity if self.config.fill_polygons else None,
        )

    def _point_style(self, pt: ParsedPoint) -> KMLStyle:
        color = self.style_manager.get_color_kml(aci_color=pt.color_aci, rgb_color=pt.rgb_color)
        return self.style_manager.get_point_style(color)

    def _label_color(self, lbl: LabelData) -> Tuple[str, Optional[Tuple[int, int, int]]]:
        # An inline MTEXT color (\C<n>;) overrides the entity/layer color.
        if lbl.inline_color_aci:
            return self.style_manager.get_color_kml(aci_color=lbl.inline_color_aci), aci_to_rgb(lbl.inline_color_aci)
        return (self.style_manager.get_color_kml(aci_color=lbl.color_aci, rgb_color=lbl.rgb_color),
                self._resolved_rgb(lbl.color_aci, lbl.rgb_color))

    def _label_style(self, lbl: LabelData) -> KMLStyle:
        return self.style_manager.get_label_style(self._label_color(lbl)[0], self._calculate_label_scale(lbl.height))

    # ------------------------------------------------------------------ feature writers

    def _write_geometry(self, out, g: ReconstructedGeometry, style: KMLStyle) -> None:
        rgb = self._resolved_rgb(g.color_aci, g.rgb_color)
        stroke_css = rgb_to_css_hex(rgb, default=self._default_css())

        if g.geometry_type == "Polygon":
            geom = orient(g.geom, sign=1.0)  # exterior CCW, holes CW
            exterior = self.transformer.transform_coords(list(geom.exterior.coords))
            interiors = [self.transformer.transform_coords(list(r.coords)) for r in geom.interiors]
            xml = ["<Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>",
                   f"<outerBoundaryIs><LinearRing><coordinates>{_coords_text(exterior)}</coordinates></LinearRing></outerBoundaryIs>"]
            xml.extend(f"<innerBoundaryIs><LinearRing><coordinates>{_coords_text(r)}</coordinates></LinearRing></innerBoundaryIs>"
                       for r in interiors)
            xml.append("</Polygon>")
            data = {"Layer": g.layer, "Type": "Hatch" if g.filled else "Polygon", "Source": g.source}
            if self.unit:
                data["Area"] = self._format_area(geom.area)
                data["Perimeter"] = self._format_length(geom.length)
            data["Vertices"] = str(len(exterior))
            out.write(self._placemark(None, style, data, "".join(xml)))
            self._preview_add(
                {"type": "Polygon",
                 "coordinates": [[[p[0], p[1]] for p in exterior]] + [[[p[0], p[1]] for p in r] for r in interiors]},
                {"layer": g.layer, "stroke": stroke_css, "stroke-width": 2, "fill": stroke_css,
                 "fill-opacity": (self.config.fill_opacity / 255.0) if g.filled else 0.1, "filled": bool(g.filled)},
                len(exterior) + sum(len(r) for r in interiors),
            )
        else:
            coords = self.transformer.transform_coords(list(g.geom.coords))
            xml = ("<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>"
                   f"<coordinates>{_coords_text(coords)}</coordinates></LineString>")
            data = {"Layer": g.layer, "Type": "LineString", "Source": g.source}
            if self.unit:
                data["Length"] = self._format_length(g.geom.length)
            data["Vertices"] = str(len(coords))
            out.write(self._placemark(None, style, data, xml))
            self._preview_add(
                {"type": "LineString", "coordinates": [[p[0], p[1]] for p in coords]},
                {"layer": g.layer, "stroke": stroke_css, "stroke-width": 3},
                len(coords),
            )

    def _write_point(self, out, pt: ParsedPoint, style: KMLStyle) -> None:
        lon, lat, elev = self.transformer.transform_point(*pt.position)
        xml = f"<Point><altitudeMode>clampToGround</altitudeMode><coordinates>{_coords_text([(lon, lat, elev)])}</coordinates></Point>"
        out.write(self._placemark(None, style, {"Layer": pt.layer, "Type": "Point"}, xml))
        self._preview_add(
            {"type": "Point", "coordinates": [lon, lat]},
            {"layer": pt.layer, "type": "point", "title": f"Point ({pt.layer})",
             "color": rgb_to_css_hex(self._resolved_rgb(pt.color_aci, pt.rgb_color), default="#10b981")},
            1,
        )

    def _write_label(self, out, lbl: LabelData, style: KMLStyle) -> None:
        lon, lat, elev = self.transformer.transform_point(*lbl.position)
        xml = f"<Point><altitudeMode>clampToGround</altitudeMode><coordinates>{_coords_text([(lon, lat, elev)])}</coordinates></Point>"
        data = {"Layer": lbl.layer, "Type": lbl.entity_type, "Text": lbl.text,
                "Height": f"{lbl.height:.2f}", "Scale": f"{style.label_scale:.2f}"}
        if lbl.rotation:
            data["Rotation"] = f"{lbl.rotation:.1f}°"
        if lbl.font_family:
            data["Font"] = lbl.font_family
        out.write(self._placemark(lbl.text, style, data, xml))
        self._preview_add(
            {"type": "Point", "coordinates": [lon, lat]},
            {"layer": lbl.layer, "type": "text", "title": lbl.text, "text_height": lbl.height,
             "rotation": lbl.rotation, "font_family": lbl.font_family,
             "label_color": rgb_to_css_hex(self._label_color(lbl)[1], default="#00ff00")},
            1,
        )

    # ------------------------------------------------------------------ document

    def _write_document(self, out) -> None:
        # Group by layer (first-seen order) so each layer is exactly one Folder,
        # and resolve every style up front so shared styles precede the features.
        layers: Dict[str, List[Tuple[str, Any, KMLStyle]]] = {}

        def add(layer: str, kind: str, obj, style: KMLStyle) -> None:
            layers.setdefault((layer or "").strip() or "Default", []).append((kind, obj, style))

        for g in self._geometries:
            add(g.layer, "geom", g, self._geometry_style(g))
        for pt in self._points:
            add(pt.layer, "point", pt, self._point_style(pt))
        for lbl in self._labels:
            add(lbl.layer, "label", lbl, self._label_style(lbl))

        out.write(KML_HEADER)
        out.write(f"<name>{xml_text(self.document_name)}</name>\n")
        for style in self.style_manager.styles:
            out.write(style.to_kml())
            out.write("\n")
        writers = {"geom": self._write_geometry, "point": self._write_point, "label": self._write_label}
        for layer, features in layers.items():
            out.write(f"<Folder><name>{xml_text(layer)}</name>\n")
            for kind, obj, style in features:
                self._tick()
                writers[kind](out, obj, style)
            out.write("</Folder>\n")
        out.write(KML_FOOTER)

    def save(self, output_path: Path, output_format: Optional[str] = None) -> None:
        """Write KML (or KMZ, by ``output_format`` or the '.kmz' suffix) atomically."""
        output_path = Path(output_path)
        fmt = (output_format or output_path.suffix.lstrip(".") or "kml").lower()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = output_path.with_name(output_path.name + ".part")
        try:
            if fmt == "kmz":
                with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as kmz:
                    with kmz.open("doc.kml", "w") as raw:
                        with io.TextIOWrapper(raw, encoding="utf-8", newline="\n") as out:
                            self._write_document(out)
            else:
                with open(tmp, "w", encoding="utf-8", newline="\n", buffering=1 << 20) as out:
                    self._write_document(out)
            os.replace(tmp, output_path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        logger.info(f"{fmt.upper()} document written: {output_path.name} ({output_path.stat().st_size:,} bytes)")

    def preview_geojson(self) -> Dict[str, Any]:
        return {"type": "FeatureCollection", "features": self.preview_features}
