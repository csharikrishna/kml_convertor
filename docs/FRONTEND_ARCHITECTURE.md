# CAD2KML Next.js Frontend Architecture Specification

## 1. System Overview & Boundaries

The CAD2KML GIS Workstation frontend is built as a standalone Next.js 15+ App Router application situated under `/frontend`. It interfaces with the FastAPI backend via a strongly typed API layer and CORS/proxy configuration.

```
+-------------------------------------------------------------------------+
|                          Next.js Frontend (/frontend)                   |
|                                                                         |
|  +--------------------+  +--------------------+  +--------------------+ |
|  |   Converter Pane   |  |   GIS Workstation  |  | PDF / Share Modals | |
|  | - File Upload      |  | - Leaflet Map      |  | - Canvas Render    | |
|  | - Settings Accord. |  | - CAD GeoJSON      |  | - jsPDF Exporter   | |
|  | - Job Progress     |  | - Layer Controller |  | - Share Link Gen   | |
|  | - Download Center  |  | - Measurement Tool |  | - Expiry Selection | |
|  +--------------------+  +--------------------+  +--------------------+ |
|             |                       |                       |           |
|  +--------------------------------------------------------------------+ |
|  |                        Zustand Stores & Hooks                      | |
|  | - useConverterStore: file, options, status, job, result             | |
|  | - useGisStore: basemap, layers, visibility, opacity, measurement   | |
|  | - useInspectorStore: active feature, coordinates, units            | |
|  +--------------------------------------------------------------------+ |
|                                     |                                   |
|  +--------------------------------------------------------------------+ |
|  |                        Typed API Client (lib/api)                  | |
|  | - convertFile(), getSampleFile(), getUtmZone(), createShareLink()  | |
|  +--------------------------------------------------------------------+ |
+----------------------------------|--------------------------------------+
                                   | HTTP REST (JSON / Multipart / Blobs)
+----------------------------------v--------------------------------------+
|                         FastAPI Backend (:8000)                         |
|  - POST /api/convert          - GET /api/download/{job_id}/{filename}   |
|  - POST /api/utm-zone         - GET /api/sample-file                    |
|  - POST /api/share            - GET /api/share/{share_id}/geojson       |
|  - GET  /health               - GET /api/share/{share_id}/download      |
|  - dxf2kml Pipeline + ezdxf + pyproj + shapely + ODA Converter          |
+-------------------------------------------------------------------------+
```

---

## 2. Directory Structure

```text
frontend/
├── public/
│   ├── favicon.ico
│   ├── cad2kml_logo.png
│   └── cad2kml_icon.png
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Global layout, fonts, metadata
│   │   ├── page.tsx                  # Main GIS Workstation page
│   │   ├── share/
│   │   │   └── [shareId]/
│   │   │       └── page.tsx          # Shared map workstation page
│   │   └── globals.css               # Tailwind & custom GIS workstation styles
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx            # Top workstation navigation & status
│   │   │   ├── MobileTabs.tsx        # Mobile tab switcher (Converter vs Map)
│   │   │   └── StatusBar.tsx         # Bottom telemetry bar (coords, UTM, zoom)
│   │   ├── converter/
│   │   │   ├── Dropzone.tsx          # Drag-and-drop file upload with progress
│   │   │   ├── ConversionForm.tsx    # Conversion type, CRS, output format
│   │   │   ├── AdvancedOptions.tsx   # Accordion for text scale, polygons, etc.
│   │   │   ├── ProgressCard.tsx      # Multi-stage conversion progress
│   │   │   └── ResultsCard.tsx       # Download buttons and summary stats
│   │   ├── map/
│   │   │   ├── LeafletMap.tsx        # Dynamic client-only Leaflet wrapper
│   │   │   ├── MapControls.tsx       # Floating glass dock (basemap, zoom, fit)
│   │   │   ├── LayerPanel.tsx        # Layer visibility, opacity, chips
│   │   │   └── MapSearch.tsx         # Nominatim place search
│   │   ├── measurement/
│   │   │   ├── MeasurementDock.tsx   # Active measurement tool overlay
│   │   │   └── SnappingTooltip.tsx   # Snapping feedback markers
│   │   ├── inspector/
│   │   │   └── FeatureInspector.tsx  # Floating feature inspection card
│   │   ├── export/
│   │   │   └── PdfExportModal.tsx    # High-DPI Canvas & jsPDF generator
│   │   ├── sharing/
│   │   │   └── ShareModal.tsx        # Share link creation & copy modal
│   │   └── ui/                       # Radix UI / Tailwind primitives
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── slider.tsx
│   │       ├── tooltip.tsx
│   │       └── accordion.tsx
│   ├── hooks/
│   │   ├── useLeafletMap.ts          # Map instance lifecycle management
│   │   ├── useGeoJsonRenderer.ts     # GeoJSON layer synchronization
│   │   ├── useMeasurement.ts         # Measurement points, geodesic distance
│   │   └── usePdfExport.ts           # Canvas projection and sheet rendering
│   ├── stores/
│   │   ├── useConverterStore.ts      # Converter settings and job status
│   │   ├── useGisStore.ts            # Active layers, basemap, tools
│   │   └── useInspectorStore.ts      # Active inspected feature
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts             # Central typed API client & error handling
│   │   │   └── types.ts              # API request/response TypeScript types
│   │   ├── gis/
│   │   │   ├── geodesy.ts            # Haversine, polygon area, polyline length
│   │   │   ├── utm.ts                # WGS84 Transverse Mercator calculation
│   │   │   ├── labels.ts             # Label font sizing, LOD tiers, decluttering
│   │   │   └── styling.ts            # CAD feature styling, colors, and markers
│   │   └── utils.ts                  # General utilities (cn, formatting)
│   └── types/
│       ├── geojson.ts                # GeoJSON and CAD properties typings
│       └── workstation.ts            # Map and UI state typings
├── tests/
│   ├── geodesy.test.ts               # Unit tests for geodesic math & UTM
│   ├── labels.test.ts                # Unit tests for label sizing & tiers
│   └── api.test.ts                   # Unit tests for API client normalization
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

---

## 3. State Ownership & Rendering Lifecycle

1. **Leaflet Map Isolation:**
   - Leaflet interacts directly with the DOM and cannot be safely re-rendered by React diffing on every state update.
   - The map container is rendered once inside a client-side component via `next/dynamic` (`ssr: false`).
   - Changes in layer opacity or visibility do not destroy the map instance or reload basemap tiles; instead, Leaflet layer styles (`setStyle`, `setOpacity`) are updated imperatively via reactive effects in `useGeoJsonRenderer`.
2. **CAD GeoJSON Stability:**
   - Raw GeoJSON responses from `/api/convert` or `/api/share/{shareId}/geojson` are stored in memory.
   - Label decluttering and LOD zoom thresholds run inside debounced `zoomend` and `moveend` handlers rather than continuous frame intervals.
3. **Measurement System:**
   - Snapping searches KD-tree / coordinate collections of Point features and polyline vertices within a 22px screen radius using `map.latLngToContainerPoint`.
   - Distances use the exact WGS84 geodesic formula matching the legacy engine.
4. **High-DPI PDF Rendering:**
   - A dedicated 2x Retina canvas projects coordinates using Web Mercator math.
   - Satellite and street tiles are fetched asynchronously using cross-origin images.
   - Vector lines, polygons, points, labels with contrast halos, and map adornments (scale bar, North arrow, title bar) are drawn directly onto the offscreen canvas, avoiding CSS/DOM capture overhead.

---

## 4. Deployment Strategy

- **Next.js Frontend:** Standalone deployment on Vercel, Node.js container, or static export where configured.
- **Backend Communication:** `NEXT_PUBLIC_API_URL` environment variable pointing to the FastAPI backend (e.g. `http://localhost:8000` or production URL).
- **FastAPI Backend:** Preserved as-is with all system dependencies and ODA File Converter intact. Added FastAPI `CORSMiddleware` to allow seamless local and cross-origin development.
