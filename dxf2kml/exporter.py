"""
KML Exporter module using simplekml.
Generates structured Google Earth KML files with layer folders, styled geometries, points, and labels.

Improvements:
- Dynamic text height scaling from DXF text heights
- Inline MTEXT color override support
- Polygon fill with configurable color and opacity
- KML description balloons with layer, type, and measurement info
- 3D coordinate preservation (Z/elevation)
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import simplekml
from shapely.geometry import Polygon, LineString
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.styles import StyleManager
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.geometry import ReconstructedGeometry
from dxf2kml.parser import ParsedPoint
from dxf2kml.labels import LabelData
from dxf2kml.utils import aci_to_rgb


@dataclass
class ExportStats:
    """Export summary statistics."""
    polygons_exported: int = 0
    polylines_exported: int = 0
    points_exported: int = 0
    labels_exported: int = 0


class KMLExporter:
    """Exports processed GIS features into a structured KML document."""

    def __init__(self, config: ConverterConfig, transformer: CoordinateTransformer):
        self.config = config
        self.transformer = transformer
        self.kml = simplekml.Kml()
        self.style_manager = StyleManager(self.kml, self.config)
        self.layer_folders: Dict[str, simplekml.Folder] = {}
        self.stats = ExportStats()

    def _get_or_create_folder(self, layer_name: str) -> simplekml.Folder:
        """Get or create KML folder for an AutoCAD layer."""
        clean_layer = layer_name.strip() if layer_name else "Default"
        if clean_layer not in self.layer_folders:
            folder = self.kml.newfolder(name=clean_layer)
            self.layer_folders[clean_layer] = folder
        return self.layer_folders[clean_layer]

    def _build_description(
        self,
        layer: str,
        entity_type: str,
        extra_info: Optional[Dict] = None
    ) -> str:
        """Build an HTML description balloon for KML placemarks."""
        parts = [
            '<div style="font-family: Arial, sans-serif; font-size: 12px;">',
            f'<b>Layer:</b> {layer}<br/>',
            f'<b>Type:</b> {entity_type}<br/>',
        ]
        if extra_info:
            for key, value in extra_info.items():
                parts.append(f'<b>{key}:</b> {value}<br/>')
        parts.append('</div>')
        return ''.join(parts)

    def _calculate_label_scale(self, text_height: float) -> float:
        """
        Calculate KML label scale dynamically based on DXF text height.
        
        Uses the reference_text_height as a baseline. Text at reference height
        renders at default_label_scale. Larger text scales up, smaller scales down.
        """
        if not self.config.auto_scale_text or text_height <= 0:
            return self.config.default_label_scale
        
        ref_height = self.config.reference_text_height
        if ref_height <= 0:
            return self.config.default_label_scale
        
        # Calculate relative scale: text_height / reference_height * base_scale
        relative_scale = (text_height / ref_height) * self.config.default_label_scale
        
        # Clamp to reasonable KML range (0.2 to 3.0)
        return max(0.2, min(3.0, relative_scale))

    def export_geometries(self, geometries: List[ReconstructedGeometry]):
        """Export Polygons and LineStrings into their respective layer folders."""
        for g in geometries:
            folder = self._get_or_create_folder(g.layer)
            color_kml = self.style_manager.get_color_kml(
                aci_color=g.color_aci,
                rgb_color=g.rgb_color
            )

            if g.geometry_type == "Polygon" and isinstance(g.geom, Polygon):
                exterior_coords = list(g.geom.exterior.coords)
                tf_exterior = self.transformer.transform_coords(exterior_coords)

                tf_interiors = []
                for interior in g.geom.interiors:
                    tf_interiors.append(self.transformer.transform_coords(list(interior.coords)))

                poly = folder.newpolygon()
                poly.outerboundaryis = tf_exterior
                poly.altitudemode = simplekml.AltitudeMode.clamptoground
                if tf_interiors:
                    poly.innerboundaryis = tf_interiors

                # Apply polygon style with fill settings from config
                poly.style = self.style_manager.get_polygon_style(
                    kml_color=color_kml,
                    width=g.lineweight,
                    fill=self.config.fill_polygons,
                    fill_color=self.config.fill_color if self.config.fill_polygons else None,
                    fill_opacity=self.config.fill_opacity if self.config.fill_polygons else None
                )

                # Add description balloon
                area_sqm = g.geom.area
                area_display = f"{area_sqm:.2f} sq m" if area_sqm < 10000 else f"{area_sqm / 10000:.4f} hectares"
                perimeter = g.geom.length
                poly.description = self._build_description(
                    layer=g.layer,
                    entity_type="Polygon",
                    extra_info={
                        "Area": area_display,
                        "Perimeter": f"{perimeter:.2f} m",
                        "Vertices": str(len(exterior_coords)),
                    }
                )
                self.stats.polygons_exported += 1

            elif g.geometry_type == "LineString" and isinstance(g.geom, LineString):
                coords = list(g.geom.coords)
                tf_coords = self.transformer.transform_coords(coords)

                line = folder.newlinestring()
                line.coords = tf_coords
                line.altitudemode = simplekml.AltitudeMode.clamptoground
                line.style = self.style_manager.get_line_style(
                    kml_color=color_kml,
                    width=g.lineweight
                )

                # Add description balloon
                length = g.geom.length
                length_display = f"{length:.2f} m" if length < 1000 else f"{length / 1000:.3f} km"
                line.description = self._build_description(
                    layer=g.layer,
                    entity_type="LineString",
                    extra_info={
                        "Length": length_display,
                        "Vertices": str(len(coords)),
                    }
                )
                self.stats.polylines_exported += 1

    def export_points(self, points: List[ParsedPoint]):
        """Export POINT entities into KML Placemarks."""
        if not self.config.export_points:
            return

        for pt in points:
            folder = self._get_or_create_folder(pt.layer)
            lon, lat, elev = self.transformer.transform_point(
                pt.position[0], pt.position[1], pt.position[2]
            )

            color_kml = self.style_manager.get_color_kml(
                aci_color=pt.color_aci,
                rgb_color=pt.rgb_color
            )

            placemark = folder.newpoint()
            placemark.coords = [(lon, lat, elev)]
            placemark.altitudemode = simplekml.AltitudeMode.clamptoground
            placemark.style = self.style_manager.get_point_style(kml_color=color_kml)
            placemark.description = self._build_description(
                layer=pt.layer,
                entity_type="Point"
            )
            self.stats.points_exported += 1

    def export_labels(self, labels: List[LabelData]):
        """Export TEXT and MTEXT entities into KML Placemarks with text labels."""
        if not self.config.export_text:
            return

        for lbl in labels:
            folder = self._get_or_create_folder(lbl.layer)
            lon, lat, elev = self.transformer.transform_point(
                lbl.position[0], lbl.position[1], lbl.position[2]
            )

            # Determine color: prefer inline MTEXT color override, then entity color
            effective_aci = lbl.inline_color_aci if lbl.inline_color_aci else lbl.color_aci
            effective_rgb = lbl.rgb_color

            color_kml = self.style_manager.get_color_kml(
                aci_color=effective_aci,
                rgb_color=effective_rgb
            )

            label_pm = folder.newpoint()
            label_pm.name = lbl.text
            label_pm.coords = [(lon, lat, elev)]
            label_pm.altitudemode = simplekml.AltitudeMode.clamptoground

            # Calculate dynamic label scale from DXF text height
            label_scale = self._calculate_label_scale(lbl.height)

            label_pm.style = self.style_manager.get_label_style(
                kml_color=color_kml,
                label_scale=label_scale
            )

            # Add description with text metadata
            extra = {
                "Text": lbl.text,
                "Height": f"{lbl.height:.1f}",
                "Scale": f"{label_scale:.2f}",
            }
            if lbl.rotation != 0:
                extra["Rotation"] = f"{lbl.rotation:.1f}°"
            if lbl.font_family:
                extra["Font"] = lbl.font_family
            label_pm.description = self._build_description(
                layer=lbl.layer,
                entity_type=lbl.entity_type,
                extra_info=extra
            )
            self.stats.labels_exported += 1

    def save(self, output_path: Path):
        """Save KML document to disk."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.kml.save(str(output_path))
        logger.info(f"KML document successfully written to: {output_path}")
