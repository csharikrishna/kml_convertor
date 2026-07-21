"""
Style management for DXF to KML conversion.
Maps AutoCAD entity colors and lineweight to KML styles.
"""

from typing import Dict, Optional, Tuple
import simplekml
from dxf2kml.utils import aci_to_rgb, rgb_to_kml_hex
from dxf2kml.config import ConverterConfig


class StyleManager:
    """Manages creation and caching of simplekml.Style objects."""

    def __init__(self, kml_doc: simplekml.Kml, config: ConverterConfig):
        self.kml_doc = kml_doc
        self.config = config
        self._style_cache: Dict[str, simplekml.Style] = {}

    def get_color_kml(
        self,
        aci_color: Optional[int] = None,
        rgb_color: Optional[Tuple[int, int, int]] = None,
        layer_color: Optional[Tuple[int, int, int]] = None,
        alpha: int = 255
    ) -> str:
        """
        Determine KML hex color string (aabbggrr) based on DXF color hierarchy:
        1. RGB True Color if provided
        2. ACI Color if valid (and not BYLAYER 256 / BYBLOCK 0)
        3. Layer Color if provided
        4. Default Config Color
        """
        if rgb_color:
            return rgb_to_kml_hex(rgb_color[0], rgb_color[1], rgb_color[2], alpha)
        
        if aci_color is not None and 1 <= aci_color <= 255:
            r, g, b = aci_to_rgb(aci_color)
            return rgb_to_kml_hex(r, g, b, alpha)
            
        if layer_color:
            return rgb_to_kml_hex(layer_color[0], layer_color[1], layer_color[2], alpha)

        return self.config.default_line_color

    def get_line_style(
        self,
        kml_color: str,
        width: Optional[float] = None
    ) -> simplekml.Style:
        """Get or create cached LineString style."""
        width = width if (width and width > 0) else self.config.default_line_width
        key = f"line_{kml_color}_{width}"

        if key in self._style_cache:
            return self._style_cache[key]

        style = simplekml.Style()
        style.linestyle.color = kml_color
        style.linestyle.width = width
        self._style_cache[key] = style
        return style

    def get_polygon_style(
        self,
        kml_color: str,
        width: Optional[float] = None,
        fill: bool = False,
        fill_alpha: int = 100
    ) -> simplekml.Style:
        """Get or create cached Polygon style."""
        width = width if (width and width > 0) else self.config.default_line_width
        key = f"poly_{kml_color}_{width}_{fill}_{fill_alpha}"

        if key in self._style_cache:
            return self._style_cache[key]

        style = simplekml.Style()
        style.linestyle.color = kml_color
        style.linestyle.width = width
        style.polystyle.fill = 1 if fill else 0
        style.polystyle.outline = 1
        if fill and len(kml_color) == 8:
            # Adjust alpha for fill
            r_g_b = kml_color[2:]
            fill_kml_color = f"{fill_alpha:02x}{r_g_b}"
            style.polystyle.color = fill_kml_color
        else:
            style.polystyle.color = kml_color

        self._style_cache[key] = style
        return style

    def get_point_style(
        self,
        kml_color: str,
        icon_scale: Optional[float] = None,
        icon_url: Optional[str] = None
    ) -> simplekml.Style:
        """Get or create cached Placemark point style."""
        scale = icon_scale if icon_scale is not None else self.config.default_point_scale
        url = icon_url or self.config.point_icon_url
        key = f"point_{kml_color}_{scale}_{url}"

        if key in self._style_cache:
            return self._style_cache[key]

        style = simplekml.Style()
        style.iconstyle.icon.href = url
        style.iconstyle.scale = scale
        style.iconstyle.color = kml_color
        self._style_cache[key] = style
        return style

    def get_label_style(
        self,
        kml_color: str,
        label_scale: Optional[float] = None
    ) -> simplekml.Style:
        """Get or create cached Label text style."""
        scale = label_scale if label_scale is not None else self.config.default_label_scale
        key = f"label_{kml_color}_{scale}"

        if key in self._style_cache:
            return self._style_cache[key]

        style = simplekml.Style()
        # Invisible icon so only text appears
        style.iconstyle.scale = 0
        style.labelstyle.scale = scale
        style.labelstyle.color = kml_color
        self._style_cache[key] = style
        return style
