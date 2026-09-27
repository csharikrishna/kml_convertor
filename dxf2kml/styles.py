"""
Style management for DXF to KML conversion.
Maps AutoCAD entity colors and lineweight to shared KML styles.

KML colors are 'aabbggrr' (alpha, blue, green, red) - see utils.rgb_to_kml_hex.
DXF lineweights are millimetres; KML widths are pixels (96 dpi: 1 mm = 3.78 px).
Identical styles are de-duplicated and written once as shared <Style id="..."> elements.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from dxf2kml.config import ConverterConfig
from dxf2kml.utils import aci_to_rgb, lineweight_mm_to_px, rgb_to_kml_hex, xml_text


@dataclass(frozen=True)
class KMLStyle:
    """A shared KML style. Only the populated sub-styles are written."""
    id: str
    line_color: Optional[str] = None
    line_width: Optional[float] = None
    poly_color: Optional[str] = None
    poly_fill: Optional[bool] = None
    poly_outline: Optional[bool] = None
    icon_href: Optional[str] = None
    icon_scale: Optional[float] = None
    icon_color: Optional[str] = None
    label_color: Optional[str] = None
    label_scale: Optional[float] = None

    def to_kml(self) -> str:
        parts = [f'<Style id="{self.id}">']
        if self.icon_scale is not None or self.icon_href or self.icon_color:
            parts.append("<IconStyle>")
            if self.icon_color:
                parts.append(f"<color>{self.icon_color}</color>")
            if self.icon_scale is not None:
                parts.append(f"<scale>{self.icon_scale:g}</scale>")
            if self.icon_href:
                parts.append(f"<Icon><href>{xml_text(self.icon_href)}</href></Icon>")
            parts.append("</IconStyle>")
        if self.label_color or self.label_scale is not None:
            parts.append("<LabelStyle>")
            if self.label_color:
                parts.append(f"<color>{self.label_color}</color>")
            if self.label_scale is not None:
                parts.append(f"<scale>{self.label_scale:g}</scale>")
            parts.append("</LabelStyle>")
        if self.line_color:
            parts.append(f"<LineStyle><color>{self.line_color}</color><width>{self.line_width:g}</width></LineStyle>")
        if self.poly_color:
            parts.append(
                f"<PolyStyle><color>{self.poly_color}</color><fill>{int(bool(self.poly_fill))}</fill>"
                f"<outline>{int(bool(self.poly_outline))}</outline></PolyStyle>"
            )
        parts.append("</Style>")
        return "".join(parts)


class StyleManager:
    """Creates and caches shared KML styles."""

    def __init__(self, config: ConverterConfig):
        self.config = config
        self._style_cache: Dict[Tuple, KMLStyle] = {}

    @property
    def styles(self) -> List[KMLStyle]:
        return list(self._style_cache.values())

    def _get(self, key: Tuple, **fields) -> KMLStyle:
        style = self._style_cache.get(key)
        if style is None:
            style = KMLStyle(id=f"s{len(self._style_cache)}", **fields)
            self._style_cache[key] = style
        return style

    def get_color_kml(
        self,
        aci_color: Optional[int] = None,
        rgb_color: Optional[Tuple[int, int, int]] = None,
        layer_color: Optional[Tuple[int, int, int]] = None,
        alpha: int = 255
    ) -> str:
        """
        Determine KML hex color string (aabbggrr) based on DXF color hierarchy:
        1. RGB (true color, or already-resolved BYLAYER/BYBLOCK color) if provided
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
        return self.config.default_line_color.lower()

    def line_width(self, lineweight_mm: Optional[float]) -> float:
        base = lineweight_mm_to_px(lineweight_mm) if lineweight_mm and lineweight_mm > 0 else self.config.default_line_width
        return round(base * self.config.line_width_multiplier, 2)

    def get_line_style(self, kml_color: str, width: Optional[float] = None) -> KMLStyle:
        """LineString style. ``width`` is the DXF lineweight in mm (None = default width)."""
        w = self.line_width(width)
        return self._get(("line", kml_color, w), line_color=kml_color, line_width=w)

    def get_polygon_style(
        self,
        kml_color: str,
        width: Optional[float] = None,
        fill: Optional[bool] = None,
        fill_color: Optional[str] = None,
        fill_opacity: Optional[int] = None
    ) -> KMLStyle:
        """Polygon style with optional fill. ``width`` is in mm; the fill alpha is ``fill_opacity``."""
        w = self.line_width(width)
        should_fill = self.config.fill_polygons if fill is None else fill
        f_color = (fill_color or self.config.fill_color).lower()
        f_opacity = self.config.fill_opacity if fill_opacity is None else fill_opacity
        f_opacity = max(0, min(255, int(f_opacity)))
        if should_fill:
            poly_color = f"{f_opacity:02x}{f_color[2:]}" if len(f_color) == 8 else f_color
        else:
            poly_color = kml_color
        return self._get(
            ("poly", kml_color, w, bool(should_fill), poly_color),
            line_color=kml_color, line_width=w, poly_color=poly_color,
            poly_fill=bool(should_fill), poly_outline=True,
        )

    def get_point_style(
        self,
        kml_color: str,
        icon_scale: Optional[float] = None,
        icon_url: Optional[str] = None
    ) -> KMLStyle:
        scale = self.config.default_point_scale if icon_scale is None else icon_scale
        url = icon_url or self.config.point_icon_url
        return self._get(("point", kml_color, scale, url), icon_href=url, icon_scale=scale, icon_color=kml_color)

    def get_label_style(self, kml_color: str, label_scale: Optional[float] = None) -> KMLStyle:
        """Text label: invisible icon, colored label."""
        scale = self.config.default_label_scale if label_scale is None else label_scale
        return self._get(("label", kml_color, scale), icon_scale=0.0, label_color=kml_color, label_scale=scale)
