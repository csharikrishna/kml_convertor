"""
Text and MTEXT processing, cleaning, and positioning.

Handles:
- AutoCAD MTEXT formatting code removal (a small tokenizer, not regex stripping,
  so escaped characters, stacked fractions and paragraph codes survive intact)
- TEXT control codes (%%d, %%c, %%p, %%nnn) and \\U+XXXX unicode escapes, which
  pre-R2007 DXF files use for every non-ASCII character (e.g. Telugu, Hindi)
- TEXT alignment point logic (halign/valign based), in WCS (TEXT points are OCS)
- MTEXT attachment point offset calculation (1-9 anchor grid)
- Font family, bold/italic metadata preservation
"""

import math
import re
from dataclasses import dataclass
from typing import Optional, Tuple
from loguru import logger


@dataclass
class LabelData:
    """Dataclass holding cleaned label entity metadata."""
    text: str
    position: Tuple[float, float, float]  # (x, y, z) in WCS
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
    entity_type: str = "TEXT"                # "TEXT", "MTEXT" or "ATTRIB"


class MTextFormatResult:
    """Result of extracting MTEXT formatting codes before stripping them."""
    def __init__(self):
        self.clean_text: str = ""
        self.inline_color_aci: Optional[int] = None
        self.inline_height: Optional[float] = None
        self.inline_height_relative: bool = False
        self.font_family: Optional[str] = None
        self.bold: bool = False
        self.italic: bool = False


# ---------------------------------------------------------------------------
# Low level decoding helpers
# ---------------------------------------------------------------------------

_DXF_UNICODE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")
_TEXT_PERCENT_CODE = re.compile(r"%%(\d{3}|[dDcCpPuUoOkK%])")
_PERCENT_SYMBOLS = {"d": "\u00b0", "c": "\u2300", "p": "\u00b1", "%": "%"}
# Formatting commands whose argument runs up to the next ';'
_MTEXT_ARG_COMMANDS = set("ACcFfHQTWp")
# Formatting toggles without arguments (underline, overline, strike-through)
_MTEXT_TOGGLES = set("LlOoKk")


def decode_dxf_unicode(text: str) -> str:
    """Decode ``\\U+XXXX`` escapes (including UTF-16 surrogate pairs) to characters."""
    if "\\U+" not in text and "\\u+" not in text:
        return text

    def _units(match: "re.Match[str]") -> str:
        return chr(int(match.group(1), 16))

    decoded = _DXF_UNICODE.sub(_units, text.replace("\\u+", "\\U+"))
    # Re-combine surrogate pairs produced by characters outside the BMP.
    try:
        return decoded.encode("utf-16", "surrogatepass").decode("utf-16")
    except UnicodeError:
        return decoded


def decode_text_codes(text: str) -> str:
    """Decode TEXT/ATTRIB control codes: %%d, %%c, %%p, %%%, %%nnn; drop %%u/%%o/%%k toggles."""
    if not text:
        return ""

    def _repl(match: "re.Match[str]") -> str:
        code = match.group(1)
        if code.isdigit():
            value = int(code)
            return chr(value) if 32 <= value < 256 else ""
        return _PERCENT_SYMBOLS.get(code.lower(), "")

    return decode_dxf_unicode(_TEXT_PERCENT_CODE.sub(_repl, text))


def clean_mtext(text: str) -> str:
    """
    Convert raw MTEXT content into plain text.

    Handles: \\P and \\N (line breaks), \\~ (non-breaking space), \\\\ \\{ \\} (escapes),
    \\S<a>^<b>; \\S<a>/<b>; \\S<a>#<b>; (stacked text -> "a/b"), argument commands
    (\\A \\C \\c \\F \\f \\H \\Q \\T \\W \\p ... up to ';'), toggles (\\L \\l \\O \\o \\K \\k),
    grouping braces, \\U+XXXX unicode escapes and %%d/%%c/%%p symbols.
    A literal '~' is preserved (it is only a non-breaking space when escaped).
    """
    if not text:
        return ""

    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            code = text[i + 1]
            if code in ("P", "N", "X"):
                out.append("\n")
                i += 2
            elif code == "~":
                out.append(" ")
                i += 2
            elif code in ("\\", "{", "}"):
                out.append(code)
                i += 2
            elif code in ("U", "u") and text[i + 2:i + 3] == "+":
                hexdigits = text[i + 3:i + 7]
                if len(hexdigits) == 4 and all(c in "0123456789abcdefABCDEF" for c in hexdigits):
                    out.append(chr(int(hexdigits, 16)))
                    i += 7
                else:
                    out.append(code)
                    i += 2
            elif code == "S":
                end = text.find(";", i + 2)
                if end == -1:
                    out.append(text[i + 2:])
                    break
                stacked = text[i + 2:end]
                parts = re.split(r"(?<!\\)[\^/#]", stacked, maxsplit=1)
                parts = [p.replace("\\", "").strip() for p in parts]
                out.append("/".join(p for p in parts if p))
                i = end + 1
            elif code in _MTEXT_ARG_COMMANDS:
                end = text.find(";", i + 2)
                i = n if end == -1 else end + 1
            elif code in _MTEXT_TOGGLES:
                i += 2
            else:
                # Unknown escape: keep the character itself.
                out.append(code)
                i += 2
        elif ch in "{}":
            i += 1
        elif ch == "^" and i + 1 < n and text[i + 1] in "IJM":
            # Caret-encoded control characters: ^I tab, ^J line feed, ^M carriage return
            out.append("\t" if text[i + 1] == "I" else "\n")
            i += 2
        else:
            out.append(ch)
            i += 1

    plain = decode_text_codes("".join(out)).replace("\u00a0", " ")
    lines = [line.strip() for line in plain.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def extract_mtext_formatting(text: str) -> MTextFormatResult:
    """
    Extract useful formatting metadata from MTEXT codes, then clean the text.

    Extracts (first occurrence only):
      \\C<n>;                  -> inline ACI color override
      \\H<value>; / \\H<value>x; -> inline absolute height / relative multiplier
      \\f<FontName>|b<0|1>|i<0|1>|...; -> font family, bold, italic
    """
    result = MTextFormatResult()

    if not text:
        result.clean_text = ""
        return result

    color_match = re.search(r"\\C(\d+);", text)
    if color_match:
        aci = int(color_match.group(1))
        if 1 <= aci <= 255:
            result.inline_color_aci = aci

    height_match = re.search(r"\\H(\d+(?:\.\d+)?|\.\d+)([xX])?;", text)
    if height_match:
        h_val = float(height_match.group(1))
        if h_val > 0:
            result.inline_height = h_val
            result.inline_height_relative = height_match.group(2) is not None

    font_match = re.search(r"\\[fF]([^|;]+)(?:\|b(\d))?(?:\|i(\d))?[^;]*;", text)
    if font_match:
        result.font_family = font_match.group(1).strip()
        if font_match.group(2):
            result.bold = font_match.group(2) == "1"
        if font_match.group(3):
            result.italic = font_match.group(3) == "1"

    result.clean_text = clean_mtext(text)
    return result


# ---------------------------------------------------------------------------
# Entity parsing
# ---------------------------------------------------------------------------

def _vec_to_tuple(vec) -> Tuple[float, float, float]:
    return (float(vec.x), float(vec.y), float(vec.z))


def _get_text_position(entity) -> Optional[Tuple[float, float, float]]:
    """
    Determine the WCS anchor point of a TEXT/ATTRIB entity.

    AutoCAD rule:
    - Left/baseline aligned text (halign=0, valign=0) is placed at 'insert'.
    - 'Aligned' (3) and 'Fit' (5) text spans insert -> align_point: use the midpoint.
    - All other alignments are anchored at 'align_point'.

    TEXT coordinates are stored in the entity's OCS; mirrored blocks produce an
    extrusion of (0, 0, -1), so they must be converted to WCS.
    """
    dxf = entity.dxf
    if not dxf.hasattr("insert"):
        return None
    halign = dxf.get("halign", 0)
    valign = dxf.get("valign", 0)
    insert = dxf.insert
    ocs_point = insert
    if (halign != 0 or valign != 0) and dxf.hasattr("align_point"):
        align = dxf.align_point
        if halign in (3, 5) and valign == 0:
            ocs_point = (insert + align) * 0.5
        else:
            ocs_point = align
    return _vec_to_tuple(entity.ocs().to_wcs(ocs_point))


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

    KML labels render from their anchor point, so we approximate the visual center.
    """
    if attachment_point not in range(1, 10):
        attachment_point = 1
    line_count = max(1, text.count("\n") + 1)
    total_height = char_height * line_count * 1.2  # 1.2x for line spacing

    col = (attachment_point - 1) % 3  # 0=Left, 1=Center, 2=Right
    dx = 0.0
    if width > 0:
        if col == 0:
            dx = width / 2.0
        elif col == 2:
            dx = -(width / 2.0)

    row = (attachment_point - 1) // 3  # 0=Top, 1=Middle, 2=Bottom
    dy = 0.0
    if row == 0:
        dy = -(total_height / 2.0)
    elif row == 2:
        dy = total_height / 2.0

    return (dx, dy)


def parse_text_entity(entity) -> Optional[LabelData]:
    """Extract metadata from a TEXT or ATTRIB entity with alignment-correct WCS positioning."""
    try:
        if entity.dxftype() == "ATTRIB" and getattr(entity, "has_embedded_mtext_entity", False):
            label = parse_mtext_entity(entity.virtual_mtext_entity())
            if label is not None:
                label.entity_type = "ATTRIB"
            return label

        text = decode_text_codes(entity.dxf.get("text", "") or "").strip()
        if not text:
            return None

        position = _get_text_position(entity)
        if position is None:
            return None

        style_name = entity.dxf.get("style", "Standard")
        return LabelData(
            text=text,
            position=position,
            rotation=float(entity.dxf.get("rotation", 0.0)),
            height=float(entity.dxf.get("height", 1.0)),
            layer=str(entity.dxf.get("layer", "0")),
            color_aci=entity.dxf.get("color", None),
            font_family=style_name if style_name and style_name != "Standard" else None,
            entity_type=entity.dxftype(),
        )
    except Exception as e:
        logger.warning(f"Error parsing {entity.dxftype()} entity (handle={entity.dxf.get('handle')}): {e}")
        return None


def parse_mtext_entity(entity) -> Optional[LabelData]:
    """Extract metadata from MTEXT entity with attachment point offset and inline formatting."""
    try:
        fmt = extract_mtext_formatting(entity.text)
        text = fmt.clean_text
        if not text:
            return None

        pos = entity.dxf.insert  # MTEXT insert is stored in WCS
        rotation = float(entity.get_rotation())  # honours text_direction as well as rotation
        char_height = float(entity.dxf.get("char_height", 1.0))

        if fmt.inline_height is not None:
            char_height = fmt.inline_height * char_height if fmt.inline_height_relative else fmt.inline_height

        dx, dy = _calculate_mtext_center_offset(
            attachment_point=entity.dxf.get("attachment_point", 1),
            width=float(entity.dxf.get("width", 0) or 0),
            char_height=char_height,
            text=text
        )

        if rotation != 0:
            rad = math.radians(rotation)
            cos_r, sin_r = math.cos(rad), math.sin(rad)
            dx, dy = dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r

        return LabelData(
            text=text,
            position=(float(pos.x) + dx, float(pos.y) + dy, float(pos.z)),
            rotation=rotation,
            height=char_height,
            layer=str(entity.dxf.get("layer", "0")),
            color_aci=entity.dxf.get("color", None),
            inline_color_aci=fmt.inline_color_aci,
            font_family=fmt.font_family,
            bold=fmt.bold,
            italic=fmt.italic,
            entity_type="MTEXT"
        )
    except Exception as e:
        logger.warning(f"Error parsing MTEXT entity (handle={entity.dxf.get('handle')}): {e}")
        return None
