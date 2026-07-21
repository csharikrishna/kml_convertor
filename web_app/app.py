"""
FastAPI Web Server for DXF/DWG to KML Converter.
"""

from pathlib import Path
import tempfile
import uuid
import math
from typing import Optional, Dict, Any, Tuple
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from loguru import logger

from dxf2kml.config import ConverterConfig
from dxf2kml.parser import DXFParser
from dxf2kml.geometry import GeometryEngine, ReconstructedGeometry
from dxf2kml.filters import BoundaryFilter
from dxf2kml.transformer import CoordinateTransformer
from dxf2kml.exporter import KMLExporter
from dxf2kml.utils import aci_to_rgb, rgb_to_kml_hex

BASE_DIR = Path(__file__).resolve().parent
TEMP_STORAGE = Path(tempfile.gettempdir()) / "dxf2kml_web"
TEMP_STORAGE.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="DXF to KML Online Converter API")

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def calculate_utm_epsg(lat: float, lon: float) -> Tuple[int, str]:
    """Calculate UTM Zone EPSG code and description for given lat/lon."""
    zone_number = int((lon + 180) / 6) + 1
    is_northern = lat >= 0
    epsg_code = (32600 + zone_number) if is_northern else (32700 + zone_number)
    hemisphere = "Northern Hemisphere" if is_northern else "Southern Hemisphere"
    lon_min = (zone_number - 1) * 6 - 180
    lon_max = lon_min + 6
    desc = f"Zone {zone_number} ({lon_min}°E - {lon_max}°E - {hemisphere})"
    return epsg_code, desc


import time

def cleanup_temp_files(max_age_seconds: int = 3600):
    """Purge temporary conversion files older than max_age_seconds."""
    now = time.time()
    count = 0
    try:
        for item in TEMP_STORAGE.glob("*"):
            if item.is_file():
                if now - item.stat().st_mtime > max_age_seconds:
                    try:
                        item.unlink()
                        count += 1
                    except Exception as ex:
                        logger.warning(f"Failed to delete temp file {item}: {ex}")
        if count > 0:
            logger.info(f"Cleaned up {count} expired temporary files.")
    except Exception as e:
        logger.warning(f"Error during temp file cleanup: {e}")


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for container probes and load balancers."""
    file_count = len(list(TEMP_STORAGE.glob("*")))
    return {
        "status": "healthy",
        "service": "dxf2kml-api",
        "temp_files_cached": file_count
    }


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Render main web application interface."""
    return templates.TemplateResponse(request=request, name="index.html")


@app.post("/api/convert")
async def convert_file(
    file: UploadFile = File(...),
    input_epsg: str = Form("EPSG:32644"),
    output_epsg: str = Form("EPSG:4326"),
    conversion_type: str = Form("raw"),  # "standard" or "raw"
    merge_lines: bool = Form(True),
    ignore_large_polygons: bool = Form(True),
    label_scale: float = Form(0.5),
    export_text: bool = Form(True),
    export_points: bool = Form(True),
):
    """
    Endpoint to process uploaded DXF/DWG file, run conversion,
    and return conversion summary + download link + GeoJSON preview.
    """
    import re
    raw_filename = file.filename or "drawing.dxf"
    
    # Sanitize filename: lowercase, replace non-alphanumeric with underscore
    safe_name = re.sub(r'[^a-z0-9.]', '_', raw_filename.lower())
    safe_name = re.sub(r'_+', '_', safe_name).strip('_')
    filename = safe_name
    
    file_ext = Path(filename).suffix.lower()

    if file_ext not in (".dxf", ".dwg"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a .dxf or .dwg file.")

    file_id = str(uuid.uuid4())
    upload_path = TEMP_STORAGE / f"{file_id}_{filename}"
    kml_filename = f"{Path(filename).stem}.kml"
    output_kml_path = TEMP_STORAGE / f"{file_id}_{kml_filename}"

    # Save uploaded file
    try:
        content = await file.read()
        with open(upload_path, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"Error saving uploaded file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    # Configure conversion settings
    epsg_code = input_epsg if input_epsg.upper().startswith("EPSG:") else f"EPSG:{input_epsg}"
    
    # Run background temp file cleanup
    cleanup_temp_files(max_age_seconds=3600)
    
    cfg = ConverterConfig(
        input_epsg=epsg_code,
        output_epsg=output_epsg,
        merge_lines=merge_lines,
        ignore_large_polygons=ignore_large_polygons,
        default_label_scale=label_scale,
        export_text=export_text,
        export_points=export_points,
    )

    try:
        # 1. Parse DXF
        parser = DXFParser(cfg)
        parse_result = parser.parse(upload_path)

        # 2. Geometry Engine
        geom_engine = GeometryEngine(cfg)
        reconstructed_geoms, geom_stats = geom_engine.process(
            parse_result.paths,
            parse_result.hatches
        )

        # 3. Filter boundary frames
        boundary_filter = BoundaryFilter(cfg)
        filtered_geoms, ignored_frames_count = boundary_filter.filter_geometries(reconstructed_geoms)

        # 4. Transform & Export KML
        transformer = CoordinateTransformer(source_crs=cfg.input_epsg, target_crs=cfg.output_epsg)
        exporter = KMLExporter(cfg, transformer)

        exporter.export_geometries(filtered_geoms)
        exporter.export_points(parse_result.points)
        exporter.export_labels(parse_result.labels)
        exporter.save(output_kml_path)

        # 5. Build GeoJSON payload for Leaflet map preview
        geojson_features = []

        # Export polygons & lines to GeoJSON
        for g in filtered_geoms:
            color_aci = g.color_aci
            r, g_val, b = aci_to_rgb(color_aci) if (color_aci and 1 <= color_aci <= 255) else (255, 0, 0)
            stroke_hex = f"#{r:02x}{g_val:02x}{b:02x}"

            if g.geometry_type == "Polygon":
                coords = list(g.geom.exterior.coords)
                tf_coords = transformer.transform_coords(coords)
                geojson_features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[p[0], p[1]] for p in tf_coords]]
                    },
                    "properties": {
                        "layer": g.layer,
                        "stroke": stroke_hex,
                        "stroke-width": 2,
                        "fill": stroke_hex,
                        "fill-opacity": 0.2
                    }
                })
            elif g.geometry_type == "LineString":
                coords = list(g.geom.coords)
                tf_coords = transformer.transform_coords(coords)
                geojson_features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[p[0], p[1]] for p in tf_coords]
                    },
                    "properties": {
                        "layer": g.layer,
                        "stroke": stroke_hex,
                        "stroke-width": 3
                    }
                })

        # Export points & text labels to GeoJSON
        if cfg.export_points:
            for pt in parse_result.points:
                lon, lat, _ = transformer.transform_point(pt.position[0], pt.position[1], pt.position[2])
                geojson_features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "layer": pt.layer,
                        "type": "point",
                        "title": f"Point ({pt.layer})"
                    }
                })

        if cfg.export_text:
            for lbl in parse_result.labels:
                lon, lat, _ = transformer.transform_point(lbl.position[0], lbl.position[1], lbl.position[2])
                geojson_features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "layer": lbl.layer,
                        "type": "text",
                        "title": lbl.text
                    }
                })

        geojson_payload = {
            "type": "FeatureCollection",
            "features": geojson_features
        }

        total_shapes = exporter.stats.polygons_exported + exporter.stats.polylines_exported
        total_markers = exporter.stats.points_exported + exporter.stats.labels_exported

        return JSONResponse({
            "success": True,
            "filename": kml_filename,
            "download_url": f"/api/download/{file_id}/{kml_filename}",
            "stats": {
                "total_entities": parse_result.total_entities_processed,
                "polygons": exporter.stats.polygons_exported,
                "polylines": exporter.stats.polylines_exported,
                "points": exporter.stats.points_exported,
                "labels": exporter.stats.labels_exported,
                "total_shapes": total_shapes,
                "total_markers": total_markers,
                "ignored_frames": ignored_frames_count,
            },
            "geojson": geojson_payload
        })

    except ValueError as ve:
        logger.warning(f"Validation error during conversion: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Conversion error: {e}")
        raise HTTPException(status_code=400, detail=f"Conversion failed: {str(e)}")


@app.get("/api/download/{file_id}/{filename}")
async def download_file(file_id: str, filename: str):
    """Download generated KML file."""
    matching_files = list(TEMP_STORAGE.glob(f"{file_id}_*.kml"))
    if not matching_files:
        raise HTTPException(status_code=404, detail="Requested file not found or link expired.")

    kml_file = matching_files[0]
    original_filename = kml_file.name.replace(f"{file_id}_", "")

    return FileResponse(
        path=kml_file,
        filename=original_filename,
        media_type="application/vnd.google-earth.kml+xml"
    )


@app.post("/api/utm-zone")
async def utm_zone_lookup(lat: float = Form(...), lon: float = Form(...)):
    """Calculate UTM zone EPSG code for latitude and longitude."""
    epsg_code, desc = calculate_utm_epsg(lat, lon)
    return JSONResponse({
        "epsg": f"EPSG:{epsg_code}",
        "epsg_code": epsg_code,
        "description": desc
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_app.app:app", host="0.0.0.0", port=8000, reload=True)
