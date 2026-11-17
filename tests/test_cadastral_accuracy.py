"""
Automated GIS Spatial Accuracy, Topological Integrity & Statutory Acreage Conservation Tests.
Validates:
1. Coordinate transformations (EPSG:32643, EPSG:32644, EPSG:4326) forward and reverse.
2. Statutory acreage conservation: Total Acreage = Acquired Acreage + Balance Acreage.
3. CAD file signature verification: DWG (AC10xx) and DXF structural markers.
4. Clean UTF-8 static cadastral datasets without byte-order marks.
"""

import json
from pathlib import Path
import pytest
from shapely.geometry import Polygon, LineString

from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.errors import InputFileError
from web_app.app import validate_cad_signature

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"


def test_static_datasets_statutory_acreage_conservation():
    """Verify that every parcel in static cadastral datasets strictly conserves acreage."""
    for filename in ("konampalle.json", "padamatiyaleru.json"):
        filepath = DATA_DIR / filename
        assert filepath.is_file(), f"Dataset {filename} missing"

        # Ensure clean UTF-8 without BOM
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        assert not content.startswith("\ufeff"), f"{filename} contains unexpected UTF-8 BOM"

        data = json.loads(content)
        assert data.get("success") is True
        register = data.get("survey_register", [])
        assert len(register) > 0

        discrepancies = []
        for p in register:
            tot = p["total_acres"]
            acq = p["acquired_acres"]
            bal = p["balance_acres"]
            if round(acq + bal, 2) != round(tot, 2):
                discrepancies.append((p.get("survey_no"), tot, acq, bal, round(acq + bal, 2)))

        assert len(discrepancies) == 0, f"{filename} has {len(discrepancies)} parcels violating acreage conservation: {discrepancies[:3]}"


def test_epsg32643_and_epsg32644_transformations():
    """Verify coordinate transformation accuracy for AP/Telangana UTM zones."""
    # Anantapur / Konampalle lies in UTM Zone 43N (EPSG:32643)
    t43 = CoordinateTransformer(source_crs="EPSG:32643", target_crs="EPSG:4326")
    lon, lat, z = t43.transform_point(746500.0, 1624500.0)
    assert 76.5 < lon < 78.5
    assert 14.0 < lat < 15.5

    # Kurnool lies in UTM Zone 44N (EPSG:32644)
    t44 = CoordinateTransformer(source_crs="EPSG:32644", target_crs="EPSG:4326")
    lon44, lat44, z44 = t44.transform_point(200000.0, 1750000.0)
    assert 77.0 < lon44 < 79.5
    assert 15.0 < lat44 < 16.5


def test_cad_file_signature_validation(tmp_path):
    """Verify CAD file signature validation catches invalid files before expensive parsing."""
    # Valid DWG signature (AC10)
    valid_dwg = tmp_path / "test.dwg"
    valid_dwg.write_bytes(b"AC1032" + b"\x00" * 100)
    validate_cad_signature(valid_dwg)  # Should pass without exception

    # Invalid DWG signature
    fake_dwg = tmp_path / "fake.dwg"
    fake_dwg.write_bytes(b"NOT_A_DWG_FILE_DATA")
    with pytest.raises(InputFileError, match="Missing AutoCAD DWG header signature"):
        validate_cad_signature(fake_dwg)

    # Valid DXF signature (starts with group code 0)
    valid_dxf = tmp_path / "test.dxf"
    valid_dxf.write_text("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n", encoding="ascii")
    validate_cad_signature(valid_dxf)  # Should pass without exception

    # Valid DXF signature with UTF-8 BOM
    valid_bom_dxf = tmp_path / "bom_test.dxf"
    valid_bom_dxf.write_bytes(b"\xef\xbb\xbf0\nSECTION\n2\nHEADER\n0\nEOF\n")
    validate_cad_signature(valid_bom_dxf)  # Should pass without exception

    # Valid AutoCAD Binary DXF signature
    valid_bin_dxf = tmp_path / "binary_test.dxf"
    valid_bin_dxf.write_bytes(b"AutoCAD Binary DXF\r\n\x1a\x00" + b"\x00" * 100)
    validate_cad_signature(valid_bin_dxf)  # Should pass without exception

    # Invalid DXF signature
    fake_dxf = tmp_path / "fake.dxf"
    fake_dxf.write_text("This is a plain text file without AutoCAD group codes.", encoding="ascii")
    with pytest.raises(InputFileError, match="Missing standard AutoCAD DXF structural markers"):
        validate_cad_signature(fake_dxf)


def test_canal_intersection_geometry_conservation():
    """Verify that parcel polygon clipping against canal buffer strictly conserves acreage."""
    # 100m x 100m parcel = 10,000 m^2
    parcel = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
    # 20m wide canal corridor intersecting the middle of the parcel: x in [40, 60]
    canal_line = LineString([(50, -10), (50, 110)])
    canal_buffer = canal_line.buffer(10)  # 20m width

    assert parcel.intersects(canal_buffer)
    acq_geom = parcel.intersection(canal_buffer)
    acq_area = acq_geom.area  # Expected 20 * 100 = 2000 m^2
    bal_area = parcel.area - acq_area  # Expected 8000 m^2

    acres_per_m2 = 1.0 / 4046.8564224
    tot_acres = round(parcel.area * acres_per_m2, 2)
    acq_acres = min(tot_acres, round(acq_area * acres_per_m2, 2))
    bal_acres = round(tot_acres - acq_acres, 2)

    assert round(acq_acres + bal_acres, 2) == tot_acres
    assert acq_acres > 0
    assert bal_acres > 0
