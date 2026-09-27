"""
Unit tests for geometry processing, line merging, and polygon detection.
"""

import random

import pytest
from shapely.geometry import LineString, MultiLineString
from shapely.ops import unary_union

from dxf2kml.config import ConverterConfig
from dxf2kml.parser import ParsedPath
from dxf2kml.geometry import GeometryEngine


def _line(a, b, layer="L", **kw):
    return ParsedPath(vertices=[a, b], closed=False, entity_type="LINE", layer=layer, **kw)


def _boundaries(results):
    parts = []
    for g in results:
        if g.geometry_type == "Polygon":
            parts.append(g.geom.boundary)
        else:
            parts.append(g.geom)
    return unary_union(parts)


def test_line_merging():
    """Test merging connected LINE segments into a single LineString."""
    cfg = ConverterConfig(merge_lines=True, merge_distance=0.05)
    engine = GeometryEngine(cfg)

    path1 = ParsedPath(vertices=[(0.0, 0.0), (10.0, 0.0)], closed=False, entity_type="LINE", layer="Road")
    path2 = ParsedPath(vertices=[(10.0, 0.0), (20.0, 0.0)], closed=False, entity_type="LINE", layer="Road")

    results, stats = engine.process([path1, path2], [])

    assert stats.output_linestrings_count == 1
    assert len(results) == 1
    assert results[0].geometry_type == "LineString"
    assert list(results[0].geom.coords) == [(0.0, 0.0), (10.0, 0.0), (20.0, 0.0)]


def test_polygon_detection_without_duplicate_outline():
    """A closed square of 4 LINEs becomes exactly one Polygon (not also a LineString)."""
    engine = GeometryEngine(ConverterConfig(merge_lines=True, merge_distance=0.05))
    sq = [((0.0, 0.0), (10.0, 0.0)), ((10.0, 0.0), (10.0, 10.0)),
          ((10.0, 10.0), (0.0, 10.0)), ((0.0, 10.0), (0.0, 0.0))]
    results, stats = engine.process([_line(a, b, layer="Boundary") for a, b in sq], [])
    assert stats.detected_polygons_count == 1
    assert [g.geometry_type for g in results] == ["Polygon"]
    assert abs(results[0].geom.area - 100.0) < 1e-9


@pytest.mark.parametrize("segments", [
    # lollipop: stick + loop meeting at a degree-3 node
    [((-10, 0), (0, 0)), ((0, 0), (5, 5)), ((5, 5), (10, 0)), ((10, 0), (0, 0))],
    # two different paths between the same two degree-3 nodes, plus stubs
    [((0, 0), (10, 0)), ((0, 0), (5, 3), (10, 0)), ((0, 0), (-5, 0)), ((10, 0), (15, 0))],
    # T junction and a cross
    [((0, 0), (10, 0)), ((5, 0), (5, 5)), ((10, 0), (20, 0)), ((20, -5), (20, 5))],
])
def test_merging_conserves_every_input_edge(segments):
    engine = GeometryEngine(ConverterConfig())
    paths = [ParsedPath(vertices=list(s), closed=False, entity_type="LINE", layer="L") for s in segments]
    results, _ = engine.process(paths, [])
    expected = unary_union([LineString(s) for s in segments])
    got = _boundaries(results)
    assert got.symmetric_difference(expected).length == pytest.approx(0, abs=1e-9)


def test_merging_conserves_edges_on_random_network():
    rng = random.Random(42)
    nodes = [(rng.randint(0, 20), rng.randint(0, 20)) for _ in range(60)]
    segments = []
    for _ in range(300):
        a, b = rng.sample(nodes, 2)
        segments.append((a, b))
    paths = [_line(a, b) for a, b in segments]
    results, stats = GeometryEngine(ConverterConfig(merge_distance=0)).process(paths, [])
    expected = unary_union([LineString(s) for s in segments])
    got = _boundaries(results)
    assert got.symmetric_difference(expected).length == pytest.approx(0, abs=1e-6)


def test_merge_never_changes_colors():
    paths = [_line((0, 0), (1, 0), color_aci=1, rgb_color=(255, 0, 0)),
             _line((1, 0), (2, 0), color_aci=5, rgb_color=(0, 0, 255))]
    results, _ = GeometryEngine(ConverterConfig()).process(paths, [])
    assert sorted(g.rgb_color for g in results) == [(0, 0, 255), (255, 0, 0)]


def test_snapping_is_distance_based_not_grid_based():
    # 0.024 and 0.026 are 2 mm apart but straddle a 0.05 grid line.
    paths = [_line((-10, 0), (0.024, 0)), _line((0.026, 0), (10, 0))]
    results, stats = GeometryEngine(ConverterConfig(merge_distance=0.05)).process(paths, [])
    assert len(results) == 1 and stats.merged_lines_count == 1


def test_points_farther_than_tolerance_are_not_snapped():
    paths = [_line((-10, 0), (0, 0)), _line((0.06, 0), (10, 0))]
    results, _ = GeometryEngine(ConverterConfig(merge_distance=0.05)).process(paths, [])
    assert len(results) == 2


def test_duplicate_segments_are_removed():
    paths = [_line((0, 0), (1, 0)), _line((1, 0), (0, 0)), _line((0, 0), (1, 0))]
    results, stats = GeometryEngine(ConverterConfig()).process(paths, [])
    assert len(results) == 1 and stats.duplicate_segments_removed == 2


def test_nearly_closed_polyline_becomes_polygon():
    verts = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0.01)]
    p = ParsedPath(vertices=verts, closed=False, entity_type="LWPOLYLINE", layer="P")
    results, _ = GeometryEngine(ConverterConfig(merge_distance=0.05)).process([p], [])
    assert [g.geometry_type for g in results] == ["Polygon"]


def test_self_intersecting_closed_polyline_kept_as_closed_line():
    bowtie = [(0, 0), (10, 10), (10, 0), (0, 10)]
    p = ParsedPath(vertices=bowtie, closed=True, entity_type="LWPOLYLINE", layer="P")
    results, _ = GeometryEngine(ConverterConfig()).process([p], [])
    assert len(results) == 1 and results[0].geometry_type == "LineString"
    coords = list(results[0].geom.coords)
    assert coords[0] == coords[-1] and len(coords) == 5


def test_no_merge_mode_preserves_each_path():
    paths = [_line((0, 0), (1, 0), color_aci=1), _line((1, 0), (2, 0), color_aci=3)]
    results, _ = GeometryEngine(ConverterConfig(merge_lines=False)).process(paths, [])
    assert [g.color_aci for g in results] == [1, 3]


def test_polygon_with_hole_from_lines():
    outer = [((0, 0), (10, 0)), ((10, 0), (10, 10)), ((10, 10), (0, 10)), ((0, 10), (0, 0))]
    inner = [((2, 2), (4, 2)), ((4, 2), (4, 4)), ((4, 4), (2, 4)), ((2, 4), (2, 2))]
    results, _ = GeometryEngine(ConverterConfig()).process([_line(a, b) for a, b in outer + inner], [])
    areas = sorted(g.geom.area for g in results)
    assert areas == [pytest.approx(4), pytest.approx(96)]


def test_merge_scales_linearly(benchmark_segments=20000):
    """Guard against quadratic behaviour: 20k chained segments must finish quickly."""
    import time
    paths = [_line((float(i), 0.0), (float(i + 1), 0.0)) for i in range(benchmark_segments)]
    t = time.perf_counter()
    results, _ = GeometryEngine(ConverterConfig()).process(paths, [])
    assert time.perf_counter() - t < 10
    assert len(results) == 1 and isinstance(results[0].geom, LineString)
    assert not isinstance(results[0].geom, MultiLineString)
