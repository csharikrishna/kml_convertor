"""
Integration test for end-to-end DXF to KML conversion.
"""

from pathlib import Path
import tempfile
import ezdxf
import xml.etree.ElementTree as ET

from dxf2kml.config import ConverterConfig
from dxf2kml.parser import DXFParser
from dxf2kml.geometry import GeometryEngine
from dxf2kml.filters import BoundaryFilter
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.exporter import KMLExporter


def test_full_pipeline(tmp_path: Path):
    """Create a synthetic DXF file, process it, export KML, and verify XML elements."""
    dxf_path = tmp_path / "test_survey.dxf"
    kml_path = tmp_path / "test_survey.kml"

    # Create DXF with ezdxf
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Add layers
    doc.layers.add("Centerline", color=1)
    doc.layers.add("Points", color=2)
    doc.layers.add("Text", color=3)

    # 1. Add LINE entities on Centerline layer
    msp.add_line((250000, 1900000), (250100, 1900000), dxfattribs={"layer": "Centerline", "color": 1})
    msp.add_line((250100, 1900000), (250200, 1900000), dxfattribs={"layer": "Centerline", "color": 1})

    # 2. Add POINT entity
    msp.add_point((250050, 1900050), dxfattribs={"layer": "Points", "color": 2})

    # 3. Add TEXT entity
    msp.add_text("KM 0.000", dxfattribs={"layer": "Text", "color": 3, "insert": (250000, 1900000)})

    # 4. Add MTEXT entity
    msp.add_mtext("T.E KM 1.500", dxfattribs={"layer": "Text", "insert": (250100, 1900000)})

    # Save DXF
    doc.saveas(str(dxf_path))

    # Run conversion pipeline
    cfg = ConverterConfig(input_epsg="EPSG:32644", output_epsg="EPSG:4326")
    parser = DXFParser(cfg)
    parse_result = parser.parse(dxf_path)

    assert parse_result.total_entities_processed == 5

    geom_engine = GeometryEngine(cfg)
    reconstructed_geoms, stats = geom_engine.process(parse_result.paths, parse_result.hatches)

    assert stats.output_linestrings_count == 1  # 2 touching lines merged into 1

    boundary_filter = BoundaryFilter(cfg)
    filtered_geoms, ignored_count = boundary_filter.filter_geometries(reconstructed_geoms)

    transformer = CoordinateTransformer(source_crs=cfg.input_epsg, target_crs=cfg.output_epsg)
    exporter = KMLExporter(cfg, transformer)

    exporter.export_geometries(filtered_geoms)
    exporter.export_points(parse_result.points)
    exporter.export_labels(parse_result.labels)
    exporter.save(kml_path)

    assert kml_path.exists()

    # Parse and validate generated KML XML structure
    tree = ET.parse(kml_path)
    root = tree.getroot()

    # Verify KML namespace exists
    assert "kml" in root.tag.lower()
