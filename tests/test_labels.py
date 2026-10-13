"""
Unit tests for text label cleaning and syntax parsing.
"""

import pytest

from dxf2kml.labels import clean_mtext, decode_text_codes, decode_dxf_unicode, extract_mtext_formatting


def test_clean_mtext():
    """Test stripping AutoCAD MTEXT formatting tags."""
    raw = r"\fArial|b0|i0|c0|p34;\C1;\H1.5x;KM 0.500\PSecond Line"
    assert clean_mtext(raw) == "KM 0.500\nSecond Line"


def test_clean_mtext_chainage():
    assert clean_mtext(r"T.E KM 1.500") == "T.E KM 1.500"


@pytest.mark.parametrize("raw, expected", [
    (r"\pxqc;Centred", "Centred"),                     # paragraph formatting (lower-case p)
    (r"\pi-3,l3,t4;Indented", "Indented"),
    (r"A\S1/2;B", "A1/2B"),                            # stacked fraction
    (r"\S+0.1^-0.1;", "+0.1/-0.1"),                    # tolerance stack
    (r"\S3#4;", "3/4"),                                # diagonal stack
    (r"50~60", "50~60"),                               # literal tilde is text
    (r"50\~60", "50 60"),                              # escaped tilde = non-breaking space
    (r"\{braces\} and \\backslash", "{braces} and \\backslash"),
    (r"{\LUnder}{\Oover}{\Kstrike}", "Underoverstrike"),
    (r"\U+0C38\U+0C30\U+0C4D\U+0C35\U+0C47", "సర్వే"),  # Telugu via DXF unicode escapes
    (r"Line1\NColumn2", "Line1\nColumn2"),
    (r"45%%d %%p0.5 %%c20", "45° ±0.5 ⌀20"),
    (r"\A1;\T1.1;\W0.8;\Q15;Text", "Text"),
    (r"unterminated \H2.5", "unterminated"),
    ("", ""),
])
def test_clean_mtext_cases(raw, expected):
    assert clean_mtext(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    ("45%%d", "45°"),
    ("%%c100", "⌀100"),
    ("%%p0.5", "±0.5"),
    ("100%%%", "100%"),
    ("%%uUnderlined%%u", "Underlined"),
    ("%%065BC", "ABC"),
    ("plain", "plain"),
])
def test_decode_text_codes(raw, expected):
    assert decode_text_codes(raw) == expected


def test_decode_dxf_unicode_surrogate_pair():
    # U+1F600 encoded as a UTF-16 surrogate pair in \U+ escapes
    assert decode_dxf_unicode(r"\U+D83D\U+DE00") == "\U0001F600"
    assert decode_dxf_unicode("no escapes") == "no escapes"


def test_mtext_height_absolute_vs_relative():
    absolute = extract_mtext_formatting(r"\H0.5;small")
    relative = extract_mtext_formatting(r"\H0.5x;small")
    assert (absolute.inline_height, absolute.inline_height_relative) == (0.5, False)
    assert (relative.inline_height, relative.inline_height_relative) == (0.5, True)


def test_mtext_inline_color_and_font():
    fmt = extract_mtext_formatting(r"{\fArial|b1|i1;\C3;Bold green}")
    assert fmt.inline_color_aci == 3
    assert (fmt.font_family, fmt.bold, fmt.italic) == ("Arial", True, True)
    assert fmt.clean_text == "Bold green"


def test_mtext_inline_height_applied(new_doc, parse_doc):
    doc, msp = new_doc()
    msp.add_mtext(r"\H0.5;abs", dxfattribs={"insert": (0, 0), "char_height": 2.5})
    msp.add_mtext(r"\H2x;rel", dxfattribs={"insert": (0, 0), "char_height": 2.5})
    heights = {lbl.text: lbl.height for lbl in parse_doc(doc).labels}
    assert heights == {"abs": 0.5, "rel": 5.0}


def test_mtext_rotation_from_text_direction(new_doc, parse_doc):
    doc, msp = new_doc()
    mt = msp.add_mtext("up", dxfattribs={"insert": (0, 0)})
    mt.dxf.text_direction = (0, 1, 0)
    assert parse_doc(doc).labels[0].rotation == pytest.approx(90)


def test_text_alignment_anchors(new_doc, parse_doc):
    """Test that TEXT halign and valign yield correct anchor_x and anchor_y."""
    doc, msp = new_doc()
    # Left-baseline
    msp.add_text("left_base", dxfattribs={"insert": (0, 0), "halign": 0, "valign": 0})
    # Center-middle
    msp.add_text("center_mid", dxfattribs={"insert": (10, 10), "align_point": (10, 10), "halign": 1, "valign": 2})
    # Right-middle
    msp.add_text("right_mid", dxfattribs={"insert": (20, 20), "align_point": (20, 20), "halign": 2, "valign": 2})
    # Middle (halign=4)
    msp.add_text("mid_mid", dxfattribs={"insert": (30, 30), "align_point": (30, 30), "halign": 4, "valign": 0})

    labels = {lbl.text: lbl for lbl in parse_doc(doc).labels}
    assert labels["left_base"].anchor_x == 0.0
    assert labels["left_base"].anchor_y == 0.8
    assert labels["center_mid"].anchor_x == 0.5
    assert labels["center_mid"].anchor_y == 0.5
    assert labels["right_mid"].anchor_x == 1.0
    assert labels["right_mid"].anchor_y == 0.5
    assert labels["mid_mid"].anchor_x == 0.5
    assert labels["mid_mid"].anchor_y == 0.5


def test_mtext_attachment_point_anchors(new_doc, parse_doc):
    """Test that MTEXT attachment points (1-9) yield exact anchor_x and anchor_y."""
    doc, msp = new_doc()
    # 1=TopLeft, 5=MiddleCenter, 9=BottomRight
    msp.add_mtext("top_left", dxfattribs={"insert": (0, 0), "attachment_point": 1})
    msp.add_mtext("mid_center", dxfattribs={"insert": (10, 10), "attachment_point": 5})
    msp.add_mtext("bot_right", dxfattribs={"insert": (20, 20), "attachment_point": 9})

    labels = {lbl.text: lbl for lbl in parse_doc(doc).labels}
    assert labels["top_left"].anchor_x == 0.0
    assert labels["top_left"].anchor_y == 0.0
    assert labels["mid_center"].anchor_x == 0.5
    assert labels["mid_center"].anchor_y == 0.5
    assert labels["bot_right"].anchor_x == 1.0
    assert labels["bot_right"].anchor_y == 1.0


def test_mtext_insertion_point_preserved(new_doc, parse_doc):
    """Test that MTEXT insertion point is not displaced by width offset."""
    doc, msp = new_doc()
    msp.add_mtext("exact_loc", dxfattribs={"insert": (123.45, 678.90, 0.0), "width": 500.0, "attachment_point": 1})
    lbl = parse_doc(doc).labels[0]
    assert lbl.position[0] == pytest.approx(123.45)
    assert lbl.position[1] == pytest.approx(678.90)


def test_text_rotation_with_extrusion(new_doc, parse_doc):
    """Test that mirrored TEXT with extrusion (0, 0, -1) calculates correct WCS rotation."""
    doc, msp = new_doc()
    msp.add_text("mirrored", dxfattribs={"insert": (0, 0), "rotation": 45.0, "extrusion": (0, 0, -1)})
    lbl = parse_doc(doc).labels[0]
    assert lbl.rotation == pytest.approx(135.0)

