"""
Automated tests for GIS Workstation features: sample drawing delivery,
enhanced CSP tile sources, and end-to-end sample conversion validation.
"""

from pathlib import Path
from fastapi.testclient import TestClient
from web_app.app import app

client = TestClient(app)


def test_sample_file_endpoint():
    """Verify that /api/sample-file delivers the authentic sample drawing."""
    response = client.get("/api/sample-file")
    assert response.status_code == 200
    assert "Althur_padu_bund.dwg" in response.headers.get("content-disposition", "")
    assert len(response.content) > 50_000  # verified file is 56,239 bytes


def test_csp_allows_gis_basemap_providers():
    """Verify that Content Security Policy permits OpenStreetMap, CartoDB, and Esri basemaps."""
    response = client.get("/")
    assert response.status_code == 200
    csp = response.headers.get("content-security-policy", "")
    assert "https://tile.openstreetmap.org" in csp
    assert "https://server.arcgisonline.com" in csp
    assert "https://basemaps.cartocdn.com" in csp or "cartocdn.com" in csp


def test_sample_drawing_converts_through_pipeline():
    """Test that the sample drawing converts cleanly with real entities and stats."""
    sample_path = Path(__file__).resolve().parent.parent / "examples" / "Althur_padu_bund.dwg"
    assert sample_path.is_file(), "Sample DWG must exist in examples folder"

    with open(sample_path, "rb") as f:
        file_bytes = f.read()

    form_data = {
        "input_epsg": "EPSG:32644",
        "output_epsg": "EPSG:4326",
        "conversion_type": "raw",
        "merge_lines": "true",
        "ignore_large_polygons": "true",
        "export_text": "true",
        "export_points": "true",
        "output_format": "kml",
    }

    res = client.post(
        "/api/convert",
        files={"file": ("Althur_padu_bund.dwg", file_bytes, "application/acad")},
        data=form_data,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "job_id" in data
    assert "download_url" in data
    assert data["geojson"] is not None
    assert len(data["geojson"]["features"]) > 100

    stats = data["stats"]
    assert stats["total_entities"] == 174
    assert stats["labels"] == 67
    assert stats["points"] == 90

    # Verify CAD label rotations are faithfully exported in GeoJSON features
    text_features = {
        f["properties"]["title"]: f["properties"]
        for f in data["geojson"]["features"]
        if f["properties"].get("type") == "text"
    }
    assert "KM 0.700" in text_features
    assert round(text_features["KM 0.700"]["rotation"], 1) == 266.3
    assert "KM 1.000" in text_features
    assert round(text_features["KM 1.000"]["rotation"], 1) == 215.1


def test_label_orientation_defaults_to_cad():
    """Verify that index.html specifies CAD angle as the selected default."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.text
    assert '<option value="cad" selected>' in html
