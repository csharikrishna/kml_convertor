"""
Text and MTEXT processing, cleaning, and positioning.
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
    height: float                         # text height
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None


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

    # Remove remaining backslash escape commands (like \\L...\\l for underline, \\O...\\o for overline)
    text = re.sub(r"\\[LloO]", "", text)

    # Remove braces used for MTEXT grouping
    text = re.sub(r"[{}]", "", text)

    # Replace non-breaking spaces \~ or ~ with space
    text = text.replace(r"\~", " ").replace("~", " ")

    # Remove extra spaces or trailing whitespace
    text = "\n".join(line.strip() for line in text.split("\n") if line.strip())

    return text.strip()


def parse_text_entity(entity: ezdxf.entities.Text) -> Optional[LabelData]:
    """Extract metadata from TEXT entity."""
    try:
        raw_text = entity.dxf.text
        text = raw_text.strip()
        if not text:
            return None

        # Determine insertion point (alignment point vs insert point)
        pos = None
        if hasattr(entity.dxf, "align_point") and entity.dxf.align_point is not None and entity.dxf.align_point != (0, 0, 0):
            pos = entity.dxf.align_point
        elif hasattr(entity.dxf, "insert") and entity.dxf.insert is not None:
            pos = entity.dxf.insert

        if pos is None:
            return None

        position = (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
        rotation = float(entity.dxf.get("rotation", 0.0))
        height = float(entity.dxf.get("height", 1.0))
        layer = str(entity.dxf.get("layer", "0"))
        color_aci = entity.dxf.get("color", None)

        rgb_color = None
        if hasattr(entity.dxf, "true_color") and entity.dxf.true_color is not None:
            tc = entity.dxf.true_color
            rgb_color = ((tc >> 16) & 0xFF, (tc >> 8) & 0xFF, tc & 0xFF)

        return LabelData(
            text=text,
            position=position,
            rotation=rotation,
            height=height,
            layer=layer,
            color_aci=color_aci,
            rgb_color=rgb_color
        )
    except Exception as e:
        logger.warning(f"Error parsing TEXT entity: {e}")
        return None


def parse_mtext_entity(entity: ezdxf.entities.MText) -> Optional[LabelData]:
    """Extract metadata from MTEXT entity."""
    try:
        raw_text = entity.text if hasattr(entity, "text") else entity.plain_text()
        text = clean_mtext(raw_text)
        if not text:
            return None

        pos = entity.dxf.insert
        position = (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
        rotation = float(entity.dxf.get("rotation", 0.0))
        height = float(entity.dxf.get("char_height", 1.0))
        layer = str(entity.dxf.get("layer", "0"))
        color_aci = entity.dxf.get("color", None)

        rgb_color = None
        if hasattr(entity.dxf, "true_color") and entity.dxf.true_color is not None:
            tc = entity.dxf.true_color
            rgb_color = ((tc >> 16) & 0xFF, (tc >> 8) & 0xFF, tc & 0xFF)

        return LabelData(
            text=text,
            position=position,
            rotation=rotation,
            height=height,
            layer=layer,
            color_aci=color_aci,
            rgb_color=rgb_color
        )
    except Exception as e:
        logger.warning(f"Error parsing MTEXT entity: {e}")
        return None
