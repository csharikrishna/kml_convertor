"""
Web application tests: API contract, validation, file lifecycle, security and concurrency.
"""

import re
import threading
import time
from pathlib import Path

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import web_app.app as web
from web_app.app import app

client = TestClient(app)


def _dxf_bytes(tmp_path: Path, name="web_test.dxf", text=None) -> bytes:
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((250000, 1900000), (250100, 1900000), dxfattribs={"layer": "Road"})
    msp.add_point((250050, 1900050), dxfattribs={"layer": "Points"})
    if text:
        msp.add_text(text, dxfattribs={"insert": (250010, 1900010), "layer": "Text"})
    path = tmp_path / name
    doc.saveas(str(path))
    return path.read_bytes()


def _post(content: bytes, filename="web_test.dxf", **data):
    form = {"input_epsg": "EPSG:32644", "output_epsg": "EPSG:4326", "conversion_type": "raw"}
    form.update({k: str(v) for k, v in data.items()})
    return client.post("/api/convert", files={"file": (filename, content, "application/dxf")}, data=form)


# --------------------------------------------------------------------------- pages & metadata

def test_index_page_is_hardened():
    response = client.get("/")
    assert response.status_code == 200
    assert "Convert DXF to KML Online" in response.text
    csp = response.headers["content-security-policy"]
    assert "script-src 'self' https://unpkg.com;" in csp  # no 'unsafe-inline' scripts
    assert response.headers["x-content-type-options"] == "nosniff"
    assert not re.search(r"\son[a-z]+=\"", response.text), "inline event handlers break the CSP"
    assert 'integrity="sha256-' in response.text
    assert f"Max {web.MAX_UPLOAD_BYTES // 2**20} MB" in response.text


def test_health_reports_capabilities_and_counters():
    data = client.get("/health").json()
    assert data["status"] == "healthy"
    assert isinstance(data["dwg_supported"], bool)
    assert {"succeeded", "failed", "active"} <= set(data["conversions"])
    assert "temp_files_cached" in data


@pytest.mark.parametrize("lat, lon, epsg, zone_text", [
    (15.8, 78.0, "EPSG:32644", "Zone 44"),
    (-33.9, 18.4, "EPSG:32734", "Zone 34"),
    (10.0, 180.0, "EPSG:32660", "Zone 60"),     # lon=180 must not become zone 61
    (60.0, 5.0, "EPSG:32632", "Zone 32"),       # Norway exception
    (78.0, 15.0, "EPSG:32633", "Zone 33"),      # Svalbard exception
    (40.7, -74.0, "EPSG:32618", "Zone 18"),
])
def test_utm_zone_lookup(lat, lon, epsg, zone_text):
    response = client.post("/api/utm-zone", data={"lat": lat, "lon": lon})
    assert response.status_code == 200
    assert response.json()["epsg"] == epsg
    assert zone_text in response.json()["description"]


def test_utm_zone_rejects_polar_latitudes():
    assert client.post("/api/utm-zone", data={"lat": 85, "lon": 0}).status_code == 400


# --------------------------------------------------------------------------- conversion contract

def test_convert_and_download(tmp_path):
    response = _post(_dxf_bytes(tmp_path))
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["geojson"]["type"] == "FeatureCollection"
    assert data["stats"]["polylines"] == 1 and data["stats"]["points"] == 1
    assert data["warnings"] == []
    download = client.get(data["download_url"])
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/vnd.google-earth.kml+xml")
    assert "attachment" in download.headers["content-disposition"]
    assert download.content.startswith(b"<?xml")


def test_uploaded_drawing_is_deleted_after_conversion(tmp_path):
    data = _post(_dxf_bytes(tmp_path), output_format="kmz").json()
    job_dir = web.TEMP_STORAGE / data["job_id"]
    assert [p.name for p in job_dir.iterdir()] == [data["filename"]]
    assert data["filename"].endswith(".kmz")


def test_unicode_filename_is_preserved(tmp_path):
    data = _post(_dxf_bytes(tmp_path), filename="సర్వే నం 42.dxf").json()
    assert data["filename"] == "సర్వే_నం_42.kml"
    assert client.get(data["download_url"]).status_code == 200


def test_standard_mode_excludes_text_and_points(tmp_path):
    data = _post(_dxf_bytes(tmp_path, text="LABEL"), conversion_type="standard").json()
    assert data["stats"]["labels"] == 0 and data["stats"]["points"] == 0


@pytest.mark.parametrize("field, value", [
    ("input_epsg", "not-a-crs"),
    ("input_epsg", "+proj=longlat +init=/etc/passwd"),
    ("output_epsg", "EPSG:3857"),
    ("fill_color", "red"),
    ("fill_opacity", "2"),
    ("output_format", "shp"),
    ("conversion_type", "weird"),
])
def test_invalid_options_are_rejected(tmp_path, field, value):
    response = _post(_dxf_bytes(tmp_path), **{field: value})
    assert response.status_code == 400, response.text


def test_wrong_extension_rejected():
    assert _post(b"hello", filename="notes.txt").status_code == 400


@pytest.mark.parametrize("content", [b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4, b"PK\x03\x04garbage", b""])
def test_non_cad_file_gives_safe_400(content):
    response = _post(content, filename="broken.dxf")
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert str(web.TEMP_STORAGE) not in detail and "Traceback" not in detail


def test_structurally_empty_dxf_succeeds_with_warning():
    # ezdxf's recovery reader turns this into an empty drawing: not an error, but flagged.
    response = _post(b"0\nSECTION\n2\nGARBAGE\n" * 50, filename="empty.dxf")
    assert response.status_code == 200
    assert any("no convertible geometry" in w for w in response.json()["warnings"])


def test_dwg_without_converter_is_422(monkeypatch):
    monkeypatch.setattr("dxf2kml.dwg.find_oda_converter", lambda: None)
    response = _post(b"AC1032" + b"\x00" * 100, filename="plan.dwg")
    assert response.status_code == 422
    assert "DXF" in response.json()["detail"]


def test_unexpected_error_is_500_without_internals(tmp_path, monkeypatch):
    def explode(*_a, **_k):
        raise RuntimeError(r"secret C:\internal\path")

    monkeypatch.setattr(web, "convert", explode)
    response = _post(_dxf_bytes(tmp_path))
    assert response.status_code == 500
    assert "secret" not in response.text and "reference" in response.json()["detail"]


def test_local_coordinates_warn(tmp_path):
    doc = ezdxf.new("R2010")
    doc.modelspace().add_line((0, 0), (100, 100))
    path = tmp_path / "local.dxf"
    doc.saveas(path)
    data = _post(path.read_bytes()).json()
    assert any("area of use" in w for w in data["warnings"])


# --------------------------------------------------------------------------- download security

def test_download_rejects_wildcards_and_traversal(tmp_path):
    data = _post(_dxf_bytes(tmp_path)).json()
    name = data["filename"]
    for url in [f"/api/download/*/{name}", "/api/download/*/*.kml", f"/api/download/{'?' * 32}/{name}",
                f"/api/download/{data['job_id']}/..%2F..%2Fsecret.kml", f"/api/download/{data['job_id']}/other.kml",
                f"/api/download/{data['job_id'][:-1]}g/{name}"]:
        assert client.get(url).status_code == 404, url


def test_expired_output_is_not_served(tmp_path, monkeypatch):
    data = _post(_dxf_bytes(tmp_path)).json()
    monkeypatch.setattr(web, "OUTPUT_TTL", -1)
    assert client.get(data["download_url"]).status_code == 404


def test_cleanup_removes_expired_jobs(tmp_path):
    data = _post(_dxf_bytes(tmp_path)).json()
    job_dir = web.TEMP_STORAGE / data["job_id"]
    assert job_dir.exists()
    web.cleanup_temp_files(max_age_seconds=-1)
    assert not job_dir.exists()


# --------------------------------------------------------------------------- resource limits & concurrency

def test_upload_size_limit_in_copy(tmp_path, monkeypatch):
    monkeypatch.setattr(web, "MAX_UPLOAD_BYTES", 1000)
    response = _post(_dxf_bytes(tmp_path))
    assert response.status_code == 413


def test_body_size_middleware_rejects_streamed_and_declared_bodies():
    inner = FastAPI()

    @inner.post("/api/convert")
    async def echo(request: web.Request):
        return {"n": len(await request.body())}

    limited = web.BodySizeLimitMiddleware(inner, max_bytes=10, paths=("/api/convert",))
    c = TestClient(limited)
    assert c.post("/api/convert", content=b"x" * 100).status_code == 200  # within framing allowance
    assert c.post("/api/convert", content=b"x" * 200_000).status_code == 413

    def chunks():
        for _ in range(100):
            yield b"x" * 10_000

    assert c.post("/api/convert", content=chunks()).status_code == 413  # no Content-Length


def test_busy_server_returns_503(tmp_path, monkeypatch):
    exhausted = threading.BoundedSemaphore(1)
    exhausted.acquire()
    monkeypatch.setattr(web, "_slots", exhausted)
    response = _post(_dxf_bytes(tmp_path))
    assert response.status_code == 503 and response.headers["retry-after"]


def test_conversion_does_not_block_event_loop(tmp_path, monkeypatch):
    real_convert = web.convert

    def slow_convert(*args, **kwargs):
        time.sleep(2.0)
        return real_convert(*args, **kwargs)

    monkeypatch.setattr(web, "convert", slow_convert)
    content = _dxf_bytes(tmp_path)
    worker = threading.Thread(target=lambda: _post(content))
    worker.start()
    time.sleep(0.3)
    t = time.monotonic()
    assert client.get("/health").status_code == 200
    assert time.monotonic() - t < 1.0, "health check waited for the conversion"
    worker.join()
