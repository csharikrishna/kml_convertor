"""
FastAPI Web Server for the DXF/DWG to KML/KMZ converter.

Request flow (POST /api/convert):
  body-size limit (ASGI middleware, 413) -> form validation (400) -> concurrency slot (503)
  -> per-job directory -> upload copied with byte cap -> dxf2kml.pipeline.convert() in a
  worker thread (the event loop stays responsive) -> input deleted immediately ->
  output kept for OUTPUT_TTL_SECONDS and served by GET /api/download/{job_id}/{filename}.

Configuration (environment variables, defaults sized for a 512 MB instance):
  MAX_UPLOAD_MB=25  MAX_ENTITIES=500000  MAX_VERTICES=2000000  CONVERSION_TIMEOUT_SECONDS=120
  MAX_CONCURRENT_CONVERSIONS=1  QUEUE_WAIT_SECONDS=10  OUTPUT_TTL_SECONDS=3600  PREVIEW_MAX_VERTICES=150000
  DXF2KML_TEMP_DIR=<system temp>/dxf2kml_web  LOG_LEVEL=INFO  LOG_JSON=0
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
QUEUE_WAIT = _env_int("QUEUE_WAIT_SECONDS", 10)  # how long a request may wait for a free slot
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


SHARES_FILE = TEMP_STORAGE / "shares.json"
_shares_lock = threading.Lock()


def _load_shares() -> Dict[str, Dict[str, Any]]:
    if not SHARES_FILE.is_file():
        return {}
    try:
        with open(SHARES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_shares(shares: Dict[str, Dict[str, Any]]) -> None:
    try:
        tmp = SHARES_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(shares, f, indent=2)
        tmp.replace(SHARES_FILE)
    except Exception as ex:
        logger.warning(f"Failed to save shares file: {ex}")


def cleanup_temp_files(max_age_seconds: int = OUTPUT_TTL) -> int:
    """Remove job directories older than max_age_seconds, keeping active shared jobs."""
    now = time.time()
    active_job_ids = set()
    with _shares_lock:
        shares = _load_shares()
        valid_shares = {}
        for sid, sinfo in shares.items():
            if sinfo.get("expires_at", 0) > now:
                valid_shares[sid] = sinfo
                active_job_ids.add(sinfo.get("job_id"))
        if len(valid_shares) != len(shares):
            _save_shares(valid_shares)

    removed = 0
    for item in TEMP_STORAGE.iterdir():
        if item.name == "shares.json":
            continue
        if item.name in active_job_ids:
            continue  # preserve directory for active share
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

# Enable GZip compression for payloads > 1KB (compresses GeoJSON & spatial data by 80-90%)
app.add_middleware(GZipMiddleware, minimum_size=1000)

cors_origins_env = os.environ.get("CORS_ORIGINS", "")
cors_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
if not cors_origins or cors_origins == ["*"]:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def add_cors_and_error_headers(request: Request, call_next):
    """Ensure all responses including errors and preflights carry CORS headers."""
    if request.method == "OPTIONS":
        response = Response(status_code=200)
    else:
        try:
            response = await call_next(request)
        except Exception as e:
            logger.exception("Unhandled server error: {}", e)
            response = JSONResponse(status_code=500, content={"detail": str(e)})

    origin = request.headers.get("origin") or "*"
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


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
    "img-src 'self' data: https://unpkg.com https://server.arcgisonline.com https://services.arcgisonline.com https://*.arcgisonline.com https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://*.google.com https://*.googleapis.com https://*.gstatic.com; "
    "connect-src 'self' https://nominatim.openstreetmap.org https://tile.openstreetmap.org; "
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


def validate_cad_signature(path: Path) -> None:
    """
    Validate CAD file signature by examining initial bytes.
    - DWG must begin with 'AC10' (AC10xx version marker).
    - DXF must contain standard structural group codes (starts with group 0 or 999).
    """
    if not path.is_file():
        raise InputFileError("Uploaded file not found.")

    ext = path.suffix.lower()
    if ext == ".dwg":
        with open(path, "rb") as f:
            header = f.read(6)
        if len(header) < 4 or not header.startswith(b"AC10"):
            raise InputFileError("Invalid DWG file: Missing AutoCAD DWG header signature (AC10xx).")
    elif ext == ".dxf":
        with open(path, "rb") as f:
            header_bytes = f.read(2048)
        if not header_bytes:
            raise InputFileError("Uploaded DXF file is empty.")

        # Support AutoCAD Binary DXF signature
        if header_bytes.startswith(b"AutoCAD Binary DXF"):
            return

        try:
            text_preview = header_bytes.decode("latin-1", errors="ignore")
        except Exception:
            raise InputFileError("Invalid DXF file: Binary data found where ASCII text was expected.")

        lines = [line.strip().lstrip("\ufeff") for line in text_preview.splitlines() if line.strip()]
        if not lines or not any(lines[i] in ("0", "999") for i in range(min(5, len(lines)))):
            raise InputFileError("Invalid DXF file: Missing standard AutoCAD DXF structural markers.")


_ERROR_STATUS = {InputFileError: 400, CRSError: 400, DWGConversionError: 422, LimitExceededError: 413}


def _status_for(ex: ConversionError) -> int:
    for cls, status in _ERROR_STATUS.items():
        if isinstance(ex, cls):
            return status
    return 422


# --------------------------------------------------------------------------- routes

@app.get("/health", tags=["Health"])
def health_check():
    """
    Comprehensive health check endpoint for container probes, status dots, and load balancers.
    Fast, non-blocking check with zero CAD conversion overhead.
    """
    with _metrics_lock:
        metrics = dict(_metrics)
        failures = dict(_failures_by_type)

    # Safe non-blocking file count with fallback
    try:
        temp_count = sum(1 for _ in TEMP_STORAGE.iterdir())
    except Exception:
        temp_count = 0

    dwg_avail = is_dwg_supported()
    storage_ok = TEMP_STORAGE.is_dir() and os.access(TEMP_STORAGE, os.W_OK)

    return {
        "status": "healthy",
        "liveness": True,
        "readiness": storage_ok,
        "service": "dxf2kml-api",
        "version": __version__,
        "dwg_supported": dwg_avail,
        "temp_files_cached": temp_count,
        "conversions": {**metrics, "failed_by_type": failures},
        "limits": {
            "max_upload_mb": MAX_UPLOAD_BYTES // 2**20,
            "timeout_seconds": CONVERSION_TIMEOUT,
            "max_concurrent": MAX_CONCURRENT,
        },
        "dependencies": {
            "storage_writable": storage_ok,
            "dwg_converter_available": dwg_avail,
        },
    }


@app.get("/health/live", tags=["Health"])
def health_liveness():
    """Ultra-fast zero-allocation liveness probe: confirms the process is responsive."""
    return {"status": "alive", "timestamp": time.time()}


@app.get("/health/ready", tags=["Health"])
def health_readiness():
    """Readiness probe: verifies container is prepared to accept conversion workloads."""
    storage_ok = TEMP_STORAGE.is_dir() and os.access(TEMP_STORAGE, os.W_OK)
    if not storage_ok:
        raise HTTPException(status_code=503, detail="Temporary scratch storage unavailable")
    return {"status": "ready", "dwg_supported": is_dwg_supported(), "timestamp": time.time()}



@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    fav_file = BASE_DIR / "static" / "favicon.ico"
    if fav_file.is_file():
        return FileResponse(fav_file, media_type="image/x-icon")
    return Response(status_code=204, content=b"")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index(request: Request):
    """Render main web application interface."""
    return templates.TemplateResponse(
        request=request, name="index.html",
        context={"max_upload_mb": MAX_UPLOAD_BYTES // 2**20, "dwg_supported": is_dwg_supported(),
                 "version": f"{__version__}.{int(time.time())}"},
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
    label_scale: float = Form(1.2),
    kml_text_mode: str = Form("screen"),
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
            kml_text_mode=kml_text_mode,
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

    if not _slots.acquire(timeout=QUEUE_WAIT):
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
        validate_cad_signature(input_path)
        result = convert(input_path, output_path, cfg, output_format=fmt,
                         collect_preview=True, preview_max_vertices=PREVIEW_MAX_VERTICES,
                         document_name=Path(raw_filename).stem)
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
    stats = result.export_stats

    # Persist preview and metadata for temporary shareable links
    try:
        with open(job_dir / "preview.json", "w", encoding="utf-8") as pf:
            json.dump(result.preview or {}, pf)
        with open(job_dir / "meta.json", "w", encoding="utf-8") as mf:
            json.dump({
                "job_id": job_id,
                "filename": raw_filename,
                "output_name": output_name,
                "stats": {
                    **summary,
                    "total_shapes": stats.polygons_exported + stats.polylines_exported,
                    "total_markers": stats.points_exported + stats.labels_exported,
                },
                "created_at": time.time(),
            }, mf)
    except Exception as ex:
        logger.warning(f"Failed to persist preview for job {job_id}: {ex}")

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
    safe_ascii = re.sub(r'[^a-zA-Z0-9._-]', '_', target.name)
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_ascii}"; filename*=UTF-8\'\'{quote(target.name)}'
    }
    return FileResponse(path=target, media_type=media_type, headers=headers)


@app.post("/api/utm-zone")
async def utm_zone_lookup(lat: float = Form(...), lon: float = Form(...)):
    """Calculate UTM zone EPSG code for latitude and longitude."""
    try:
        epsg_code, desc = calculate_utm_epsg(lat, lon)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from None
    return JSONResponse({"epsg": f"EPSG:{epsg_code}", "epsg_code": epsg_code, "description": desc})


@app.get("/api/sample-file")
def get_sample_file():
    """Serve the verified sample drawing (Althur Padu Bund) for quick demo testing."""
    sample_path = Path(__file__).resolve().parent.parent / "examples" / "Althur_padu_bund.dwg"
    if not sample_path.is_file():
        raise HTTPException(status_code=404, detail="Sample drawing file not found on server.")
    return FileResponse(
        path=sample_path,
        media_type="application/acad",
        filename="Althur_padu_bund.dwg",
        headers={"Content-Disposition": 'attachment; filename="Althur_padu_bund.dwg"'}
    )


@app.post("/api/share")
async def create_share_link(
    request: Request,
    job_id: str = Form(...),
    expires_in_hours: float = Form(24.0),
):
    """Generate a temporary shareable link for a converted CAD project."""
    if not _JOB_ID.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format.")
    job_dir = TEMP_STORAGE / job_id
    meta_path = job_dir / "meta.json"
    if not job_dir.is_dir() or not meta_path.is_file():
        raise HTTPException(status_code=404, detail="Conversion session expired or not found.")

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        meta = {"filename": "drawing.dwg", "output_name": "drawing.kml"}

    hours = max(0.5, min(720.0, float(expires_in_hours)))  # 30 mins to 30 days
    now = time.time()
    expires_at = now + (hours * 3600.0)
    share_id = secrets.token_urlsafe(12)

    share_info = {
        "share_id": share_id,
        "job_id": job_id,
        "filename": meta.get("filename", "drawing"),
        "output_name": meta.get("output_name", "drawing.kml"),
        "stats": meta.get("stats", {}),
        "created_at": now,
        "expires_at": expires_at,
        "expires_in_hours": hours,
    }

    with _shares_lock:
        shares = _load_shares()
        shares[share_id] = share_info
        _save_shares(shares)

    host = request.headers.get("host", "127.0.0.1:8000")
    scheme = request.url.scheme
    share_url = f"{scheme}://{host}/share/{share_id}"

    return JSONResponse({
        "success": True,
        "share_id": share_id,
        "share_url": share_url,
        "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
        "expires_in_hours": hours,
        "filename": share_info["filename"],
    })


@app.get("/share/{share_id}", response_class=HTMLResponse)
async def view_shared_map(request: Request, share_id: str):
    """Serve the dedicated GIS Workstation map view for shared links."""
    now = time.time()
    with _shares_lock:
        shares = _load_shares()
        share = shares.get(share_id)

    if not share or share.get("expires_at", 0) <= now:
        return templates.TemplateResponse(request, "share_expired.html", {"share_id": share_id}, status_code=410)

    job_id = share["job_id"]
    job_dir = TEMP_STORAGE / job_id
    preview_file = job_dir / "preview.json"
    if not job_dir.is_dir() or not preview_file.is_file():
        return templates.TemplateResponse(request, "share_expired.html", {"share_id": share_id}, status_code=410)

    remaining_seconds = max(0, int(share["expires_at"] - now))
    hours = remaining_seconds // 3600
    mins = (remaining_seconds % 3600) // 60
    expiry_str = f"{hours}h {mins}m" if hours > 0 else f"{mins}m"

    return templates.TemplateResponse(request, "share_viewer.html", {
        "share_id": share_id,
        "filename": share.get("filename", "CAD Drawing"),
        "output_name": share.get("output_name", "drawing.kml"),
        "expiry_str": expiry_str,
        "expires_at_iso": datetime.fromtimestamp(share["expires_at"], tz=timezone.utc).isoformat(),
        "stats": share.get("stats", {}),
        "version": f"{__version__}.{int(time.time())}",
    })


@app.get("/api/share/{share_id}/geojson")
async def get_shared_geojson(share_id: str):
    """Serve the preview GeoJSON for a valid temporary share."""
    now = time.time()
    with _shares_lock:
        shares = _load_shares()
        share = shares.get(share_id)
    if not share or share.get("expires_at", 0) <= now:
        raise HTTPException(status_code=410, detail="This shared link has expired.")

    preview_path = TEMP_STORAGE / share["job_id"] / "preview.json"
    if not preview_path.is_file():
        raise HTTPException(status_code=404, detail="Preview data not found.")
    return FileResponse(path=preview_path, media_type="application/json")


@app.get("/api/share/{share_id}/download")
async def download_shared_file(share_id: str):
    """Download the converted KML/KMZ from a valid temporary share."""
    now = time.time()
    with _shares_lock:
        shares = _load_shares()
        share = shares.get(share_id)
    if not share or share.get("expires_at", 0) <= now:
        raise HTTPException(status_code=410, detail="This shared link has expired.")

    job_dir = TEMP_STORAGE / share["job_id"]
    target = None
    output_name = share.get("output_name")
    if job_dir.is_dir():
        for candidate in job_dir.iterdir():
            if candidate.name == output_name and candidate.suffix in (".kml", ".kmz") and candidate.is_file():
                target = candidate
                break
    if target is None:
        raise HTTPException(status_code=404, detail="Requested file not found.")

    media_type = "application/vnd.google-earth.kmz" if target.suffix == ".kmz" else "application/vnd.google-earth.kml+xml"
    safe_ascii = re.sub(r'[^a-zA-Z0-9._-]', '_', target.name)
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_ascii}"; filename*=UTF-8\'\'{quote(target.name)}'
    }
    return FileResponse(path=target, media_type=media_type, headers=headers)


# ---------------------------------------------------------------------------
# CADASTRAL GIS & CANAL ALIGNMENT SUITE
# ---------------------------------------------------------------------------

from datetime import datetime
from dxf2kml.cadastral import analyze_cadastral_dwg
from dxf2kml.excel_parser import parse_cadastral_excel_or_csv

_cadastral_cache: Dict[str, Any] = {}
_cadastral_lock = threading.Lock()

PROJECTS_DIR = BASE_DIR.parent / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_CATALOG_FILE = PROJECTS_DIR / "catalog.json"


def _load_projects_catalog() -> Dict[str, Any]:
    if not PROJECTS_CATALOG_FILE.is_file():
        return {}
    try:
        with open(PROJECTS_CATALOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_projects_catalog(catalog: Dict[str, Any]) -> None:
    try:
        tmp = PROJECTS_CATALOG_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2)
        tmp.replace(PROJECTS_CATALOG_FILE)
    except Exception as ex:
        logger.warning(f"Failed to save projects catalog: {ex}")


SAMPLE_PROJECTS = {
    "konampalle": {
        "id": "konampalle",
        "title": "Konampalle Canal Project (KM 216.300 - 219.750)",
        "village": "Konampalle",
        "mandal": "Beluguppa",
        "district": "Anantapur",
        "crs": "EPSG:32643",
        "filename": "1) KONAMPALLE-KM 216.300 to 217.300 & 218.575 to 219.750.dwg",
        "chainage_span": "KM 216.300 to 219.750",
    },
    "padamatiyaleru": {
        "id": "padamatiyaleru",
        "title": "Padamatiyaleru Canal Project (KM 217.300 - 242.350)",
        "village": "Padamatiyaleru",
        "mandal": "Beluguppa",
        "district": "Anantapur",
        "crs": "EPSG:32643",
        "filename": "2) PADAMATIYALERU-KM 217.300 to 218.575 & 219.750 to 223.140 & 236.775 to 242.350.dwg",
        "chainage_span": "KM 217.300 to 242.350",
    },
}


@app.get("/api/cadastral/projects")
async def list_all_cadastral_projects():
    """List all available cadastral projects (sample canal reaches + user-created village projects)."""
    projects_list = []
    root_sample_dir = BASE_DIR.parent / "sample"

    # 1. Official Sample Projects
    for sid, info in SAMPLE_PROJECTS.items():
        file_path = root_sample_dir / info["filename"]
        exists = file_path.is_file()
        projects_list.append({
            **info,
            "is_sample": True,
            "is_custom": False,
            "available": exists,
            "plots_count": 907 if sid == "padamatiyaleru" else 351,
            "affected_count": 198 if sid == "padamatiyaleru" else 84,
            "has_excel": True,
            "has_pdf": True,
            "created_at": "2024-01-01T00:00:00",
        })

    # 2. Custom User Village Projects
    catalog = _load_projects_catalog()
    for pid, pmeta in catalog.items():
        proj_dir = PROJECTS_DIR / pid
        projects_list.append({
            **pmeta,
            "is_sample": False,
            "is_custom": True,
            "available": proj_dir.is_dir() and (proj_dir / "project.json").is_file(),
        })

    return {"projects": projects_list}


@app.get("/api/cadastral/samples")
async def list_cadastral_samples():
    """List available sample DWG cadastral projects (for backward compatibility)."""
    res = await list_all_cadastral_projects()
    return {"samples": res["projects"]}


@app.get("/api/cadastral/project/{project_id}")
async def get_cadastral_project(project_id: str):
    """Retrieve cadastral GIS project data (layers, survey register, metrics)."""
    # 1. Check in-memory cache
    with _cadastral_lock:
        if project_id in _cadastral_cache:
            return JSONResponse(content=_cadastral_cache[project_id])

    # 2. Check if user-created project on disk
    user_proj_file = PROJECTS_DIR / project_id / "project.json"
    if user_proj_file.is_file():
        try:
            with open(user_proj_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            with _cadastral_lock:
                _cadastral_cache[project_id] = data
            return JSONResponse(content=data)
        except Exception as ex:
            logger.error("Failed to read project file {}: {}", user_proj_file, ex)

    # 3. Check if sample project
    if project_id in SAMPLE_PROJECTS:
        return await get_cadastral_sample(project_id)

    raise HTTPException(status_code=404, detail="Cadastral project not found.")


@app.get("/api/cadastral/sample/{sample_id}")
async def get_cadastral_sample(sample_id: str):
    """Retrieve pre-analyzed cadastral GIS layers and survey register."""
    if sample_id not in SAMPLE_PROJECTS:
        raise HTTPException(status_code=404, detail="Unknown sample project ID.")

    with _cadastral_lock:
        if sample_id in _cadastral_cache:
            return JSONResponse(content=_cadastral_cache[sample_id])

    info = SAMPLE_PROJECTS[sample_id]
    sample_file = BASE_DIR.parent / "sample" / info["filename"]
    if not sample_file.is_file():
        raise HTTPException(status_code=404, detail=f"Sample DWG file not found: {info['filename']}")

    try:
        data = analyze_cadastral_dwg(
            dwg_or_dxf_path=sample_file,
            input_epsg=info["crs"],
            village_name=info["village"],
            mandal_name=info["mandal"],
            district_name=info["district"],
            canal_buffer_meters=12.5,
        )
        data["project_id"] = sample_id
        with _cadastral_lock:
            _cadastral_cache[sample_id] = data
        return JSONResponse(content=data)
    except Exception as ex:
        logger.exception("Failed to analyze sample project {}: {}", sample_id, ex)
        raise HTTPException(status_code=500, detail=f"Cadastral analysis failed: {str(ex)}")


@app.post("/api/cadastral/projects/create")
async def create_village_project(
    title: str = Form(""),
    village_name: str = Form(""),
    mandal_name: str = Form(""),
    district_name: str = Form(""),
    crs: str = Form("EPSG:32643"),
    canal_buffer: float = Form(12.5),
    drawing_file: UploadFile = File(...),
    excel_file: Optional[UploadFile] = File(None),
    pdf_file: Optional[UploadFile] = File(None),
):
    """Create a persistent village project with DWG drawing, optional Land Plan Excel, and PDF map scan."""
    dwg_suffix = Path(drawing_file.filename or "").suffix.lower()
    if dwg_suffix not in (".dwg", ".dxf"):
        raise HTTPException(status_code=400, detail="A valid AutoCAD DWG or DXF drawing is required.")

    # Generate friendly project ID
    safe_vname = re.sub(r"[^a-zA-Z0-9]+", "-", village_name.strip().lower() or "village").strip("-")
    project_id = f"proj-{safe_vname}-{secrets.token_hex(4)}"
    proj_dir = PROJECTS_DIR / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)

    # 1. Save Drawing File
    drawing_path = proj_dir / f"drawing{dwg_suffix}"
    with open(drawing_path, "wb") as f:
        shutil.copyfileobj(drawing_file.file, f)

    try:
        validate_cad_signature(drawing_path)
    except InputFileError as sig_err:
        shutil.rmtree(proj_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(sig_err)) from None

    # 2. Run Cadastral Analysis
    v_clean = village_name.strip() or safe_vname.capitalize()
    m_clean = mandal_name.strip() or "Beluguppa"
    d_clean = district_name.strip() or "Anantapur"
    p_title = title.strip() or f"{v_clean} Village Cadastral Project"

    try:
        data = analyze_cadastral_dwg(
            dwg_or_dxf_path=drawing_path,
            input_epsg=crs.strip() or "EPSG:32643",
            village_name=v_clean,
            mandal_name=m_clean,
            district_name=d_clean,
            canal_buffer_meters=float(canal_buffer) if canal_buffer > 0 else 12.5,
        )
    except Exception as ex:
        logger.exception("Cadastral analysis failed for {}: {}", drawing_file.filename, ex)
        shutil.rmtree(proj_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"CAD drawing processing failed: {str(ex)}")

    # 3. Optional Land Plan Schedule / Coordinates Excel Ingestion
    has_excel = False
    if excel_file and excel_file.filename and excel_file.size:
        ex_suffix = Path(excel_file.filename).suffix.lower()
        if ex_suffix in (".xlsx", ".xlsm", ".csv"):
            excel_path = proj_dir / f"schedule{ex_suffix}"
            with open(excel_path, "wb") as f:
                shutil.copyfileobj(excel_file.file, f)

            try:
                excel_res = parse_cadastral_excel_or_csv(excel_path)
                s_map = excel_res.get("survey_records", {})

                # Merge owner details into survey_register
                for p in data.get("survey_register", []):
                    s_no = str(p.get("survey_no", "")).strip()
                    match = s_map.get(s_no)
                    if not match:
                        base_sno = re.split(r"[/,\s]", s_no)[0]
                        match = s_map.get(base_sno)
                    if match:
                        if match.get("pattadar_name"):
                            p["pattadar_name"] = match["pattadar_name"]
                        if match.get("khata_no"):
                            p["khata_no"] = match["khata_no"]
                        if match.get("land_nature"):
                            p["land_nature"] = match["land_nature"]

                has_excel = True
            except Exception as ex:
                logger.warning("Could not enrich with Excel schedule: {}", ex)

    # 4. Optional PDF Document Ingestion
    has_pdf = False
    if pdf_file and pdf_file.filename and pdf_file.size:
        pdf_suffix = Path(pdf_file.filename).suffix.lower()
        if pdf_suffix == ".pdf":
            pdf_path = proj_dir / "document.pdf"
            with open(pdf_path, "wb") as f:
                shutil.copyfileobj(pdf_file.file, f)

            data["documents"] = [
                {
                    "title": f"{v_clean} Village Map Scan & Gazette",
                    "filename": pdf_file.filename,
                    "url": f"/api/cadastral/project/{project_id}/document",
                    "size_bytes": pdf_path.stat().st_size,
                }
            ]
            has_pdf = True

    # 5. Metadata & Persistence
    data["project_id"] = project_id
    data["title"] = p_title
    data["created_at"] = datetime.now().isoformat()

    try:
        with open(proj_dir / "project.json", "w", encoding="utf-8") as f:
            json.dump(data, f)

        catalog = _load_projects_catalog()
        catalog[project_id] = {
            "id": project_id,
            "title": p_title,
            "village": v_clean,
            "mandal": m_clean,
            "district": d_clean,
            "crs": crs,
            "plots_count": len(data.get("survey_register", [])),
            "affected_count": sum(1 for p in data.get("survey_register", []) if p.get("canal_passing")),
            "chainage_span": f"{data.get('summary', {}).get('acquired_area_acres', 0)} ac acq",
            "has_excel": has_excel,
            "has_pdf": has_pdf,
            "created_at": data["created_at"],
            "is_custom": True,
        }
        _save_projects_catalog(catalog)

        with _cadastral_lock:
            _cadastral_cache[project_id] = data

        return JSONResponse(content={"success": True, "project_id": project_id, "project_data": data})
    except Exception as ex:
        logger.exception("Failed to save project {}: {}", project_id, ex)
        raise HTTPException(status_code=500, detail=f"Failed to persist project: {str(ex)}")


@app.get("/api/cadastral/project/{project_id}/document")
async def get_project_document(project_id: str):
    """Download attached PDF document for a project."""
    pdf_path = PROJECTS_DIR / project_id / "document.pdf"
    if not pdf_path.is_file():
        raise HTTPException(status_code=404, detail="Project document not found.")
    return FileResponse(pdf_path, media_type="application/pdf", filename=f"{project_id}_document.pdf")


@app.delete("/api/cadastral/project/{project_id}")
async def delete_cadastral_project(project_id: str):
    """Delete a user-created village project folder."""
    if project_id in SAMPLE_PROJECTS:
        raise HTTPException(status_code=403, detail="Default sample projects cannot be deleted.")

    proj_dir = PROJECTS_DIR / project_id
    if proj_dir.is_dir():
        shutil.rmtree(proj_dir, ignore_errors=True)

    catalog = _load_projects_catalog()
    if project_id in catalog:
        del catalog[project_id]
        _save_projects_catalog(catalog)

    with _cadastral_lock:
        _cadastral_cache.pop(project_id, None)

    return {"success": True, "message": f"Project {project_id} deleted."}


@app.post("/api/cadastral/analyze")
async def analyze_uploaded_drawing(
    file: UploadFile = File(...),
    crs: str = Form("EPSG:32643"),
    village_name: str = Form(""),
    mandal_name: str = Form(""),
    district_name: str = Form(""),
    canal_buffer: float = Form(12.5),
    excel_file: Optional[UploadFile] = File(None),
    pdf_file: Optional[UploadFile] = File(None),
):
    """Analyze a user-uploaded drawing and create a project."""
    return await create_village_project(
        title=f"{village_name.strip() or 'Custom'} Village Project",
        village_name=village_name,
        mandal_name=mandal_name,
        district_name=district_name,
        crs=crs,
        canal_buffer=canal_buffer,
        drawing_file=file,
        excel_file=excel_file,
        pdf_file=pdf_file,
    )


@app.get("/api/cadastral/export-table/{project_id}")
async def export_cadastral_table_csv(project_id: str):
    """Export Form A Land Plan Schedule survey register as CSV."""
    with _cadastral_lock:
        data = _cadastral_cache.get(project_id)

    if not data:
        # Check disk storage for user-created project
        disk_proj = PROJECTS_DIR / project_id / "project.json"
        if disk_proj.is_file():
            try:
                with open(disk_proj, "r", encoding="utf-8") as f:
                    data = json.load(f)
                with _cadastral_lock:
                    _cadastral_cache[project_id] = data
            except Exception:
                pass

    if not data:
        # Check if it is a sample ID
        if project_id in SAMPLE_PROJECTS:
            info = SAMPLE_PROJECTS[project_id]
            sample_file = BASE_DIR.parent / "sample" / info["filename"]
            if sample_file.is_file():
                data = analyze_cadastral_dwg(
                    dwg_or_dxf_path=sample_file,
                    input_epsg=info["crs"],
                    village_name=info["village"],
                    mandal_name=info["mandal"],
                    district_name=info["district"],
                )
                with _cadastral_lock:
                    _cadastral_cache[project_id] = data

    if not data or "survey_register" not in data:
        raise HTTPException(status_code=404, detail="Cadastral project data not found.")

    import io
    import csv

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "S.No",
        "Survey No",
        "Land Classification",
        "Village",
        "Mandal",
        "District",
        "Total Area (Acres)",
        "Total Area (Ac - Cts)",
        "Total Area (Sq.Meters)",
        "Canal Passing",
        "Acquired Area (Acres)",
        "Acquired Area (Sq.Meters)",
        "Balance Area (Acres)",
        "Balance Area (Sq.Meters)",
        "Chainage Range",
        "Canal Length (m)",
        "Canal Width (m)",
        "Centroid Latitude",
        "Centroid Longitude",
        "Google Maps Link",
    ])

    for i, row in enumerate(data.get("survey_register", []), start=1):
        center = row.get("center") or [None, None]
        lat = center[0] if len(center) >= 2 else None
        lon = center[1] if len(center) >= 2 else None
        gmaps_url = f"https://www.google.com/maps?q={lat:.6f},{lon:.6f}" if lat is not None and lon is not None else ""

        writer.writerow([
            i,
            row.get("survey_no", ""),
            row.get("land_type", "Ryotwari Patta"),
            row.get("village", ""),
            row.get("mandal", ""),
            row.get("district", ""),
            row.get("total_acres", 0),
            row.get("total_ac_cts", ""),
            row.get("total_area_m2", 0),
            "Yes" if row.get("canal_passing") else "No",
            row.get("acquired_acres", 0),
            row.get("acquired_area_m2", 0),
            row.get("balance_acres", 0),
            row.get("balance_area_m2", 0),
            row.get("chainage_range", ""),
            row.get("canal_length_m", 0),
            row.get("canal_width_m", 0),
            f"{lat:.6f}" if lat is not None else "",
            f"{lon:.6f}" if lon is not None else "",
            gmaps_url,
        ])

    csv_data = output.getvalue()
    filename = f"Land_Plan_Schedule_{data.get('village', 'Survey')}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/cadastral/apsac/parcels")
async def query_apsac_parcels(
    village: str = Query(..., description="Village Name, e.g. Konampalle"),
    mandal: Optional[str] = Query(None, description="Mandal Name, e.g. Beluguppa"),
    district: Optional[str] = Query(None, description="District Name, e.g. Anantapur"),
):
    """
    Query official Andhra Pradesh Cadastral parcel polygons directly from APSAC ArcGIS MapServer.
    Returns GeoJSON FeatureCollection with survey numbers and area.
    """
    import urllib.request
    import urllib.parse
    import json

    clauses = [f"UPPER(villagenam) LIKE '%{village.upper().strip()}%'"]
    if mandal:
        clauses.append(f"UPPER(mandalnam) LIKE '%{mandal.upper().strip()}%'")
    if district:
        clauses.append(f"UPPER(dstrctnam) LIKE '%{district.upper().strip()}%'")

    where_sql = " AND ".join(clauses)
    params = urllib.parse.urlencode({
        "where": where_sql,
        "outFields": "objectid,dstrctnam,mandalnam,villagenam,parcelnam,parceltyp,st_area(shape),st_length(shape)",
        "outSR": "4326",
        "f": "geojson",
        "returnGeometry": "true",
    })

    url = f"https://apsac.ap.gov.in/gisserver/rest/services/cadastral/Andhra_Cadastral/MapServer/0/query?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=15) as response:
            content = response.read().decode("utf-8")
            data = json.loads(content)
            return JSONResponse(data)
    except Exception as ex:
        raise HTTPException(status_code=502, detail=f"Failed to query APSAC Cadastral MapServer: {str(ex)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_app.app:app", host="0.0.0.0", port=8000, reload=True)
