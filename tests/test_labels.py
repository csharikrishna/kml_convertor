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
