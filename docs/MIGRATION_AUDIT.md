# CAD2KML Migration Audit & Inventory Baseline

## Executive Summary
This document establishes the comprehensive technical audit, feature inventory, API contract specification, and baseline metrics for modernizing the CAD2KML web application from a legacy server-rendered Jinja2/vanilla JavaScript architecture to a modern Next.js/React/TypeScript GIS Workstation.

---

## 1. Baseline System & Environment Metrics

- **Operating System:** Windows (NT) / Linux (Docker deployment targets)
- **Runtime:** Python 3.12.10, Node.js v22.23.2, npm 10.9.8, pnpm 9.15.0
- **Test Baseline:** 197 backend tests collected and executed via `pytest`.
  - Result: **197 passed in 14.61s (100% pass rate)**.
  - Zero pre-existing regressions.
- **Backend Framework:** FastAPI 0.115+ with Starlette, Uvicorn, and Pydantic v2.
- **CAD & GIS Engine:** `dxf2kml` core pipeline with `ezdxf`, `pyproj`, `shapely`, `fastkml`, and ODA File Converter integration.

---

## 2. Comprehensive Implementation Inventory

| Area | Legacy Implementation | Analysis & Target Architecture |
|---|---|---|
| **File Upload** | HTML5 drag-and-drop dropzone; accepts `.dxf` always, `.dwg` if ODA File Converter is detected; client-side size check (25 MB default); XMLHttpRequest for real upload progress tracking. | Reusable React upload dropzone with native drag-and-drop, real XHR upload progress reporting, DWG capability detection via `/health`, validation states, and sample file loader. |
| **Conversion Parameters** | Form data POST to `/api/convert`: `file`, `input_epsg`, `output_epsg`, `conversion_type` ("standard" \| "raw"), `merge_lines`, `ignore_large_polygons`, `label_scale`, `kml_text_mode`, `export_text`, `export_points`, `auto_scale_text`, `fill_polygons`, `fill_color`, `fill_opacity`, `output_format` ("kml" \| "kmz"). | Strongly typed API client (`ConverterRequest`, `ConverterResponse`); controlled form state with sensible defaults; responsive advanced settings accordion. |
| **UTM Selection** | WGS84 Transverse Mercator formulation with Norway/Svalbard irregular zone rules; map click-to-pick EPSG detection via `/api/utm-zone`. | Preserved exact geodesic/UTM calculation algorithms; interactive map location picker and instant zone calculation. |
| **CAD GeoJSON Rendering** | Leaflet `L.geoJSON` rendering points, lines, polygons, and text labels; rotation via CSS transforms; custom stroke/fill styles per CAD layer. | Dedicated Leaflet React wrapper; decoupled rendering loop to avoid full map rebuilds; stable GeoJSON caching. |
| **Map Engine** | Leaflet 1.9.4; Google Hybrid Satellite, Esri World Imagery, OSM Carto Voyager basemaps; full-screen toggle, fit bounds, Nominatim location search. | Client-only Leaflet wrapper; robust ResizeObserver handling; floating glass dock controls; seamless basemap switching. |
| **Layer Management** | Dynamic layer set extraction; per-layer visibility toggle (`layerVisibility`); per-layer opacity slider (`layerOpacity`); color chips from CAD attributes. | Reactive layer management panel with instant visibility toggling, opacity sliders, feature count statistics, and color indicators. |
| **Label Rendering & LOD** | `calculateLabelFontSize`, `getLabelTier` (Tiers 1-5 for milestones/stations), collision-based `declutterTextLabels`, CAD rotation/upright modes. | Exact algorithmic preservation of label sizing, LOD thresholds, rotation transforms, and non-overlapping spatial decluttering. |
| **Measurement Tool** | Haversine/geodesic distance accumulation (`computeGeodesicDistance`); survey point snapping (`findNearestGeoJsonPoint`); vertex snapping (`findNearestVertex`); live segment and cumulative distance reporting. | High-precision geodesic measurement engine with snapping feedback, tooltips, clear/reset controls, and touch optimization. |
| **Feature Inspector** | Hover/tap card showing Layer, Geometry Type, Length in meters/km (`calculateFeatureLengthMeters`), Area in m²/ha (`calculatePolygonAreaM2`), vertex count, and custom CAD properties. | Desktop floating inspector card and mobile drawer/sheet; zero layout clipping; formatted metric and imperial units. |
| **PDF Export** | In-browser high-DPI HTML5 canvas renderer projecting Web Mercator tiles and drawing CAD geometry, text labels with halo, North arrow, scale bar, and legend; jsPDF A4 landscape/portrait export. | Modular canvas export hook; A4 orientation selection; live interactive preview; zoom coverage (30%-300%); text scaling (50%-250%); direct print & PDF download. |
| **Sharing System** | `POST /api/share` creating tokenized URLs with configurable expiration (0.5 to 720 hours); `GET /share/{share_id}` and `GET /api/share/{share_id}/geojson`. | Full Next.js shared route (`/share/[shareId]`); clean modal dialog with copy-to-clipboard; shared viewer with complete workstation features and download capabilities. |
| **Downloads** | `GET /api/download/{job_id}/{filename}` and `GET /api/share/{share_id}/download`; sanitized UTF-8 content-disposition filenames. | Direct blob/stream download handling with appropriate MIME types and fallback triggers. |
| **Responsive Behavior** | Desktop split layout; legacy mobile experience compressed elements onto smaller viewports without full gesture optimization. | Modern responsive SaaS layout; dedicated mobile tab/bottom-sheet navigation between converter controls and full-screen map workstation; min 44px touch targets. |

---

## 3. API Contract Audit

### 3.1 `POST /api/convert`
- **Request Type:** `multipart/form-data`
- **Parameters:**
  - `file`: Binary CAD file (`.dxf` or `.dwg`)
  - `input_epsg`: String, e.g. `"EPSG:32644"`
  - `output_epsg`: String, must be `"EPSG:4326"`
  - `conversion_type`: `"raw"` | `"standard"`
  - `merge_lines`: Boolean
  - `ignore_large_polygons`: Boolean
  - `label_scale`: Float (0.05 to 5.0)
  - `kml_text_mode`: String (`"screen"` | `"normal"`)
  - `export_text`: Boolean
  - `export_points`: Boolean
  - `auto_scale_text`: Boolean
  - `fill_polygons`: Boolean
  - `fill_color`: Hex string (`#rrggbb`)
  - `fill_opacity`: Float (0.0 to 1.0)
  - `output_format`: `"kml"` | `"kmz"`
- **Response Format (JSON):**
  ```json
  {
    "success": true,
    "job_id": "hex32",
    "filename": "output.kml",
    "download_url": "/api/download/{job_id}/{filename}",
    "stats": {
      "source_format": "DXF",
      "total_entities": 1200,
      "total_vertices": 4500,
      "total_shapes": 240,
      "total_markers": 960
    },
    "warnings": [],
    "timings": { "parse": 0.12, "convert": 0.28 },
    "geojson": { "type": "FeatureCollection", "features": [...] },
    "preview_truncated": false
  }
  ```

### 3.2 `GET /api/download/{job_id}/{filename}`
- **Parameters:** `job_id` (32-char hex), `filename` (URL-encoded name)
- **Response:** Binary file with `Content-Disposition: attachment; filename=...`
- **MIME Types:**
  - KML: `application/vnd.google-earth.kml+xml`
  - KMZ: `application/vnd.google-earth.kmz`

### 3.3 `POST /api/utm-zone`
- **Request:** Form data `lat`: Float, `lon`: Float
- **Response:**
  ```json
  {
    "epsg": "EPSG:32644",
    "epsg_code": 32644,
    "description": "Zone 44 (78°E - 84°E - Northern Hemisphere)"
  }
  ```

### 3.4 `GET /api/sample-file`
- **Response:** Binary `.dwg` file (`examples/Althur_padu_bund.dwg`) with `Content-Disposition` header.

### 3.5 `POST /api/share`
- **Request:** Form data `job_id`: String, `expires_in_hours`: Float
- **Response:**
  ```json
  {
    "success": true,
    "share_id": "alphanumeric",
    "share_url": "http://.../share/{share_id}",
    "expires_at": "ISO8601",
    "expires_in_hours": 24.0,
    "filename": "drawing.dwg"
  }
  ```

### 3.6 `GET /api/share/{share_id}/geojson`
- **Response:** Direct JSON `FeatureCollection` for active shared job. Returns 410 if expired.

### 3.7 `GET /api/share/{share_id}/download`
- **Response:** Binary file download for active shared job. Returns 410 if expired.

### 3.8 `GET /health`
- **Response:**
  ```json
  {
    "status": "healthy",
    "service": "dxf2kml-api",
    "version": "3.0.0",
    "dwg_supported": true,
    "temp_files_cached": 4,
    "conversions": { "succeeded": 12, "failed": 0, "rejected_busy": 0, "active": 0, "failed_by_type": {} },
    "limits": { "max_upload_mb": 25, "timeout_seconds": 120, "max_concurrent": 1 }
  }
  ```

---

## 4. Algorithmic Preservation Matrix

1. **`calculateLabelFontSize(textHeight, labelScale, zoom)`:**
   - Zoom base factor at zoom 15 with 4% adjustment per zoom level.
   - CAD height factor scaled logarithmically against drawing median text height ($ratio^{0.2}$, clamped between 0.9 and 1.2).
   - Bounds clamped between 9px and 13px.
2. **`getLabelTier(text, textHeight, medianHeight)`:**
   - Tier 1: Major drawing titles and annotations ($h \ge 1.35 \times median$ or non-chainage words $> 8$ chars).
   - Tier 2: Whole kilometer milestones (`KM X.000` or `.000`).
   - Tier 3: 500m intervals (`.500`).
   - Tier 4: 200m intervals (`.200`, `.400`, `.600`, `.800`).
   - Tier 5: Detailed 100m chainage and minor stations.
3. **`declutterTextLabels()`:**
   - Hierarchical zoom LOD thresholds: Zoom $<13$ Tier 1; Zoom 13 Tiers 1-2; Zoom 14 Tiers 1-3; Zoom 15 Tiers 1-4; Zoom $\ge 16$ All Tiers.
   - Bounding box 2D collision detection with 6px X-padding and 3px Y-padding.
4. **`computeGeodesicDistance(lat1, lon1, lat2, lon2)`:**
   - Haversine geodesic calculation with Earth radius $R = 6,371,000$ meters.
5. **`latLonToUtm(lat, lon, zoneNumber, isNorthern)`:**
   - Exact USGS / Karney WGS84 Transverse Mercator formulation with false easting (500,000 m) and southern hemisphere false northing (10,000,000 m).
6. **CAD Text Rotation & Upright Alignment:**
   - CSS rotation angle $= (-rotation) \pmod{360}$.
   - Upright orientation flips angles between $90^\circ$ and $270^\circ$ by $+180^\circ$.

---

## 5. Audit Conclusion & Roadmap
All 197 existing backend tests pass. The API contracts and algorithms are completely mapped. We proceed immediately to Phase 2 (Architecture Specification) and Phase 3 (Next.js Application Scaffolding).
