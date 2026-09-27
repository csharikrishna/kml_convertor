"""
Integration tests: DXF -> parser -> geometry -> CRS -> KML/KMZ, validated at the XML level.
"""

import math
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import ezdxf
import pytest

from dxf2kml.config import ConverterConfig
from dxf2kml.errors import CRSError, InputFileError
from dxf2kml.parser import DXFParser
from dxf2kml.geometry import GeometryEngine
from dxf2kml.filters import BoundaryFilter
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.exporter import KMLExporter
from dxf2kml.pipeline import convert

from .conftest import EXAMPLE_DXF

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}


def _coords(el):
    return [tuple(float(v) for v in c.split(",")) for c in el.text.split()]


def test_full_pipeline(tmp_path: Path):
    """Create a synthetic DXF file, process it with the individual stages, and verify the KML."""
    dxf_path = tmp_path / "test_survey.dxf"
    kml_path = tmp_path / "test_survey.kml"

    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    doc.layers.add("Centerline", color=1)
    doc.layers.add("Points", color=2)
    doc.layers.add("Text", color=3)
    msp.add_line((250000, 1900000), (250100, 1900000), dxfattribs={"layer": "Centerline", "color": 1})
    msp.add_line((250100, 1900000), (250200, 1900000), dxfattribs={"layer": "Centerline", "color": 1})
    msp.add_point((250050, 1900050), dxfattribs={"layer": "Points", "color": 2})
    msp.add_text("KM 0.000", dxfattribs={"layer": "Text", "color": 3, "insert": (250000, 1900000)})
    msp.add_mtext("T.E KM 1.500", dxfattribs={"layer": "Text", "insert": (250100, 1900000)})
    doc.saveas(str(dxf_path))

    cfg = ConverterConfig(input_epsg="EPSG:32644", output_epsg="EPSG:4326")
    parse_result = DXFParser(cfg).parse(dxf_path)
    assert parse_result.total_entities_processed == 5

    reconstructed_geoms, stats = GeometryEngine(cfg).process(parse_result.paths, parse_result.hatches)
    assert stats.output_linestrings_count == 1  # 2 touching lines merged into 1

    filtered_geoms, _ = BoundaryFilter(cfg).filter_geometries(reconstructed_geoms)
    transformer = CoordinateTransformer(source_crs=cfg.input_epsg, target_crs=cfg.output_epsg)
    exporter = KMLExporter(cfg, transformer)
    exporter.export_geometries(filtered_geoms)
    exporter.export_points(parse_result.points)
    exporter.export_labels(parse_result.labels)
    exporter.save(kml_path)

    root = ET.parse(kml_path).getroot()
    assert root.tag == "{http://www.opengis.net/kml/2.2}kml"
    folders = {f.findtext("k:name", namespaces=KML_NS) for f in root.iterfind(".//k:Folder", KML_NS)}
    assert folders == {"Centerline", "Points", "Text"}
    names = {p.findtext("k:name", namespaces=KML_NS) for p in root.iterfind(".//k:Placemark", KML_NS)}
    assert {"KM 0.000", "T.E KM 1.500"} <= names


def test_known_coordinates_land_in_kml(tmp_path):
    """A point on UTM 44N's central meridian must appear at exactly lon=81 in the KML."""
    doc = ezdxf.new("R2010")
    doc.modelspace().add_point((500000.0, 0.0))
    doc.modelspace().add_line((500000.0, 0.0), (500000.0, 1000.0))
    src = tmp_path / "cm.dxf"
    doc.saveas(src)
    out = tmp_path / "cm.kml"
    result = convert(src, out, ConverterConfig(input_epsg="EPSG:32644"))
    root = ET.parse(out).getroot()
    point = _coords(root.find(".//k:Point/k:coordinates", KML_NS))[0]
    assert point[0] == pytest.approx(81.0, abs=1e-12) and point[1] == pytest.approx(0.0, abs=1e-12)
    line = _coords(root.find(".//k:LineString/k:coordinates", KML_NS))
    assert all(abs(c[0] - 81.0) < 1e-12 for c in line)
    assert result.warnings == []


def test_polygon_orientation_and_holes_in_kml(tmp_path):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    h = msp.add_hatch(color=1)
    x0, y0 = 250000, 1900000
    # outer ring given clockwise on purpose
    h.paths.add_polyline_path([(x0, y0), (x0, y0 + 100), (x0 + 100, y0 + 100), (x0 + 100, y0)], is_closed=True)
    h.paths.add_polyline_path([(x0 + 40, y0 + 40), (x0 + 60, y0 + 40), (x0 + 60, y0 + 60), (x0 + 40, y0 + 60)],
                              is_closed=True)
    src = tmp_path / "hole.dxf"
    doc.saveas(src)
    out = tmp_path / "hole.kml"
    convert(src, out, ConverterConfig())
    root = ET.parse(out).getroot()
    outer = _coords(root.find(".//k:outerBoundaryIs//k:coordinates", KML_NS))
    inner = _coords(root.find(".//k:innerBoundaryIs//k:coordinates", KML_NS))

    def signed_area(ring):
        return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

    assert signed_area(outer) > 0 > signed_area(inner)  # KML: outer CCW, holes CW
    poly_style = root.find(".//k:Style/k:PolyStyle", KML_NS)
    assert poly_style.findtext("k:fill", namespaces=KML_NS) == "1"  # hatch areas are filled


def test_kmz_output(tmp_path):
    doc = ezdxf.new("R2010")
    doc.modelspace().add_circle((250000, 1900000), 10)
    src = tmp_path / "c.dxf"
    doc.saveas(src)
    out = tmp_path / "c.kmz"
    result = convert(src, out, ConverterConfig())
    assert result.output_format == "kmz"
    with zipfile.ZipFile(out) as z:
        assert z.namelist() == ["doc.kml"]
        ET.fromstring(z.read("doc.kml"))


def test_drawing_text_is_xml_escaped(tmp_path):
    doc = ezdxf.new("R2010")
    doc.layers.add("Roads & Drains")  # AutoCAD forbids <> in layer names, '&' is legal
    doc.modelspace().add_text("<img src=x onerror=alert(1)>",
                              dxfattribs={"insert": (250000, 1900000), "layer": "Roads & Drains"})
    src = tmp_path / "x.dxf"
    doc.saveas(src)
    out = tmp_path / "x.kml"
    convert(src, out, ConverterConfig())
    raw = out.read_text(encoding="utf-8")
    assert "<img" not in raw and "&lt;img src=x onerror=alert(1)&gt;" in raw
    root = ET.parse(out).getroot()  # well-formed despite markup in the drawing
    values = {d.get("name"): d.findtext("k:value", namespaces=KML_NS)
              for d in root.iterfind(".//k:Placemark/k:ExtendedData/k:Data", KML_NS)}
    assert values["Layer"] == "Roads & Drains" and values["Text"] == "<img src=x onerror=alert(1)>"


def test_local_coordinates_produce_crs_warning(tmp_path):
    doc = ezdxf.new("R2010")
    doc.modelspace().add_line((0, 0), (100, 100))
    src = tmp_path / "local.dxf"
    doc.saveas(src)
    result = convert(src, tmp_path / "local.kml", ConverterConfig(input_epsg="EPSG:32644"))
    assert any("area of use" in w for w in result.warnings)


def test_invalid_crs_fails_before_parsing(tmp_path):
    src = tmp_path / "never_read.dxf"
    src.write_text("garbage")
    with pytest.raises(CRSError):
        convert(src, tmp_path / "o.kml", ConverterConfig(input_epsg="EPSG:0"))


def test_empty_upload(tmp_path):
    src = tmp_path / "empty.dxf"
    src.write_bytes(b"")
    with pytest.raises(InputFileError):
        convert(src, tmp_path / "o.kml", ConverterConfig())


def test_preview_colors_match_kml(tmp_path):
    doc = ezdxf.new("R2010")
    doc.layers.add("L", color=5)
    doc.modelspace().add_line((250000, 1900000), (250010, 1900000), dxfattribs={"layer": "L"})
    src = tmp_path / "p.dxf"
    doc.saveas(src)
    result = convert(src, tmp_path / "p.kml", ConverterConfig(), collect_preview=True)
    feature = result.preview["features"][0]
    assert feature["properties"]["stroke"] == "#0000ff"  # BYLAYER blue, same as the KML


@pytest.mark.skipif(not EXAMPLE_DXF.exists(), reason="example drawing not available")
def test_real_example_drawing_golden(tmp_path):
    """Golden regression test on the survey drawing shipped in examples/."""
    out = tmp_path / "example.kml"
    result = convert(EXAMPLE_DXF, out, ConverterConfig(input_epsg="EPSG:32644"))
    s = result.export_stats
    assert (s.polygons_exported, s.polylines_exported, s.points_exported, s.labels_exported) == (1, 2, 9, 8)
    assert result.warnings == []
    root = ET.parse(out).getroot()
    names = {p.findtext("k:name", namespaces=KML_NS) for p in root.iterfind(".//k:Placemark", KML_NS)}
    assert {"KM 0.000", "KM 0.500", "KM 1.000", "KM 1.500", "KM 2.000", "MEEDIVEMULA SST"} <= names
    for coords in root.iterfind(".//k:coordinates", KML_NS):
        for lon, lat, *_ in _coords(coords):
            assert 77.9 < lon < 78.2 and 15.5 < lat < 15.8  # near Kurnool, Andhra Pradesh
    # both same-layer polylines keep their own (different) colors
    line_colors = {el.text for el in root.iterfind(".//k:LineStyle/k:color", KML_NS)}
    assert len(line_colors) >= 2
    assert not math.isnan(result.timings["total"])


def test_xml_illegal_control_characters_are_stripped(tmp_path):
    doc = ezdxf.new("R2010")
    t = doc.modelspace().add_text("ok", dxfattribs={"insert": (250000, 1900000)})
    t.dxf.text = "badtext"
    src = tmp_path / "ctl.dxf"
    doc.saveas(src)
    out = tmp_path / "ctl.kml"
    convert(src, out, ConverterConfig())
    root = ET.parse(out).getroot()  # would raise on &#1; / raw control characters
    assert root.find(".//k:Placemark/k:name", KML_NS).text == "badtext"


def test_failed_write_leaves_no_partial_file(tmp_path, monkeypatch):
    doc = ezdxf.new("R2010")
    doc.modelspace().add_line((250000, 1900000), (250010, 1900000))
    src = tmp_path / "w.dxf"
    doc.saveas(src)
    from dxf2kml import exporter as exporter_mod

    def boom(*_a, **_k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(exporter_mod.KMLExporter, "_write_geometry", boom)
    out = tmp_path / "w.kml"
    with pytest.raises(RuntimeError):
        convert(src, out, ConverterConfig())
    assert list(tmp_path.glob("w.kml*")) == []
