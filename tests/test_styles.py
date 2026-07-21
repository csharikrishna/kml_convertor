"""
Unit tests for style generation and ACI to KML color translation.
"""

from dxf2kml.utils import aci_to_rgb, rgb_to_kml_hex
from dxf2kml.styles import StyleManager
from dxf2kml.config import ConverterConfig
import simplekml


def test_aci_to_rgb():
    """Test ACI color conversions."""
    assert aci_to_rgb(1) == (255, 0, 0)      # Red
    assert aci_to_rgb(2) == (255, 255, 0)    # Yellow
    assert aci_to_rgb(3) == (0, 255, 0)      # Green
    assert aci_to_rgb(5) == (0, 0, 255)      # Blue


def test_rgb_to_kml_hex():
    """Test converting RGB to KML 'aabbggrr' format."""
    # Red (255, 0, 0) with alpha 255 -> ff0000ff
    kml_hex = rgb_to_kml_hex(255, 0, 0, 255)
    assert kml_hex == "ff0000ff"

    # Blue (0, 0, 255) -> ff0000 (blue is high byte, red is low byte) -> ffff0000
    kml_blue = rgb_to_kml_hex(0, 0, 255, 255)
    assert kml_blue == "ffff0000"


def test_style_manager():
    """Test StyleManager caching."""
    kml = simplekml.Kml()
    cfg = ConverterConfig()
    sm = StyleManager(kml, cfg)

    color = sm.get_color_kml(aci_color=1)
    s1 = sm.get_line_style(color, width=2.0)
    s2 = sm.get_line_style(color, width=2.0)

    assert s1 is s2  # Cached style object
