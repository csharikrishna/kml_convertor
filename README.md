# DXF2KML: AutoCAD DXF/DWG to Google Earth KML/KMZ Converter

Converts AutoCAD DXF (and, with the ODA File Converter, DWG) survey drawings into Google
Earth KML/KMZ: geometry, layers, colors, lineweights, blocks, hatches, points and text
labels, projected from a user-selected CRS (e.g. UTM) to WGS84. Available as a CLI and as a
FastAPI web application with a satellite-map preview.

---

## Conversion pipeline

```text
upload/file ─► DWG? ─► ODA File Converter (subprocess, timeout, headless) ─► DXF
            ─► ezdxf load (recovery reader fallback for damaged files)
            ─► parse: recursive block expansion (composed matrices), BYLAYER/BYBLOCK/layer-0
               inheritance, OCS→WCS, exact arc/bulge tessellation, splines, hatches, text
            ─► geometry: closed paths → polygons; open paths of the same layer AND style are
               snapped, polygonized and line-merged (no edge lost or duplicated)
            ─► frame filter: removes sheet borders that enclose other content
            ─► CRS transform (pyproj, always_xy, errcheck) + plausibility check
            ─► streaming KML writer (one folder per layer) ─► optional KMZ
```

## Supported AutoCAD entities

| DXF entity | KML output | Notes |
| :--- | :--- | :--- |
| `LINE` | LineString (merged) or Polygon | Touching segments of the same layer and style are joined; closed loops become polygons |
| `LWPOLYLINE`, `POLYLINE` (2D/3D) | LineString or Polygon | Bulge arcs tessellated exactly; OCS/extrusion honoured; spline-fit frame vertices skipped |
| `ARC`, `CIRCLE`, `ELLIPSE` | LineString / Polygon | Points exactly on the curve; sagitta ≤ `flattening_distance` |
| `SPLINE` | LineString / Polygon | Control points, fit points, weights (rational), closed/periodic splines |
| `HATCH`, `MPOLYGON` | Filled Polygon(s) with holes | Multiple areas, holes and islands (normal/outer/ignore styles) |
| `SOLID`, `TRACE`, `3DFACE` | Polygon | |
| `INSERT` / `MINSERT` | Expanded content | Nested blocks, arrays, mirroring, non-uniform scaling; recursion and depth guards |
| `ATTRIB` | Label | Visible block attributes (invisible ones skipped) |
| `DIMENSION`, `LEADER`, `MULTILEADER`, `MLINE` | Lines, arrows, labels | Exploded into their graphical parts |
| `POINT` | Placemark | |
| `TEXT`, `MTEXT` | Label placemark | MTEXT formatting removed; `%%d/%%c/%%p`, `\U+XXXX` (e.g. Telugu) and stacked fractions decoded |

Not converted (reported as warnings, never silently dropped): 3D solids/regions/meshes
(`3DSOLID`, `REGION`, `MESH`, polyface `POLYLINE`), `IMAGE`, `XLINE`/`RAY`, `ACAD_TABLE`,
invisible entities. Only model space is converted; paper-space layouts are ignored.

Colors: ACI, true color and layer true color are resolved with AutoCAD's BYLAYER/BYBLOCK
rules and written as KML `aabbggrr`. Lineweights (mm) become KML widths (px, 96 dpi).
Feature attributes (layer, type, area/length in CRS units, text) are written as KML
`ExtendedData` — Google Earth shows them in the balloon, GIS tools import them as fields.

## Coordinate reference systems

* The source CRS must be chosen by the user (EPSG code, default `EPSG:32644`, UTM 44N).
  DXF files rarely contain a CRS and the drawing units header (`$INSUNITS`) is frequently
  wrong, so **the converter never guesses a CRS**.
* KML requires WGS84 longitude/latitude; any other output CRS is rejected.
* If the drawing's coordinates fall outside the selected CRS's area of use (typical for
  a wrong UTM zone or a local, non-georeferenced drawing) the conversion succeeds but
  returns a prominent warning. Coordinates that cannot be projected at all fail the
  conversion instead of producing `inf`.

---

## Installation

Python 3.11+.

```bash
pip install -r requirements.txt          # pinned, tested versions
# or, as a package:
pip install -e ".[web]"
```

## CLI usage

```bash
python main.py convert --input survey.dxf --output survey.kml
python main.py convert -i survey.dxf -o survey.kmz --input-epsg 32643     # KMZ by extension
python main.py convert -i survey.dxf -c examples/sample_config.yaml -v
```

| Option | Description | Default |
| :--- | :--- | :--- |
| `--input`, `-i` | Input DXF/DWG file (required) | |
| `--output`, `-o` | Output `.kml` or `.kmz` | `<input>.kml` |
| `--input-epsg` | Source CRS (`32644` or `EPSG:32644`) | `EPSG:32644` |
| `--output-epsg` | Must be WGS84 | `EPSG:4326` |
| `--ignore-large-polygons/--no-ignore-large-polygons` | Remove sheet borders / frames | on |
| `--merge-lines/--no-merge-lines` | Merge touching segments | on |
| `--merge-distance` | Endpoint snapping tolerance (CRS units) | `0.05` |
| `--export-text/--no-export-text` | TEXT/MTEXT/ATTRIB labels | on |
| `--export-points/--no-export-points` | POINT placemarks | on |
| `--label-scale` | Base KML label scale | `0.7` |
| `--config`, `-c` | YAML configuration file | |
| `--verbose`, `-v` | Debug logging | off |

The exit code is 1 for conversion errors (invalid file, CRS, limits). All
`ConverterConfig` fields can be set in YAML — see `dxf2kml/config.py` and
`examples/sample_config.yaml` (tolerances, frame-filter thresholds, styling, limits).

## Web application

```bash
python main.py web --port 8000        # http://localhost:8000, API docs at /docs
```

### API

| Method & path | Purpose |
| :--- | :--- |
| `POST /api/convert` | multipart form: `file` (.dxf/.dwg), `input_epsg`, `output_epsg` (`EPSG:4326` only), `conversion_type` (`raw`/`standard`), `output_format` (`kml`/`kmz`), `merge_lines`, `ignore_large_polygons`, `export_text`, `export_points`, `auto_scale_text`, `label_scale` (0.05–5), `fill_polygons`, `fill_color` (`#rrggbb`), `fill_opacity` (0–1). Returns `job_id`, `filename`, `download_url`, `stats` (counts, unsupported/skipped entities), `warnings`, `timings`, `geojson` preview, `preview_truncated`. |
| `GET /api/download/{job_id}/{filename}` | Download the result (expires after `OUTPUT_TTL_SECONDS`). |
| `POST /api/utm-zone` | form `lat`, `lon` → UTM EPSG code (incl. Norway/Svalbard exceptions). |
| `GET /health` | Status, version, DWG support, limits, conversion counters. |

Status codes: `400` invalid input/options/CRS, `413` file or drawing exceeds limits,
`422` DWG conversion impossible, `503` busy (retry, `Retry-After`), `500` unexpected
(message contains a reference id; details only in server logs).

Uploaded drawings are deleted as soon as the conversion finishes; outputs are kept for
download until they expire. Conversions run in a worker thread with bounded concurrency,
so the server keeps answering (including `/health`) during long conversions.

### Configuration (environment variables)

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `MAX_UPLOAD_MB` | 25 | Maximum upload size |
| `MAX_ENTITIES` / `MAX_VERTICES` | 500000 / 2000000 | Drawing complexity limits (after block expansion) |
| `CONVERSION_TIMEOUT_SECONDS` | 120 | Per-conversion time budget |
| `MAX_CONCURRENT_CONVERSIONS` | 1 | Parallel conversions (others get 503) |
| `QUEUE_WAIT_SECONDS` | 10 | How long a request waits for a free slot before 503 |
| `OUTPUT_TTL_SECONDS` | 3600 | How long results can be downloaded |
| `PREVIEW_MAX_VERTICES` | 150000 | Size cap for the map preview payload |
| `DXF2KML_TEMP_DIR` | `<tmp>/dxf2kml_web` | Working directory for jobs |
| `ODA_FILE_CONVERTER` | auto-detect | Path to the ODA File Converter executable |
| `ODA_TIMEOUT_SECONDS` / `ODA_MAX_CONCURRENCY` | 120 / 1 | DWG conversion subprocess limits |
| `LOG_LEVEL` / `LOG_JSON` | INFO / 0 | Logging (`LOG_JSON=1` for structured JSON logs) |

**Memory sizing** (measured in a 512 MB Docker container): about 105 MiB baseline plus
~0.35 MiB per 1,000 vertices — a 5.4 MB DXF (440k vertices) peaks at ~258 MiB, a 13.6 MB DXF
(1.1M vertices) at ~490 MiB. `render.yaml` therefore uses `MAX_UPLOAD_MB=10` and
`MAX_VERTICES=800000` for a 512 MB instance; raise both together with the instance size.

---

## Deployment

**DWG support requires Docker.** The ODA File Converter is a closed-source Qt6 binary that
needs system X11/GL/font libraries and a virtual display (Xvfb); a native PaaS Python
runtime cannot install those. The `Dockerfile` downloads the ODA package at build time and
verifies its SHA-256 (it is not stored in git — see `dependencies/README.md`).

```bash
docker build -t dxf2kml .                          # with DWG support
docker build --target test .                       # run the test suite inside the image
docker run -p 8000:8000 -e MAX_UPLOAD_MB=25 dxf2kml
```

* **Render:** `render.yaml` defines a Docker web service with `/health` checks and limits
  sized for the free (512 MB) plan. Connect the repository as a Blueprint.
* **Heroku / Railway (native Python):** the `Procfile` works, but only DXF is supported
  there; the UI hides the DWG option automatically.
* The service keeps job files on local disk, so run a single instance (or add shared
  storage) — downloads must reach the instance that performed the conversion.

---

## Development

```bash
pip install -r requirements-dev.txt
pytest                      # unit, integration, web and golden tests
ruff check .
python benchmarks/bench_pipeline.py --sizes 100 1000 5000
```

The DWG test using the real ODA converter runs only where the converter is installed
(e.g. `docker build --target test .`).

## Limitations

* Only model space is converted; 3D solids/meshes, images and tables are reported but
  not converted. Text rotation is not representable in KML labels.
* HATCH boundaries made of *edge* arcs are approximated with Bézier curves by ezdxf
  (radial deviation ≤ 0.027% of the arc radius); polyline boundaries and all ARC/CIRCLE/
  bulge geometry are exact to the flattening tolerance.
* Frozen/off layers are exported (layer visibility state is not interpreted).
* The frame filter drops single segments longer than `max_segment_length` (default
  5000 CRS units) and polygons that dominate the drawing extent *and enclose other
  content*; disable it with `--no-ignore-large-polygons` if needed. Every removal is logged
  and counted in the result.
