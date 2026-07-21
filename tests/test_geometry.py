"""
Unit tests for geometry processing, line merging, and polygon detection.
"""

from dxf2kml.config import ConverterConfig
from dxf2kml.parser import ParsedPath
from dxf2kml.geometry import GeometryEngine


def test_line_merging():
    """Test merging connected LINE segments into a single LineString."""
    cfg = ConverterConfig(merge_lines=True, merge_distance=0.05)
    engine = GeometryEngine(cfg)

    # Two touching line segments: (0,0)->(10,0) and (10,0)->(20,0)
    path1 = ParsedPath(vertices=[(0.0, 0.0), (10.0, 0.0)], closed=False, entity_type="LINE", layer="Road")
    path2 = ParsedPath(vertices=[(10.0, 0.0), (20.0, 0.0)], closed=False, entity_type="LINE", layer="Road")

    results, stats = engine.process([path1, path2], [])

    assert stats.output_linestrings_count == 1
    assert len(results) == 1
    assert results[0].geometry_type == "LineString"
    assert list(results[0].geom.coords) == [(0.0, 0.0), (10.0, 0.0), (20.0, 0.0)]


def test_polygon_detection():
    """Test detecting a closed square loop formed by 4 line segments."""
    cfg = ConverterConfig(merge_lines=True, merge_distance=0.05)
    engine = GeometryEngine(cfg)

    # 4 segments forming a 10x10 square
    p1 = ParsedPath(vertices=[(0.0, 0.0), (10.0, 0.0)], closed=False, entity_type="LINE", layer="Boundary")
    p2 = ParsedPath(vertices=[(10.0, 0.0), (10.0, 10.0)], closed=False, entity_type="LINE", layer="Boundary")
    p3 = ParsedPath(vertices=[(10.0, 10.0), (0.0, 10.0)], closed=False, entity_type="LINE", layer="Boundary")
    p4 = ParsedPath(vertices=[(0.0, 10.0), (0.0, 0.0)], closed=False, entity_type="LINE", layer="Boundary")

    results, stats = engine.process([p1, p2, p3, p4], [])

    assert stats.detected_polygons_count == 1
    assert any(g.geometry_type == "Polygon" for g in results)
    poly_geom = [g for g in results if g.geometry_type == "Polygon"][0].geom
    assert abs(poly_geom.area - 100.0) < 1e-4
