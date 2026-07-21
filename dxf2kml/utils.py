"""
Utility functions for DXF2KML.
Contains math functions, color parsing, and geometry helpers.
"""

import math
from typing import Tuple, List, Optional
import ezdxf.colors


def aci_to_rgb(aci: int) -> Tuple[int, int, int]:
    """Convert AutoCAD Color Index (ACI 1-256) to (r, g, b) tuple (0-255)."""
    try:
        if 1 <= aci <= 256:
            return ezdxf.colors.aci2rgb(aci)
    except Exception:
        pass
    # Fallback to white/black
    return (255, 255, 255)


def rgb_to_kml_hex(r: int, g: int, b: int, alpha: int = 255) -> str:
    """
    Convert RGB(A) integers (0-255) to KML color string in 'aabbggrr' format.
    Notice KML uses Alpha-Blue-Green-Red order!
    """
    alpha = max(0, min(255, alpha))
    r = max(0, min(255, r))
    g = max(0, min(255, g))
    b = max(0, min(255, b))
    return f"{alpha:02x}{b:02x}{g:02x}{r:02x}"


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
