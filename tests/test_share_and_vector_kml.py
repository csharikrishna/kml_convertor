"""
Automated tests for Vector Ground Text KML generation and the Temporary Share Link lifecycle.
"""

import time
from pathlib import Path
from fastapi.testclient import TestClient
from web_app.app import app, _load_shares, _save_shares, _shares_lock

client = TestClient(app)


def test_vector_ground_text_kml_export():
    """Verify that KML export generates true 3D vector character polygons on ground."""
    sample_path = Path(__file__).resolve().parent.parent / "examples" / "Althur_padu_bund.dwg"
    assert sample_path.is_file()

    with open(sample_path, "rb") as f:
        file_bytes = f.read()

    form_data = {
        "input_epsg": "EPSG:32644",
        "output_epsg": "EPSG:4326",
        "export_text": "true",
        "export_points": "true",
        "kml_text_mode": "vector",
        "output_format": "kml",
    }

    res = client.post(
        "/api/convert",
        files={"file": ("Althur_padu_bund.dwg", file_bytes, "application/acad")},
        data=form_data,
    )
    assert res.status_code == 200
    data = res.json()
    job_id = data["job_id"]
    filename = data["filename"]

    # Download generated KML
    dl_res = client.get(f"/api/download/{job_id}/{filename}")
    assert dl_res.status_code == 200
    kml_text = dl_res.text

    # Verify vector ground geometry for labels
    assert "<MultiGeometry>" in kml_text
    assert "<Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>" in kml_text
    # Verify screen label scale 0 to suppress Google Earth horizontal text clutter
    assert "<LabelStyle><scale>0</scale></LabelStyle>" in kml_text or "<scale>0</scale>" in kml_text
    # Verify website preview is untouched
    assert data["geojson"] is not None
    text_previews = [f for f in data["geojson"]["features"] if f["properties"].get("type") == "text"]
    assert len(text_previews) > 0


def test_screen_label_kml_export():
    """Verify that screen text mode generates legible Google Earth Placemarks with transparent icon."""
    sample_path = Path(__file__).resolve().parent.parent / "examples" / "Althur_padu_bund.dwg"
    with open(sample_path, "rb") as f:
        file_bytes = f.read()

    form_data = {
        "input_epsg": "EPSG:32644",
        "output_epsg": "EPSG:4326",
        "export_text": "true",
        "export_points": "true",
        "kml_text_mode": "screen",
        "label_scale": "1.2",
        "output_format": "kml",
    }

    res = client.post(
        "/api/convert",
        files={"file": ("Althur_padu_bund.dwg", file_bytes, "application/acad")},
        data=form_data,
    )
    assert res.status_code == 200
    data = res.json()
    kml_text = client.get(f"/api/download/{data['job_id']}/{data['filename']}").text

    # Verify screen placemark with LabelStyle and transparent icon (no pushpin)
    assert "<Point>" in kml_text
    assert "trans.png" in kml_text
    assert "<LabelStyle>" in kml_text
    assert "</LabelStyle>" in kml_text


def test_temporary_share_link_lifecycle():
    """Test creating, accessing, downloading, and expiring temporary share links."""
    sample_path = Path(__file__).resolve().parent.parent / "examples" / "Althur_padu_bund.dwg"
    with open(sample_path, "rb") as f:
        file_bytes = f.read()

    res = client.post(
        "/api/convert",
        files={"file": ("Althur_padu_bund.dwg", file_bytes, "application/acad")},
        data={"input_epsg": "EPSG:32644", "output_epsg": "EPSG:4326", "export_text": "true"},
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]

    # 1. Create a share link for 48 hours
    share_res = client.post(
        "/api/share",
        data={"job_id": job_id, "expires_in_hours": "48"},
    )
    assert share_res.status_code == 200
    share_data = share_res.json()
    assert share_data["success"] is True
    share_id = share_data["share_id"]
    assert "/share/" in share_data["share_url"]
    assert share_data["expires_in_hours"] == 48

    # 2. Access the shared viewer page
    view_res = client.get(f"/share/{share_id}")
    assert view_res.status_code == 200
    assert "CAD2KML Pro Shared Map Workstation" in view_res.text
    assert share_id in view_res.text

    # 3. Fetch the shared preview GeoJSON
    geo_res = client.get(f"/api/share/{share_id}/geojson")
    assert geo_res.status_code == 200
    geo_data = geo_res.json()
    assert "features" in geo_data
    assert len(geo_data["features"]) > 100

    # 4. Download file via shared download endpoint
    dl_res = client.get(f"/api/share/{share_id}/download")
    assert dl_res.status_code == 200
    assert "attachment" in dl_res.headers.get("content-disposition", "")

    # 5. Simulate expiration
    with _shares_lock:
        shares = _load_shares()
        shares[share_id]["expires_at"] = time.time() - 100  # expired
        _save_shares(shares)

    expired_view_res = client.get(f"/share/{share_id}")
    assert expired_view_res.status_code == 410
    assert "Shared Link Expired" in expired_view_res.text

    expired_geo_res = client.get(f"/api/share/{share_id}/geojson")
    assert expired_geo_res.status_code == 410
