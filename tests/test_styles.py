"""
Unit tests for style generation and AutoCAD color -> KML color translation.

KML colors are 'aabbggrr' (alpha, blue, green, red) - NOT the familiar 'rrggbbaa'.
"""

import xml.etree.ElementTree as ET

import pytest

from dxf2kml.config import ConverterConfig
from dxf2kml.styles import StyleManager
from dxf2kml.utils import aci_to_rgb, lineweight_mm_to_px, rgb_to_kml_hex


def test_aci_to_rgb():
    assert aci_to_rgb(1) == (255, 0, 0)      # Red
    assert aci_to_rgb(2) == (255, 255, 0)    # Yellow
    assert aci_to_rgb(3) == (0, 255, 0)      # Green
    assert aci_to_rgb(5) == (0, 0, 255)      # Blue
    assert aci_to_rgb(7) == (255, 255, 255)  # White (black on light backgrounds)
    assert aci_to_rgb(0) == aci_to_rgb(256) == (255, 255, 255)  # BYBLOCK/BYLAYER unresolved


@pytest.mark.parametrize("rgb, alpha, expected", [
    ((0, 0, 0), 255, "ff000000"),        # black
    ((255, 255, 255), 255, "ffffffff"),  # white
    ((255, 0, 0), 255, "ff0000ff"),      # red   -> rr in the lowest byte
    ((0, 255, 0), 255, "ff00ff00"),      # green
    ((0, 0, 255), 255, "ffff0000"),      # blue  -> bb right after alpha
    ((0x12, 0x34, 0x56), 255, "ff563412"),
    ((0x12, 0x34, 0x56), 0x80, "80563412"),  # transparency in the first byte
    ((300, -5, 10), 999, "ff0a00ff"),         # clamped
])
def test_rgb_to_kml_hex_byte_order(rgb, alpha, expected):
    assert rgb_to_kml_hex(*rgb, alpha) == expected


def test_style_manager_caching_and_resolution():
    sm = StyleManager(ConverterConfig())
    color = sm.get_color_kml(aci_color=1)
    assert color == "ff0000ff"
    assert sm.get_line_style(color, width=0.5) is sm.get_line_style(color, width=0.5)
    assert sm.get_color_kml(rgb_color=(0, 0, 255), aci_color=1) == "ffff0000"  # RGB wins over ACI
    assert sm.get_color_kml() == ConverterConfig().default_line_color


@pytest.mark.parametrize("mm, px", [(0.0, 1.0), (0.25, 1.0), (0.5, 1.89), (1.0, 3.78), (2.11, 7.97)])
def test_lineweight_mm_to_px(mm, px):
    assert lineweight_mm_to_px(mm) == pytest.approx(px, abs=0.01)


def test_line_width_default_and_lineweight():
    sm = StyleManager(ConverterConfig(default_line_width=2.0))
    assert sm.get_line_style("ff0000ff", width=None).line_width == 2.0
    assert sm.get_line_style("ff0000ff", width=1.0).line_width == pytest.approx(3.78, abs=0.01)


def test_polygon_fill_alpha_replaced_and_clamped():
    sm = StyleManager(ConverterConfig())
    style = sm.get_polygon_style("ff0000ff", fill=True, fill_color="ff00ff00", fill_opacity=0x4c)
    assert style.poly_color == "4c00ff00" and style.poly_fill
    clamped = sm.get_polygon_style("ff0000ff", fill=True, fill_color="ff00ff00", fill_opacity=999)
    assert clamped.poly_color == "ff00ff00"
    assert "<PolyStyle><color>4c00ff00</color><fill>1</fill><outline>1</outline></PolyStyle>" in style.to_kml()


def test_kml_output_contains_expected_colors(new_doc, tmp_path):
    """End to end: DXF true color / ACI / BYLAYER -> KML LineStyle colors."""
    from dxf2kml.pipeline import convert
    doc, msp = new_doc()
    doc.layers.add("BLUE", color=5)
    x0, y0 = 250000, 1900000
    msp.add_line((x0, y0), (x0 + 10, y0), dxfattribs={"color": 1})                  # red ACI
    msp.add_line((x0, y0 + 50), (x0 + 10, y0 + 50), dxfattribs={"layer": "BLUE"})    # BYLAYER blue
    tc = msp.add_line((x0, y0 + 100), (x0 + 10, y0 + 100))
    tc.rgb = (0x12, 0x34, 0x56)                                                      # true color
    src = tmp_path / "colors.dxf"
    doc.saveas(src)
    out = tmp_path / "colors.kml"
    convert(src, out, ConverterConfig())
    root = ET.parse(out).getroot()
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    colors = {el.text for el in root.iterfind(".//k:LineStyle/k:color", ns)}
    assert {"ff0000ff", "ffff0000", "ff563412"} <= colors
