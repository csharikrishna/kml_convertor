"""
Unit tests for text label cleaning and syntax parsing.
"""

from dxf2kml.labels import clean_mtext


def test_clean_mtext():
    """Test stripping AutoCAD MTEXT formatting tags."""
    raw = r"\fArial|b0|i0|c0|p34;\C1;\H1.5x;KM 0.500\PSecond Line"
    cleaned = clean_mtext(raw)
    assert cleaned == "KM 0.500\nSecond Line"


def test_clean_mtext_chainage():
    """Test chainage labels."""
    raw = r"T.E KM 1.500"
    cleaned = clean_mtext(raw)
    assert cleaned == "T.E KM 1.500"
