"""
Parser tests: DXF entity semantics, block/INSERT transforms, property inheritance,
curve tessellation accuracy, resource limits and failure handling.
"""

import math

import ezdxf
import pytest
from ezdxf.math import Matrix44

from dxf2kml.config import ConverterConfig
from dxf2kml.errors import InputFileError, LimitExceededError
from dxf2kml.parser import DXFParser


def _only_path(result):
    assert len(result.paths) == 1, [p.vertices for p in result.paths]
    return result.paths[0]


# --------------------------------------------------------------------------- polylines

def test_old_style_polyline_2d_and_3d_are_parsed(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_polyline2d([(0, 0), (10, 0), (10, 10)], close=True)
    msp.add_polyline3d([(0, 0, 0), (5, 5, 5), (9, 1, 2)])
    result = parse_doc(doc)
    assert len(result.paths) == 2
    closed = [p for p in result.paths if p.closed]
    assert len(closed) == 1 and closed[0].vertices[0] == closed[0].vertices[-1]


def test_polyline2d_bulge_is_tessellated(new_doc, parse_doc):
    doc, msp = new_doc()
    pl = msp.add_polyline2d([(0, 0), (2, 0)], format="xy")
    pl.vertices[0].dxf.bulge = 1.0  # semicircle
    result = parse_doc(doc)
    verts = _only_path(result).vertices
    assert len(verts) > 3
    assert all(abs(math.hypot(x - 1, y) - 1.0) < 0.05 + 1e-9 for x, y in verts)


@pytest.mark.parametrize("bulge, expected_mid_y", [(1.0, -1.0), (-1.0, 1.0)])
def test_lwpolyline_bulge_orientation_and_radius(new_doc, parse_doc, bulge, expected_mid_y):
    """bulge = tan(theta/4); +1 is a counter-clockwise semicircle from start to end."""
    doc, msp = new_doc()
    msp.add_lwpolyline([(1, 0, 0, 0, bulge), (3, 0)], format="xyseb")
    verts = _only_path(parse_doc(doc)).vertices
    assert verts[0] == pytest.approx((1, 0)) and verts[-1] == pytest.approx((3, 0))
    mid = min(verts, key=lambda p: abs(p[0] - 2))
    assert mid[1] == pytest.approx(expected_mid_y, abs=0.01)
    # every vertex lies on the circle of radius 1 around (2, 0) within flattening distance
    assert all(abs(math.hypot(x - 2, y) - 1.0) <= 0.05 + 1e-9 for x, y in verts)


def test_lwpolyline_quarter_bulge_included_angle(new_doc, parse_doc):
    # bulge = tan(90deg / 4) -> 90 degree arc from (0,0) to (1,1) with radius 1
    doc, msp = new_doc()
    msp.add_lwpolyline([(0, 0, 0, 0, math.tan(math.radians(90) / 4)), (1, 1)], format="xyseb")
    verts = _only_path(parse_doc(doc)).vertices
    # CCW 90 deg arc from (0,0) to (1,1): centre at (0,1)
    assert all(abs(math.hypot(x - 0, y - 1) - 1) < 0.05 for x, y in verts)


def test_closed_lwpolyline_includes_closing_bulge(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_lwpolyline([(0, 0, 0, 0, 0), (2, 0, 0, 0, 1)], format="xyseb", close=True)
    p = _only_path(parse_doc(doc))
    assert p.closed
    assert p.vertices[0] == pytest.approx(p.vertices[-1])
    assert max(y for _, y in p.vertices) == pytest.approx(1.0, abs=0.01)


def test_lwpolyline_elevation_and_extrusion_are_applied(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_lwpolyline([(1, 0), (2, 0)], dxfattribs={"extrusion": (0, 0, -1)})
    verts = _only_path(parse_doc(doc)).vertices
    assert verts == [pytest.approx((-1, 0)), pytest.approx((-2, 0))]


# --------------------------------------------------------------------------- curves

def test_arc_and_circle_accuracy(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_arc((10, 10), radius=5, start_angle=0, end_angle=90)
    msp.add_circle((0, 0), radius=100)
    result = parse_doc(doc)
    arc = next(p for p in result.paths if p.entity_type == "ARC")
    circle = next(p for p in result.paths if p.entity_type == "CIRCLE")
    assert arc.vertices[0] == pytest.approx((15, 10)) and arc.vertices[-1] == pytest.approx((10, 15))
    assert not arc.closed and circle.closed
    for x, y in circle.vertices:
        assert abs(math.hypot(x, y) - 100) < 1e-6  # vertices are on the circle
    # sagitta between consecutive vertices within flattening distance
    n = len(circle.vertices) - 1
    assert 100 * (1 - math.cos(math.pi / n)) <= 0.05 + 1e-9


def test_pathological_radius_is_bounded(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_circle((0, 0), radius=1e12)
    cfg = ConverterConfig(max_vertices_per_curve=2048)
    p = _only_path(parse_doc(doc, cfg))
    assert len(p.vertices) <= 2 * 2048


def test_ellipse_full_and_partial(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_ellipse((0, 0), major_axis=(10, 0), ratio=0.5)
    msp.add_ellipse((0, 0), major_axis=(0, 10), ratio=0.5, start_param=0, end_param=math.pi)
    result = parse_doc(doc)
    full, half = result.paths
    assert full.closed and not half.closed
    xs = [x for x, _ in full.vertices]
    ys = [y for _, y in full.vertices]
    assert max(xs) == pytest.approx(10, abs=1e-6) and max(ys) == pytest.approx(5, abs=0.05)
    # rotated major axis (along +Y): half ellipse from (0,10) through (-5,0) to (0,-10)
    assert half.vertices[0] == pytest.approx((0, 10), abs=1e-6)
    assert half.vertices[-1] == pytest.approx((0, -10), abs=1e-6)
    assert min(x for x, _ in half.vertices) == pytest.approx(-5, abs=0.05)


def test_rational_spline_weights_are_respected(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_rational_spline([(0, 0), (1, 1), (2, 0)], weights=[1, 10, 1], degree=2)
    verts = _only_path(parse_doc(doc)).vertices
    # quadratic rational Bezier peak at t=0.5: y = (10*1) / (1 + 2*10 + 1) * 2 ... = 10/11
    assert max(y for _, y in verts) == pytest.approx(10 / 11, abs=0.01)


def test_fit_point_spline_passes_through_fit_points(new_doc, parse_doc):
    doc, msp = new_doc()
    fit = [(0, 0), (5, 5), (10, 0), (15, 5)]
    msp.add_spline(fit_points=fit)
    verts = _only_path(parse_doc(doc)).vertices
    for fx, fy in fit:
        assert min(math.hypot(x - fx, y - fy) for x, y in verts) < 0.1


def test_periodic_closed_spline_evaluated_on_valid_domain(new_doc, parse_doc):
    """Unclamped (periodic) knot vectors must be evaluated on [t_p, t_n] only."""
    doc, msp = new_doc()
    square = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0)]
    degree = 3
    ctrl = square + square[:degree]  # wrapped control points
    knots = list(range(len(ctrl) + degree + 1))  # uniform, unclamped
    spline = msp.add_spline(dxfattribs={"degree": degree, "flags": 1 | 2})  # closed + periodic
    spline.control_points = ctrl
    spline.knots = knots
    p = _only_path(parse_doc(doc))
    assert p.closed
    assert p.vertices[0] == pytest.approx(p.vertices[-1], abs=1e-6)
    for x, y in p.vertices:  # the curve stays inside the control polygon's hull
        assert -1e-6 <= x <= 10 + 1e-6 and -1e-6 <= y <= 10 + 1e-6


def test_solid_trace_3dface_become_closed_rings(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_solid([(0, 0), (1, 0), (0, 1), (1, 1)])  # SOLID uses "bow-tie" vertex order
    msp.add_trace([(0, 0), (1, 0), (0, 1), (1, 1)])
    msp.add_3dface([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)])
    result = parse_doc(doc)
    assert not result.unsupported_counts
    assert len(result.paths) == 3
    from shapely.geometry import Polygon
    for p in result.paths:
        assert p.closed and Polygon(p.vertices).is_valid
        assert Polygon(p.vertices).area == pytest.approx(1.0)


# --------------------------------------------------------------------------- blocks

def _block_doc(new_doc):
    doc, msp = new_doc()
    blk = doc.blocks.new("B", base_point=(1, 1))
    blk.add_line((1, 1), (3, 1))
    blk.add_lwpolyline([(1, 1), (1, 2), (2, 2)])
    return doc, msp


@pytest.mark.parametrize("xscale, yscale, rotation", [
    (1, 1, 0), (2, 2, 0), (-1, 1, 0), (1, -1, 30), (2, 0.5, 45), (-3, 2, 200),
])
def test_insert_transform_matches_matrix(new_doc, parse_doc, xscale, yscale, rotation):
    """WCS = M(insert) applied to (block point - base point); verified against ezdxf's Matrix44."""
    doc, msp = _block_doc(new_doc)
    msp.add_blockref("B", (100, 50), dxfattribs={"xscale": xscale, "yscale": yscale, "rotation": rotation})
    result = parse_doc(doc)
    m = (Matrix44.translate(-1, -1, 0) @ Matrix44.scale(xscale, yscale, 1)
         @ Matrix44.z_rotate(math.radians(rotation)) @ Matrix44.translate(100, 50, 0))
    expected_line = [tuple(m.transform((x, y, 0)))[:2] for x, y in [(1, 1), (3, 1)]]
    expected_pl = [tuple(m.transform((x, y, 0)))[:2] for x, y in [(1, 1), (1, 2), (2, 2)]]
    line = next(p for p in result.paths if p.entity_type == "LINE")
    pl = next(p for p in result.paths if p.entity_type == "LWPOLYLINE")
    assert line.vertices == [pytest.approx(v, abs=1e-9) for v in expected_line]
    assert pl.vertices == [pytest.approx(v, abs=1e-9) for v in expected_pl]


def test_nested_blocks_compose_transforms(new_doc, parse_doc):
    doc, msp = new_doc()
    inner = doc.blocks.new("INNER")
    inner.add_line((0, 0), (1, 0))
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("INNER", (10, 0), dxfattribs={"rotation": 90, "xscale": 2, "yscale": 2})
    msp.add_blockref("OUTER", (100, 100), dxfattribs={"rotation": 90, "xscale": -1, "yscale": 1})
    p = _only_path(parse_doc(doc))
    m_child = Matrix44.scale(2, 2, 1) @ Matrix44.z_rotate(math.radians(90)) @ Matrix44.translate(10, 0, 0)
    m_parent = Matrix44.scale(-1, 1, 1) @ Matrix44.z_rotate(math.radians(90)) @ Matrix44.translate(100, 100, 0)
    m = m_child @ m_parent  # entity -> child -> parent (row-vector convention)
    expected = [tuple(m.transform(v))[:2] for v in [(0, 0, 0), (1, 0, 0)]]
    assert p.vertices == [pytest.approx(v, abs=1e-9) for v in expected]


def test_nested_non_uniform_scaled_rotated_blocks_are_not_lost(new_doc, parse_doc):
    """Shear-producing nested transforms cannot be expressed as an INSERT; content must still appear."""
    doc, msp = new_doc()
    inner = doc.blocks.new("INNER")
    inner.add_circle((0, 0), 1)
    inner.add_line((0, 0), (1, 0))
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("INNER", (0, 0), dxfattribs={"rotation": 45})
    msp.add_blockref("OUTER", (0, 0), dxfattribs={"xscale": 3, "yscale": 1})
    result = parse_doc(doc)
    types = sorted(p.entity_type for p in result.paths)
    assert types in (["ELLIPSE", "LINE"], ["CIRCLE", "LINE"])
    line = next(p for p in result.paths if p.entity_type == "LINE")
    c = math.cos(math.radians(45))
    assert line.vertices[-1] == pytest.approx((3 * c, c), abs=1e-9)


def test_minsert_array_expands_all_copies(new_doc, parse_doc):
    doc, msp = new_doc()
    blk = doc.blocks.new("P")
    blk.add_point((0, 0))
    ins = msp.add_blockref("P", (0, 0))
    ins.grid(size=(2, 3), spacing=(10, 20))
    result = parse_doc(doc)
    positions = sorted((round(p.position[0]), round(p.position[1])) for p in result.points)
    assert positions == sorted((c * 20, r * 10) for r in range(2) for c in range(3))


def test_recursive_block_reference_is_guarded(new_doc, tmp_path):
    doc, msp = new_doc()
    a = doc.blocks.new("A")
    a.add_line((0, 0), (1, 0))
    a.add_blockref("A", (5, 0))  # A contains itself
    msp.add_blockref("A", (0, 0))
    path = tmp_path / "recursive.dxf"
    doc.saveas(path)
    result = DXFParser(ConverterConfig()).parse(path)
    assert len(result.paths) == 1
    assert result.skipped.get("recursive block reference") == 1


def test_block_depth_limit(new_doc, parse_doc):
    doc, msp = new_doc()
    depth = 6
    for i in range(depth):
        blk = doc.blocks.new(f"L{i}")
        blk.add_point((i, 0))
        if i + 1 < depth:
            blk.add_blockref(f"L{i + 1}", (0, 0))
    msp.add_blockref("L0", (0, 0))
    result = parse_doc(doc, ConverterConfig(max_block_depth=3))
    assert len(result.points) == 3
    assert any("nesting deeper" in k for k in result.skipped)


def test_insert_of_missing_block_does_not_abort(new_doc, parse_doc):
    doc, msp = new_doc()
    doc.blocks.new("GONE")
    msp.add_blockref("GONE", (0, 0))
    msp.add_line((0, 0), (1, 1))
    doc.blocks.delete_block("GONE", safe=False)
    result = parse_doc(doc)
    assert len(result.paths) == 1


# --------------------------------------------------------------------------- properties

def test_byblock_and_layer0_inheritance(new_doc, parse_doc):
    doc, msp = new_doc()
    doc.layers.add("WALLS", color=5)
    blk = doc.blocks.new("C")
    blk.add_line((0, 0), (1, 0), dxfattribs={"color": 0, "layer": "0", "lineweight": -2})  # BYBLOCK
    blk.add_line((0, 1), (1, 1), dxfattribs={"layer": "0"})  # BYLAYER on layer 0 -> insert layer
    blk.add_line((0, 2), (1, 2), dxfattribs={"layer": "OWN", "color": 3})  # explicit layer & color
    msp.add_blockref("C", (0, 0), dxfattribs={"color": 1, "layer": "WALLS", "lineweight": 50})
    result = parse_doc(doc)
    by_y = {round(p.vertices[0][1]): p for p in result.paths}
    assert (by_y[0].layer, by_y[0].rgb_color, by_y[0].lineweight) == ("WALLS", (255, 0, 0), 0.5)
    assert (by_y[1].layer, by_y[1].rgb_color) == ("WALLS", (0, 0, 255))
    assert (by_y[2].layer, by_y[2].rgb_color) == ("OWN", (0, 255, 0))


def test_nested_byblock_resolves_through_bylayer_insert(new_doc, parse_doc):
    doc, msp = new_doc()
    doc.layers.add("RED", color=1)
    inner = doc.blocks.new("IN")
    inner.add_line((0, 0), (1, 0), dxfattribs={"color": 0})
    outer = doc.blocks.new("OUT")
    outer.add_blockref("IN", (0, 0), dxfattribs={"color": 0})  # BYBLOCK -> outer insert
    msp.add_blockref("OUT", (0, 0), dxfattribs={"layer": "RED"})  # BYLAYER -> red
    assert _only_path(parse_doc(doc)).rgb_color == (255, 0, 0)


def test_true_color_and_layer_true_color(new_doc, parse_doc):
    doc, msp = new_doc()
    layer = doc.layers.add("TC")
    layer.rgb = (10, 20, 30)
    msp.add_line((0, 0), (1, 0), dxfattribs={"layer": "TC"})
    line = msp.add_line((0, 1), (1, 1), dxfattribs={"layer": "TC", "color": 1})
    line.rgb = (200, 100, 50)
    result = parse_doc(doc)
    by_y = {round(p.vertices[0][1]): p.rgb_color for p in result.paths}
    assert by_y == {0: (10, 20, 30), 1: (200, 100, 50)}


def test_layer_lookup_is_case_insensitive_and_off_layer_color_positive(new_doc, parse_doc):
    doc, msp = new_doc()
    lay = doc.layers.add("Roads", color=3)
    lay.off()  # stored as negative ACI
    msp.add_line((0, 0), (1, 0), dxfattribs={"layer": "ROADS"})
    assert _only_path(parse_doc(doc)).rgb_color == (0, 255, 0)


def test_attributes_are_exported_and_invisible_ones_skipped(new_doc, parse_doc):
    doc, msp = new_doc()
    doc.layers.add("PLOTS", color=2)
    blk = doc.blocks.new("A")
    blk.add_attdef("PLOT", (0, 0))
    blk.add_attdef("SECRET", (0, 1))
    blk.add_circle((0, 0), 1)
    ins = msp.add_blockref("A", (50, 50), dxfattribs={"layer": "PLOTS"})
    ins.add_attrib("PLOT", "Plot-42", (50, 50))
    hidden = ins.add_attrib("SECRET", "x", (50, 51))
    hidden.is_invisible = True
    result = parse_doc(doc)
    assert [lbl.text for lbl in result.labels] == ["Plot-42"]
    assert result.labels[0].entity_type == "ATTRIB"
    assert result.labels[0].layer == "PLOTS"
    assert result.skipped.get("invisible attribute") == 1


def test_dimension_is_exploded(new_doc, parse_doc):
    doc, msp = new_doc()
    dim = msp.add_linear_dim(base=(0, 5), p1=(0, 0), p2=(10, 0))
    dim.render()
    result = parse_doc(doc)
    assert result.paths, "dimension lines expected"
    assert any("10" in lbl.text for lbl in result.labels)
    assert "DIMENSION" not in result.unsupported_counts


def test_unsupported_entities_are_counted_not_silent(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_xline((0, 0), (1, 0))
    msp.add_line((0, 0), (1, 1))
    result = parse_doc(doc)
    assert result.unsupported_counts == {"XLINE": 1}
    assert len(result.paths) == 1


def test_invisible_entities_are_skipped(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_line((0, 0), (1, 0), dxfattribs={"invisible": 1})
    result = parse_doc(doc)
    assert not result.paths and result.skipped.get("invisible entity") == 1


# --------------------------------------------------------------------------- hatches

def test_hatch_disjoint_areas_and_island(new_doc, parse_doc):
    doc, msp = new_doc()
    h = msp.add_hatch(color=3)
    h.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True, flags=1)
    h.paths.add_polyline_path([(2, 2), (8, 2), (8, 8), (2, 8)], is_closed=True, flags=16)   # hole
    h.paths.add_polyline_path([(4, 4), (6, 4), (6, 6), (4, 6)], is_closed=True, flags=16)   # island
    h.paths.add_polyline_path([(20, 0), (30, 0), (30, 10), (20, 10)], is_closed=True, flags=1)
    result = parse_doc(doc)
    from dxf2kml.geometry import GeometryEngine
    geoms, stats = GeometryEngine(ConverterConfig()).process(result.paths, result.hatches)
    areas = sorted(round(g.geom.area, 6) for g in geoms)
    assert areas == [4.0, 64.0, 100.0]  # island, ring (100-36), second square
    assert all(g.filled for g in geoms)


def test_hatch_with_arc_edges(new_doc, parse_doc):
    doc, msp = new_doc()
    h = msp.add_hatch()
    ep = h.paths.add_edge_path()
    ep.add_line((0, 0), (10, 0))
    ep.add_arc((10, 5), radius=5, start_angle=-90, end_angle=90)
    ep.add_line((10, 10), (0, 10))
    ep.add_line((0, 10), (0, 0))
    result = parse_doc(doc)
    from dxf2kml.geometry import GeometryEngine
    geoms, _ = GeometryEngine(ConverterConfig()).process(result.paths, result.hatches)
    assert len(geoms) == 1
    # Chord flattening loses at most ~(2/3) * sagitta * arc_length of area.
    exact = 100 + math.pi * 25 / 2
    max_loss = (2 / 3) * ConverterConfig().flattening_distance * (math.pi * 5)
    assert exact - max_loss <= geoms[0].geom.area <= exact + 1e-6


# --------------------------------------------------------------------------- text

def test_text_ocs_in_mirrored_block(new_doc, parse_doc):
    doc, msp = new_doc()
    blk = doc.blocks.new("T")
    blk.add_text("X", dxfattribs={"insert": (1, 1)})
    msp.add_blockref("T", (100, 0), dxfattribs={"xscale": -1})
    result = parse_doc(doc)
    assert result.labels[0].position[:2] == pytest.approx((99, 1))


def test_text_control_codes_and_unicode_roundtrip(new_doc, parse_doc):
    """R2000 files store non-ASCII as \\U+XXXX; ezdxf does not decode those."""
    doc, msp = new_doc("R2000")
    msp.add_text("45%%d %%c100 %%p0.5", dxfattribs={"insert": (0, 0)})
    msp.add_text("గ్రామం", dxfattribs={"insert": (0, 1)})
    msp.add_mtext("సర్వే నం. 42\\PLine 2", dxfattribs={"insert": (0, 2)})
    texts = [lbl.text for lbl in parse_doc(doc).labels]
    assert texts == ["45° ⌀100 ±0.5", "గ్రామం", "సర్వే నం. 42\nLine 2"]


def test_aligned_text_uses_midpoint(new_doc, parse_doc):
    doc, msp = new_doc()
    t = msp.add_text("FIT")
    t.set_placement((0, 0), (10, 0), align=ezdxf.enums.TextEntityAlignment.ALIGNED)
    assert parse_doc(doc).labels[0].position[:2] == pytest.approx((5, 0))


# --------------------------------------------------------------------------- limits & failures

def test_entity_limit(new_doc, parse_doc):
    doc, msp = new_doc()
    for i in range(20):
        msp.add_point((i, 0))
    with pytest.raises(LimitExceededError):
        parse_doc(doc, ConverterConfig(max_entities=10))


def test_vertex_limit(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_lwpolyline([(i, 0) for i in range(100)])
    with pytest.raises(LimitExceededError):
        parse_doc(doc, ConverterConfig(max_vertices=50))


def test_deadline_is_enforced(new_doc, tmp_path):
    doc, msp = new_doc()
    for i in range(2000):
        msp.add_point((i, 0))
    path = tmp_path / "slow.dxf"
    doc.saveas(path)
    parser = DXFParser(ConverterConfig(), deadline=0.0)  # already expired
    with pytest.raises(LimitExceededError):
        parser.parse(path)


def test_empty_drawing(new_doc, parse_doc):
    doc, _ = new_doc()
    result = parse_doc(doc)
    assert result.total_entities_processed == 0 and not result.paths


@pytest.mark.parametrize("content", [b"", b"not a dxf file at all\n" * 10, b"PK\x03\x04garbage"])
def test_garbage_input_raises_input_error(tmp_path, content):
    path = tmp_path / "bad.dxf"
    path.write_bytes(content)
    with pytest.raises(InputFileError):
        DXFParser(ConverterConfig()).parse(path)


def test_malformed_entity_does_not_abort_conversion(new_doc, parse_doc, monkeypatch):
    doc, msp = new_doc()
    msp.add_circle((0, 0), 1)
    msp.add_line((0, 0), (1, 1))
    def broken(*_args, **_kwargs):
        raise RuntimeError("corrupt circle")

    monkeypatch.setattr(DXFParser, "_arc_points", broken)
    result = parse_doc(doc)
    assert len(result.paths) == 1 and result.skipped == {"malformed CIRCLE": 1}


def test_valid_dxf_uses_standard_reader_not_recovery(new_doc, tmp_path, monkeypatch):
    """Regression: a function-local `import ezdxf.recover` made `ezdxf` unbound, so every
    file silently went through the (slower) recovery reader."""
    import ezdxf.recover

    def fail(*_a, **_k):
        raise AssertionError("recovery reader must not be used for a valid DXF")

    monkeypatch.setattr(ezdxf.recover, "readfile", fail)
    doc, msp = new_doc()
    msp.add_line((0, 0), (1, 0))
    path = tmp_path / "valid.dxf"
    doc.saveas(path)
    assert len(DXFParser(ConverterConfig()).parse(path).paths) == 1
