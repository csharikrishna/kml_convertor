"""
Unit tests for Web Application API endpoints.
"""

from pathlib import Path
from fastapi.testclient import TestClient
import ezdxf

from web_app.app import app

client = TestClient(app)


def test_index_page():
    """Test web app root index page rendering."""
    response = client.get("/")
    assert response.status_code == 200
    assert "Convert DXF to KML Online" in response.text


def test_utm_zone_lookup():
    """Test UTM Zone lookup API endpoint."""
    # Latitude: 15.8, Longitude: 78.0 (UTM Zone 44N)
    response = client.post("/api/utm-zone", data={"lat": 15.8, "lon": 78.0})
    assert response.status_code == 200
    data = response.json()
    assert data["epsg"] == "EPSG:32644"
    assert "Zone 44" in data["description"]


def test_convert_endpoint(tmp_path: Path):
    """Test file upload conversion API endpoint."""
    dxf_file = tmp_path / "web_test.dxf"

    # Create dummy DXF
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((250000, 1900000), (250100, 1900000), dxfattribs={"layer": "Road"})
    msp.add_point((250050, 1900050), dxfattribs={"layer": "Points"})
    doc.saveas(str(dxf_file))

    with open(dxf_file, "rb") as f:
        response = client.post(
            "/api/convert",
            files={"file": ("web_test.dxf", f, "application/dxf")},
            data={
                "input_epsg": "EPSG:32644",
                "output_epsg": "EPSG:4326",
                "conversion_type": "raw",
                "merge_lines": True,
                "ignore_large_polygons": True,
                "label_scale": 0.5,
                "export_text": True,
                "export_points": True
            }
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "download_url" in data
    assert "geojson" in data
    assert data["geojson"]["type"] == "FeatureCollection"
