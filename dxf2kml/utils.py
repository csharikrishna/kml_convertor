"""
Utility functions for DXF2KML.
Contains math functions, color parsing, and geometry helpers.
"""

import math
import re
from typing import Tuple, List, Optional
import ezdxf.colors

# 96 dpi screen: 1 mm = 96 / 25.4 px
_PX_PER_MM = 96.0 / 25.4
# Characters that are illegal in XML 1.0 (control characters, lone surrogates, non-characters)
_XML_ILLEGAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")


def xml_text(value: object) -> str:
    """Escape text for XML element content, dropping characters XML 1.0 cannot represent."""
    text = _XML_ILLEGAL.sub("", str(value))
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def xml_attr(value: object) -> str:
    """Escape text for a double-quoted XML attribute value."""
    return xml_text(value).replace('"', "&quot;")


def aci_to_rgb(aci: int) -> Tuple[int, int, int]:
    """Convert AutoCAD Color Index (ACI 1-255) to (r, g, b); white for BYBLOCK/BYLAYER/invalid."""
    if isinstance(aci, int) and 1 <= aci <= 255:
        return tuple(ezdxf.colors.aci2rgb(aci))
    return (255, 255, 255)


def rgb_to_kml_hex(r: int, g: int, b: int, alpha: int = 255) -> str:
    """
    Convert RGB(A) integers (0-255) to KML color string in 'aabbggrr' format.
    Notice KML uses Alpha-Blue-Green-Red order!
    """
    alpha = max(0, min(255, int(alpha)))
    r = max(0, min(255, int(r)))
    g = max(0, min(255, int(g)))
    b = max(0, min(255, int(b)))
    return f"{alpha:02x}{b:02x}{g:02x}{r:02x}"


def rgb_to_css_hex(rgb: Optional[Tuple[int, int, int]], default: str = "#ff0000") -> str:
    """Convert (r, g, b) to a CSS '#rrggbb' string."""
    if not rgb:
        return default
    r, g, b = (max(0, min(255, int(c))) for c in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def css_hex_to_rgb(value: str) -> Optional[Tuple[int, int, int]]:
    """Parse '#rrggbb' (or 'rrggbb') into (r, g, b); None if invalid."""
    text = (value or "").strip().lstrip("#")
    if len(text) != 6:
        return None
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return None


def lineweight_mm_to_px(lineweight_mm: float) -> float:
    """Map a DXF lineweight (mm) to a KML line width (px), never thinner than 1 px."""
    return max(1.0, round(lineweight_mm * _PX_PER_MM, 2))


def euclidean_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Calculate 2D Euclidean distance between two points."""
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])


def polyline_length(coords: List[Tuple[float, float]]) -> float:
    """Calculate cumulative length of a polyline."""
    if len(coords) < 2:
        return 0.0
    return sum(euclidean_distance(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def get_bbox(coords: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    """Return (min_x, min_y, max_x, max_y) for a list of 2D coordinates."""
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return (min(xs), min(ys), max(xs), max(ys))
