"""
KML Exporter module using simplekml.
Generates structured Google Earth KML files with layer folders, styled geometries, points, and labels.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple
import simplekml
from shapely.geometry import Polygon, LineString
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.styles import StyleManager
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.geometry import ReconstructedGeometry
from dxf2kml.parser import ParsedPoint
from dxf2kml.labels import LabelData


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

                poly.style = self.style_manager.get_polygon_style(
                    kml_color=color_kml,
                    width=g.lineweight
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
                self.stats.polylines_exported += 1

    def export_points(self, points: List[ParsedPoint]):
        """Export POINT entities into KML Placemarks."""
        if not self.config.export_points:
            return

        for pt in points:
            folder = self._get_or_create_folder(pt.layer)
            lon, lat, _ = self.transformer.transform_point(
                pt.position[0], pt.position[1], pt.position[2]
            )

            color_kml = self.style_manager.get_color_kml(
                aci_color=pt.color_aci,
                rgb_color=pt.rgb_color
            )

            placemark = folder.newpoint()
            placemark.coords = [(lon, lat)]
            placemark.altitudemode = simplekml.AltitudeMode.clamptoground
            placemark.style = self.style_manager.get_point_style(kml_color=color_kml)
            self.stats.points_exported += 1

    def export_labels(self, labels: List[LabelData]):
        """Export TEXT and MTEXT entities into KML Placemarks with text labels."""
        if not self.config.export_text:
            return

        for lbl in labels:
            folder = self._get_or_create_folder(lbl.layer)
            lon, lat, _ = self.transformer.transform_point(
                lbl.position[0], lbl.position[1], lbl.position[2]
            )

            color_kml = self.style_manager.get_color_kml(
                aci_color=lbl.color_aci,
                rgb_color=lbl.rgb_color
            )

            label_pm = folder.newpoint()
            label_pm.name = lbl.text
            label_pm.coords = [(lon, lat)]
            label_pm.altitudemode = simplekml.AltitudeMode.clamptoground

            label_scale = self.config.default_label_scale

            label_pm.style = self.style_manager.get_label_style(
                kml_color=color_kml,
                label_scale=label_scale
            )
            self.stats.labels_exported += 1

    def save(self, output_path: Path):
        """Save KML document to disk."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.kml.save(str(output_path))
        logger.info(f"KML document successfully written to: {output_path}")
