"""
FastAPI Web Server for the DXF/DWG to KML/KMZ converter.

Request flow (POST /api/convert):
  body-size limit (ASGI middleware, 413) -> form validation (400) -> concurrency slot (503)
  -> per-job directory -> upload copied with byte cap -> dxf2kml.pipeline.convert() in a
  worker thread (the event loop stays responsive) -> input deleted immediately ->
  output kept for OUTPUT_TTL_SECONDS and served by GET /api/download/{job_id}/{filename}.

Configuration (environment variables, defaults sized for a 512 MB instance):
  MAX_UPLOAD_MB=25  MAX_ENTITIES=500000  MAX_VERTICES=2000000  CONVERSION_TIMEOUT_SECONDS=120
  MAX_CONCURRENT_CONVERSIONS=1  OUTPUT_TTL_SECONDS=3600  PREVIEW_MAX_VERTICES=150000
  DXF2KML_TEMP_DIR=<system temp>/dxf2kml_web  LOG_LEVEL=INFO  LOG_JSON=0
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import quote

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger
from pydantic import ValidationError
from starlette.requests import Request

from dxf2kml import __version__
from dxf2kml.config import ConverterConfig
from dxf2kml.dwg import is_dwg_supported
from dxf2kml.errors import ConversionError, CRSError, DWGConversionError, InputFileError, LimitExceededError
from dxf2kml.pipeline import convert
from dxf2kml.transformer import normalize_crs_input, parse_crs
from dxf2kml.utils import css_hex_to_rgb, rgb_to_kml_hex


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


MAX_UPLOAD_BYTES = _env_int("MAX_UPLOAD_MB", 25) * 1024 * 1024
MAX_ENTITIES = _env_int("MAX_ENTITIES", 500_000)
MAX_VERTICES = _env_int("MAX_VERTICES", 2_000_000)
CONVERSION_TIMEOUT = _env_int("CONVERSION_TIMEOUT_SECONDS", 120)
MAX_CONCURRENT = max(1, _env_int("MAX_CONCURRENT_CONVERSIONS", 1))
OUTPUT_TTL = _env_int("OUTPUT_TTL_SECONDS", 3600)
PREVIEW_MAX_VERTICES = _env_int("PREVIEW_MAX_VERTICES", 150_000)

BASE_DIR = Path(__file__).resolve().parent
TEMP_STORAGE = Path(os.environ.get("DXF2KML_TEMP_DIR") or Path(tempfile.gettempdir()) / "dxf2kml_web")
TEMP_STORAGE.mkdir(parents=True, exist_ok=True)

_JOB_ID = re.compile(r"^[0-9a-f]{32}$")
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_metrics_lock = threading.Lock()
_metrics: Dict[str, int] = {"succeeded": 0, "failed": 0, "rejected_busy": 0, "active": 0}
_failures_by_type: Dict[str, int] = {}

if os.environ.get("LOG_JSON", "0") == "1":
    logger.remove()
    logger.add(sys.stderr, serialize=True, level=os.environ.get("LOG_LEVEL", "INFO"))


def _count(key: str, delta: int = 1) -> None:
    with _metrics_lock:
        _metrics[key] = _metrics.get(key, 0) + delta


def cleanup_temp_files(max_age_seconds: int = OUTPUT_TTL) -> int:
    """Remove job directories (and stray files) older than ``max_age_seconds``."""
    now = time.time()
    removed = 0
    for item in TEMP_STORAGE.iterdir():
        try:
            if now - item.stat().st_mtime <= max_age_seconds:
                continue
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
            removed += 1
        except OSError as ex:
            logger.warning(f"Failed to delete expired temp item {item.name}: {ex}")
    if removed:
        logger.info(f"Cleaned up {removed} expired conversion job(s).")
    return removed


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cleanup_temp_files()
    logger.info(
        f"dxf2kml web {__version__} ready: max_upload={MAX_UPLOAD_BYTES // 2**20} MB, "
        f"concurrency={MAX_CONCURRENT}, timeout={CONVERSION_TIMEOUT}s, dwg_supported={is_dwg_supported()}"
    )
    yield


app = FastAPI(title="DXF to KML Online Converter API", version=__version__, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# --------------------------------------------------------------------------- middleware

class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject request bodies above ``max_bytes`` with 413 - checked on Content-Length and while streaming."""

    def __init__(self, app, max_bytes: int, paths: Tuple[str, ...]):
        self.app = app
        self.max_bytes = max_bytes
        self.paths = paths

    async def _reject(self, send) -> None:
        body = json.dumps({"detail": f"File too large. The maximum upload size is {self.max_bytes // 2**20} MB."}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] not in self.paths:
            return await self.app(scope, receive, send)

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.max_bytes + 64 * 1024:  # multipart framing overhead
                        return await self._reject(send)
                except ValueError:
                    return await self._reject(send)

        received = 0
        too_large = False
        response_started = False

        async def limited_receive():
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes + 64 * 1024:
                    too_large = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message):
            nonlocal response_started
            if too_large:
                return  # the inner app's (error) response is replaced by our 413
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            pass
        if too_large and not response_started:
            await self._reject(send)


SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"x-frame-options", b"DENY"),
]
PAGE_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://unpkg.com; "
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "img-src 'self' data: https://unpkg.com https://server.arcgisonline.com; "
    "connect-src 'self' https://nominatim.openstreetmap.org; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", [])) + SECURITY_HEADERS
                if scope["path"] == "/":
                    headers.append((b"content-security-policy", PAGE_CSP.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_UPLOAD_BYTES, paths=("/api/convert",))
app.add_middleware(SecurityHeadersMiddleware)


# --------------------------------------------------------------------------- helpers

def calculate_utm_epsg(lat: float, lon: float) -> Tuple[int, str]:
    """UTM zone EPSG code (WGS84) and description, including the Norway/Svalbard exceptions."""
    if not (-80.0 <= lat <= 84.0):
        raise ValueError("UTM is only defined between 80°S and 84°N (use UPS for polar regions).")
    if not (-180.0 <= lon <= 180.0):
        raise ValueError("Longitude must be between -180 and 180.")
    zone = min(60, int((lon + 180.0) // 6) + 1)
    if 56.0 <= lat < 64.0 and 3.0 <= lon < 12.0:
        zone = 32  # south-west Norway
    elif 72.0 <= lat <= 84.0 and lon >= 0.0:  # Svalbard
        if lon < 9.0:
            zone = 31
        elif lon < 21.0:
            zone = 33
        elif lon < 33.0:
            zone = 35
        elif lon < 42.0:
            zone = 37
    northern = lat >= 0
    epsg_code = (32600 if northern else 32700) + zone
    lon_min = (zone - 1) * 6 - 180

    def fmt(value: int) -> str:
        return f"{abs(value)}°{'E' if value >= 0 else 'W'}"

    desc = f"Zone {zone} ({fmt(lon_min)} - {fmt(lon_min + 6)} - {'Northern' if northern else 'Southern'} Hemisphere)"
    return epsg_code, desc


_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*%;\s]+')


def _safe_stem(filename: str) -> str:
    """
    Filesystem- and header-safe base name. Only unsafe characters are replaced, so
    Indic scripts keep their combining marks (\\w would turn "సర్వే" into "సర_వ").
    """
    stem = Path(filename.replace("\\", "/").split("/")[-1]).stem
    stem = _UNSAFE_FILENAME_CHARS.sub("_", stem).strip("._-")
    return stem[:80] or "drawing"


def _copy_upload(upload: UploadFile, dest: Path) -> int:
    """Copy the upload to ``dest`` enforcing MAX_UPLOAD_BYTES (defence in depth)."""
    written = 0
    with open(dest, "wb") as out:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                raise LimitExceededError(f"File too large. The maximum upload size is {MAX_UPLOAD_BYTES // 2**20} MB.")
            out.write(chunk)
    return written


_ERROR_STATUS = {InputFileError: 400, CRSError: 400, DWGConversionError: 422, LimitExceededError: 413}


def _status_for(ex: ConversionError) -> int:
    for cls, status in _ERROR_STATUS.items():
        if isinstance(ex, cls):
            return status
    return 422


# --------------------------------------------------------------------------- routes

@app.get("/health", tags=["Health"])
def health_check():
    """Health check endpoint for container probes and load balancers."""
    with _metrics_lock:
        metrics = dict(_metrics)
        failures = dict(_failures_by_type)
    return {
        "status": "healthy",
        "service": "dxf2kml-api",
        "version": __version__,
        "dwg_supported": is_dwg_supported(),
        "temp_files_cached": sum(1 for _ in TEMP_STORAGE.iterdir()),
        "conversions": {**metrics, "failed_by_type": failures},
        "limits": {"max_upload_mb": MAX_UPLOAD_BYTES // 2**20, "timeout_seconds": CONVERSION_TIMEOUT,
                   "max_concurrent": MAX_CONCURRENT},
    }


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204, content=b"")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index(request: Request):
    """Render main web application interface."""
    return templates.TemplateResponse(
        request=request, name="index.html",
        context={"max_upload_mb": MAX_UPLOAD_BYTES // 2**20, "dwg_supported": is_dwg_supported(),
                 "version": __version__},
    )


@app.post("/api/convert")
def convert_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    input_epsg: str = Form("EPSG:32644"),
    output_epsg: str = Form("EPSG:4326"),
    conversion_type: str = Form("raw"),  # "standard" or "raw"
    merge_lines: bool = Form(True),
    ignore_large_polygons: bool = Form(True),
    label_scale: float = Form(0.5),
    export_text: bool = Form(True),
    export_points: bool = Form(True),
    auto_scale_text: bool = Form(True),
    fill_polygons: bool = Form(False),
    fill_color: str = Form("#ff0000"),
    fill_opacity: float = Form(0.3),
    output_format: str = Form("kml"),
):
    """
    Convert an uploaded DXF/DWG drawing to KML/KMZ.

    Runs in a worker thread (sync endpoint) so the event loop keeps serving other requests.
    Returns conversion statistics, warnings, a download link and a GeoJSON preview.
    """
    started = time.monotonic()
    raw_filename = file.filename or "drawing.dxf"
    ext = Path(raw_filename).suffix.lower()
    if ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a .dxf or .dwg file.")

    fmt = (output_format or "kml").lower()
    if fmt not in ("kml", "kmz"):
        raise HTTPException(status_code=400, detail="output_format must be 'kml' or 'kmz'.")
    if conversion_type not in ("standard", "raw"):
        raise HTTPException(status_code=400, detail="conversion_type must be 'standard' or 'raw'.")
    try:
        source_crs = normalize_crs_input(input_epsg)
        parse_crs(source_crs, epsg_only=True)
    except CRSError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from None
    if normalize_crs_input(output_epsg) != "EPSG:4326":
        raise HTTPException(status_code=400, detail="KML output must use WGS84 (EPSG:4326).")
    fill_rgb = css_hex_to_rgb(fill_color)
    if fill_rgb is None:
        raise HTTPException(status_code=400, detail="fill_color must be a #rrggbb color.")
    if not (0.0 <= fill_opacity <= 1.0) or not (0.05 <= label_scale <= 5.0):
        raise HTTPException(status_code=400, detail="fill_opacity must be 0-1 and label_scale 0.05-5.")

    if conversion_type == "standard":  # streamlined output: geometry only
        export_text = False
        export_points = False

    try:
        cfg = ConverterConfig(
            input_epsg=source_crs,
            output_epsg="EPSG:4326",
            merge_lines=merge_lines,
            ignore_large_polygons=ignore_large_polygons,
            default_label_scale=label_scale,
            export_text=export_text,
            export_points=export_points,
            auto_scale_text=auto_scale_text,
            fill_polygons=fill_polygons,
            fill_color=rgb_to_kml_hex(*fill_rgb, alpha=round(fill_opacity * 255)),
            fill_opacity=round(fill_opacity * 255),
            max_entities=MAX_ENTITIES,
            max_vertices=MAX_VERTICES,
            timeout_seconds=CONVERSION_TIMEOUT,
        )
    except ValidationError:
        raise HTTPException(status_code=400, detail="Invalid conversion options.") from None

    if not _slots.acquire(timeout=2.0):
        _count("rejected_busy")
        raise HTTPException(status_code=503, detail="The converter is busy. Please retry in a minute.",
                            headers={"Retry-After": "30"})

    job_id = uuid.uuid4().hex
    job_dir = TEMP_STORAGE / job_id
    input_path = job_dir / f"input{ext}"
    output_name = f"{_safe_stem(raw_filename)}.{fmt}"
    output_path = job_dir / output_name
    input_size = 0
    _count("active")
    try:
        job_dir.mkdir(parents=True)
        input_size = _copy_upload(file, input_path)
        result = convert(input_path, output_path, cfg, output_format=fmt,
                         collect_preview=True, preview_max_vertices=PREVIEW_MAX_VERTICES)
    except ConversionError as ex:
        shutil.rmtree(job_dir, ignore_errors=True)
        _count("failed")
        with _metrics_lock:
            _failures_by_type[type(ex).__name__] = _failures_by_type.get(type(ex).__name__, 0) + 1
        logger.warning(f"conversion job={job_id} outcome=rejected error={type(ex).__name__} "
                       f"input_bytes={input_size} ext={ext} reason={ex}")
        raise HTTPException(status_code=_status_for(ex), detail=str(ex)) from None
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        _count("failed")
        with _metrics_lock:
            _failures_by_type["internal"] = _failures_by_type.get("internal", 0) + 1
        logger.exception(f"conversion job={job_id} outcome=error input_bytes={input_size} ext={ext}")
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error while converting this drawing (reference {job_id[:8]}).",
        ) from None
    finally:
        input_path.unlink(missing_ok=True)  # never keep uploaded drawings
        _count("active", -1)
        _slots.release()
        file.file.close()

    _count("succeeded")
    summary = result.summary()
    logger.info(
        f"conversion job={job_id} outcome=success input_bytes={input_size} source={summary['source_format']} "
        f"entities={summary['total_entities']} vertices={summary['total_vertices']} "
        f"output_bytes={output_path.stat().st_size} warnings={len(result.warnings)} "
        f"timings={json.dumps(result.timings)} wall={time.monotonic() - started:.2f}s"
    )
    background_tasks.add_task(cleanup_temp_files)

    stats = result.export_stats
    return JSONResponse({
        "success": True,
        "job_id": job_id,
        "filename": output_name,
        "download_url": f"/api/download/{job_id}/{quote(output_name)}",
        "stats": {
            **summary,
            "total_shapes": stats.polygons_exported + stats.polylines_exported,
            "total_markers": stats.points_exported + stats.labels_exported,
        },
        "warnings": result.warnings,
        "timings": result.timings,
        "geojson": result.preview,
        "preview_truncated": result.preview_truncated,
    })


@app.get("/api/download/{job_id}/{filename}")
def download_file(job_id: str, filename: str):
    """Download a generated KML/KMZ file (available for OUTPUT_TTL_SECONDS)."""
    if not _JOB_ID.fullmatch(job_id):
        raise HTTPException(status_code=404, detail="Requested file not found or link expired.")
    job_dir = TEMP_STORAGE / job_id
    target = None
    if job_dir.is_dir():
        for candidate in job_dir.iterdir():
            if candidate.name == filename and candidate.suffix in (".kml", ".kmz") and candidate.is_file():
                target = candidate
    if target is None or time.time() - target.stat().st_mtime > OUTPUT_TTL:
        raise HTTPException(status_code=404, detail="Requested file not found or link expired.")

    media_type = "application/vnd.google-earth.kmz" if target.suffix == ".kmz" else "application/vnd.google-earth.kml+xml"
    return FileResponse(path=target, filename=target.name, media_type=media_type)


@app.post("/api/utm-zone")
async def utm_zone_lookup(lat: float = Form(...), lon: float = Form(...)):
    """Calculate UTM zone EPSG code for latitude and longitude."""
    try:
        epsg_code, desc = calculate_utm_epsg(lat, lon)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from None
    return JSONResponse({"epsg": f"EPSG:{epsg_code}", "epsg_code": epsg_code, "description": desc})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_app.app:app", host="0.0.0.0", port=8000, reload=True)
