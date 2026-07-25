"""
Text and MTEXT processing, cleaning, and positioning.

Handles:
- AutoCAD MTEXT formatting code extraction (inline colors, heights, fonts)
- TEXT alignment point logic (halign/valign based)
- MTEXT attachment point offset calculation (1-9 anchor grid)
- Font family, bold/italic metadata preservation
"""

import re
from dataclasses import dataclass
from typing import Optional, Tuple
from loguru import logger
import ezdxf.entities


@dataclass
class LabelData:
    """Dataclass holding cleaned label entity metadata."""
    text: str
    position: Tuple[float, float, float]  # (x, y, z)
    rotation: float                       # rotation in degrees
    height: float                         # text height in drawing units
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None
    # Extended metadata for accurate rendering
    inline_color_aci: Optional[int] = None   # color override from MTEXT \C<n>;
    font_family: Optional[str] = None
    bold: bool = False
    italic: bool = False
    entity_type: str = "TEXT"                # "TEXT" or "MTEXT"


class MTextFormatResult:
    """Result of extracting MTEXT formatting codes before stripping them."""
    def __init__(self):
        self.clean_text: str = ""
        self.inline_color_aci: Optional[int] = None
        self.inline_height: Optional[float] = None
        self.font_family: Optional[str] = None
        self.bold: bool = False
        self.italic: bool = False


def extract_mtext_formatting(text: str) -> MTextFormatResult:
    """
    Extract useful formatting metadata from MTEXT codes, then clean the text.
    
    Extracts:
      \\C<n>; -> inline ACI color override
      \\H<value>; or \\H<value>x; -> inline height override (absolute or relative)
      \\f<FontName>|b<0|1>|i<0|1>|...; -> font family, bold, italic
    
    Then strips all remaining formatting codes for a clean text string.
    """
    result = MTextFormatResult()
    
    if not text:
        result.clean_text = ""
        return result

    # 1. Extract inline color: \C<number>;
    color_match = re.search(r"\\C(\d+);", text, flags=re.IGNORECASE)
    if color_match:
        try:
            result.inline_color_aci = int(color_match.group(1))
        except ValueError:
            pass

    # 2. Extract inline height: \H<number>; or \H<number>x;
    height_match = re.search(r"\\H([\d.]+)(x)?;", text, flags=re.IGNORECASE)
    if height_match:
        try:
            h_val = float(height_match.group(1))
            is_relative = height_match.group(2) is not None  # 'x' suffix = relative multiplier
            if is_relative:
                result.inline_height = h_val  # Store as multiplier, caller applies
            else:
                result.inline_height = h_val  # Absolute height
        except ValueError:
            pass

    # 3. Extract font specification: \f<FontName>|b<0|1>|i<0|1>|...;
    font_match = re.search(r"\\f([^|;]+)(?:\|b(\d))?(?:\|i(\d))?[^;]*;", text, flags=re.IGNORECASE)
    if font_match:
        result.font_family = font_match.group(1).strip()
        if font_match.group(2):
            result.bold = font_match.group(2) == "1"
        if font_match.group(3):
            result.italic = font_match.group(3) == "1"

    # 4. Now clean the text by stripping all formatting codes
    result.clean_text = clean_mtext(text)
    
    return result


def clean_mtext(text: str) -> str:
    """
    Remove AutoCAD MTEXT formatting codes.
    Examples stripped:
      \\P -> newline or space
      \\fFontName|...; -> font specification
      \\H1.5x; -> height specification
      \\C1; -> color specification
      \\A1; -> alignment specification
      \\W1.0; -> width factor
      \\Q0; -> obliquing angle
      \\T0; -> tracking
      {~, \\~} -> non-breaking space
      {} -> grouping braces
    """
    if not text:
        return ""

    # Replace \\P or \P (paragraph break) with newline or space
    text = re.sub(r"\\P", "\n", text, flags=re.IGNORECASE)

    # Remove font/height/color/alignment/width/obliquing/tracking formatting codes \f...; \H...; \C...; etc.
    text = re.sub(r"\\[fhcawqptFHCAWQPT][^;]*;", "", text)

    # Remove remaining backslash escape commands (like \\L...\l for underline, \\O...\o for overline)
    text = re.sub(r"\\[LloO]", "", text)

    # Remove braces used for MTEXT grouping
    text = re.sub(r"[{}]", "", text)

    # Replace non-breaking spaces \~ or ~ with space
    text = text.replace(r"\~", " ").replace("~", " ")

    # Remove extra spaces or trailing whitespace
    text = "\n".join(line.strip() for line in text.split("\n") if line.strip())

    return text.strip()


def _get_text_position(entity: ezdxf.entities.Text) -> Optional[Tuple[float, float, float]]:
    """
    Determine the correct insertion point for a TEXT entity based on its
    horizontal and vertical alignment settings.
    
    AutoCAD rule:
    - For left-aligned text (halign=0, valign=0), use 'insert' point.
    - For all other alignments (center, right, middle, fit, aligned),
      use 'align_point'.
    """
    try:
        halign = entity.dxf.get("halign", 0)
        valign = entity.dxf.get("valign", 0)
        
        if halign == 0 and valign == 0:
            # Left-aligned, baseline: use insert point
            if hasattr(entity.dxf, "insert") and entity.dxf.insert is not None:
                pos = entity.dxf.insert
                return (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
        else:
            # Any other alignment: use align_point
            if hasattr(entity.dxf, "align_point") and entity.dxf.align_point is not None:
                pos = entity.dxf.align_point
                return (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
            # Fallback to insert if align_point is not available
            if hasattr(entity.dxf, "insert") and entity.dxf.insert is not None:
                pos = entity.dxf.insert
                return (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
        
        # Final fallback
        if hasattr(entity.dxf, "insert") and entity.dxf.insert is not None:
            pos = entity.dxf.insert
            return (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
        
        return None
    except Exception:
        return None


def _calculate_mtext_center_offset(
    attachment_point: int,
    width: float,
    char_height: float,
    text: str
) -> Tuple[float, float]:
    """
    Calculate the (dx, dy) offset from the MTEXT insertion point to its visual center,
    based on the attachment_point setting (1-9).
    
    Attachment point grid:
      1=TopLeft      2=TopCenter      3=TopRight
      4=MiddleLeft   5=MiddleCenter   6=MiddleRight
      7=BottomLeft   8=BottomCenter   9=BottomRight
    
    The insertion point is the anchor specified by attachment_point.
    KML labels render from center, so we need to estimate where the center is.
    
    Returns (dx, dy) offset to add to insertion point to approximate center.
    """
    # Estimate total text height based on line count
    line_count = max(1, text.count("\n") + 1)
    total_height = char_height * line_count * 1.2  # 1.2x for line spacing
    
    # Horizontal offset from anchor to center
    dx = 0.0
    col = (attachment_point - 1) % 3  # 0=Left, 1=Center, 2=Right
    if col == 0:      # Left anchor
        dx = width / 2.0 if width > 0 else 0.0
    elif col == 1:    # Center anchor
        dx = 0.0
    elif col == 2:    # Right anchor
        dx = -(width / 2.0) if width > 0 else 0.0
    
    # Vertical offset from anchor to center
    dy = 0.0
    row = (attachment_point - 1) // 3  # 0=Top, 1=Middle, 2=Bottom
    if row == 0:      # Top anchor
        dy = -(total_height / 2.0)
    elif row == 1:    # Middle anchor
        dy = 0.0
    elif row == 2:    # Bottom anchor
        dy = total_height / 2.0
    
    return (dx, dy)


def parse_text_entity(entity: ezdxf.entities.Text) -> Optional[LabelData]:
    """Extract metadata from TEXT entity with correct alignment-based positioning."""
    try:
        raw_text = entity.dxf.text
        text = raw_text.strip()
        if not text:
            return None

        position = _get_text_position(entity)
        if position is None:
            return None

        rotation = float(entity.dxf.get("rotation", 0.0))
        height = float(entity.dxf.get("height", 1.0))
        layer = str(entity.dxf.get("layer", "0"))
        color_aci = entity.dxf.get("color", None)

        rgb_color = None
        if hasattr(entity.dxf, "true_color") and entity.dxf.true_color is not None:
            tc = entity.dxf.true_color
            rgb_color = ((tc >> 16) & 0xFF, (tc >> 8) & 0xFF, tc & 0xFF)

        # Extract font style name if available
        font_family = None
        try:
            style_name = entity.dxf.get("style", "Standard")
            if style_name and style_name != "Standard":
                font_family = style_name
        except Exception:
            pass

        return LabelData(
            text=text,
            position=position,
            rotation=rotation,
            height=height,
            layer=layer,
            color_aci=color_aci,
            rgb_color=rgb_color,
            font_family=font_family,
            entity_type="TEXT"
        )
    except Exception as e:
        logger.warning(f"Error parsing TEXT entity: {e}")
        return None


def parse_mtext_entity(entity: ezdxf.entities.MText) -> Optional[LabelData]:
    """Extract metadata from MTEXT entity with attachment point offset and inline formatting."""
    try:
        raw_text = entity.text if hasattr(entity, "text") else entity.plain_text()
        
        # Extract formatting metadata before cleaning
        fmt = extract_mtext_formatting(raw_text)
        text = fmt.clean_text
        if not text:
            return None

        pos = entity.dxf.insert
        base_x = float(pos.x)
        base_y = float(pos.y)
        base_z = float(pos.z if hasattr(pos, 'z') else 0.0)

        rotation = float(entity.dxf.get("rotation", 0.0))
        char_height = float(entity.dxf.get("char_height", 1.0))
        
        # Apply inline height override if extracted from formatting codes
        if fmt.inline_height is not None:
            char_height = fmt.inline_height * char_height if fmt.inline_height < 10 else fmt.inline_height

        layer = str(entity.dxf.get("layer", "0"))
        color_aci = entity.dxf.get("color", None)
        
        # Use inline color override if present and entity color is default
        inline_color_aci = fmt.inline_color_aci

        rgb_color = None
        if hasattr(entity.dxf, "true_color") and entity.dxf.true_color is not None:
            tc = entity.dxf.true_color
            rgb_color = ((tc >> 16) & 0xFF, (tc >> 8) & 0xFF, tc & 0xFF)

        # Calculate center offset based on MTEXT attachment point
        attachment_point = entity.dxf.get("attachment_point", 1)
        mtext_width = entity.dxf.get("width", 0)
        
        dx, dy = _calculate_mtext_center_offset(
            attachment_point=attachment_point,
            width=mtext_width,
            char_height=char_height,
            text=text
        )
        
        # Apply rotation to offset if text is rotated
        import math
        if rotation != 0:
            rad = math.radians(rotation)
            cos_r = math.cos(rad)
            sin_r = math.sin(rad)
            dx_rot = dx * cos_r - dy * sin_r
            dy_rot = dx * sin_r + dy * cos_r
            dx, dy = dx_rot, dy_rot
        
        position = (base_x + dx, base_y + dy, base_z)

        return LabelData(
            text=text,
            position=position,
            rotation=rotation,
            height=char_height,
            layer=layer,
            color_aci=color_aci,
            rgb_color=rgb_color,
            inline_color_aci=inline_color_aci,
            font_family=fmt.font_family,
            bold=fmt.bold,
            italic=fmt.italic,
            entity_type="MTEXT"
        )
    except Exception as e:
        logger.warning(f"Error parsing MTEXT entity: {e}")
        return None
