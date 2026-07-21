# DXF2KML: Production-Grade AutoCAD DXF to Google Earth KML Converter

A high-performance Python package and CLI tool designed to convert AutoCAD DXF survey drawings into Google Earth compatible KML files. `dxf2kml` faithfully reproduces CAD geometry, layer hierarchies, styling (colors and lineweights), block insertions, point symbols, and text labels inside Google Earth while intelligently cleaning up construction frames and sheet layout borders.

---

## Key Features

- **Entity Support**: `LINE`, `LWPOLYLINE`, `POLYLINE`, `POINT`, `TEXT`, `MTEXT`, `INSERT` (recursive block expansion), `HATCH`, `ARC`, `CIRCLE`, `ELLIPSE`, and `SPLINE`.
- **Fault-Tolerant & Robust**: Unknown or malformed entities are safely logged with warnings (`WARNING: Unsupported entity XXXX skipped`) without crashing execution.
- **Topology Reconstruction**:
  - Automatically merges contiguous touching line segments into single continuous `LineString` elements using NetworkX graph analysis.
  - Automatically identifies closed line loops and converts them into KML `Polygon` elements with interior holes.
- **Construction Frame & Sheet Border Filtering**:
  - Detects and filters out giant layout boxes, title blocks, and outer sheet borders using bounding box, area ratio, segment length, and z-score outlier analysis.
- **Coordinate Reference System (CRS) Transformation**:
  - Configurable source CRS (default `EPSG:32644` UTM Zone 44N) and target CRS (`EPSG:4326` WGS84) powered by `pyproj`.
- **Text & MText Processing**:
  - Strips complex AutoCAD MTEXT formatting tags (`\P`, `\f...;`, `\H...;`, `\C...;`) while preserving text rotation, height, layer, placement, and content.
- **Layer & Style Preservation**:
  - Organizes output into KML Folders corresponding 1:1 with AutoCAD layers.
  - Maps AutoCAD Color Index (ACI 1–255) and RGB True Color to KML hex styles (`aabbggrr`).

---

## Tech Stack & Architecture

- **Python**: 3.11+
- **Parsing**: `ezdxf`
- **Spatial Analysis**: `shapely`, `networkx`, `numpy`, `scipy`
- **CRS Transformation**: `pyproj`
- **KML Generation**: `simplekml`
- **CLI & Logging**: `typer`, `rich`, `loguru`, `pydantic`, `pyyaml`

---

## Installation

### Prerequisites
Python 3.11 or later.

```bash
git clone https://github.com/your-org/dxf2kml.git
cd kml_convertor
pip install -e .
```

Or install dependencies directly:
```bash
pip install -r requirements.txt
```

---

## CLI Usage

### Basic Usage

```bash
python main.py --input survey.dxf --output survey.kml
```

### Full Options Example

```bash
python main.py \
    --input survey.dxf \
    --output survey.kml \
    --input-epsg 32644 \
    --output-epsg 4326 \
    --ignore-large-polygons \
    --merge-lines \
    --merge-distance 0.05 \
    --export-text \
    --export-points \
    --config examples/sample_config.yaml
```

### CLI Command Options

| Parameter | Short | Description | Default |
| :--- | :--- | :--- | :--- |
| `--input` | `-i` | Input AutoCAD DXF file path (Required) | N/A |
| `--output` | `-o` | Output KML file path | `<input_basename>.kml` |
| `--input-epsg` | | Source CRS EPSG code | `EPSG:32644` |
| `--output-epsg` | | Target CRS EPSG code | `EPSG:4326` |
| `--ignore-large-polygons` | | Filter out layout sheet borders | `True` |
| `--merge-lines` | | Merge touching line segments | `True` |
| `--merge-distance` | | Distance threshold (in input CRS units) to join vertices | `0.05` |
| `--export-text` | | Export TEXT / MTEXT as KML Placemarks | `True` |
| `--export-points` | | Export POINT entities as Placemarks | `True` |
| `--config` | `-c` | Path to YAML configuration file | Optional |
| `--verbose` | `-v` | Enable detailed debug logs | `False` |

---

## Configuration File (YAML)

You can pass a YAML configuration file to customize parameters across pipeline steps:

```yaml
input_epsg: "EPSG:32644"
output_epsg: "EPSG:4326"

merge_lines: true
merge_distance: 0.05
ignore_large_polygons: true
export_text: true
export_points: true
export_hatches: true

# Border & Frame filtering thresholds
max_segment_length: 5000.0
max_area_ratio: 0.7
border_z_score_threshold: 3.0

# Styling options
default_line_width: 2.5
default_line_color: "ff0000ff"
default_point_scale: 0.8
default_label_scale: 1.0
```

---

## Supported AutoCAD Entities

| DXF Entity | KML Representation | Features Preserved |
| :--- | :--- | :--- |
| `LINE` | LineString (or Merged Polygon) | Color, lineweight, layer |
| `LWPOLYLINE` | LineString or Polygon | Topology, vertices, closed loops |
| `POLYLINE` | LineString or Polygon | 2D/3D polyline vertices |
| `POINT` | Placemark | Coordinates, color, custom icon |
| `TEXT` | Placemark (Label) | Cleaned text content, height, layer |
| `MTEXT` | Placemark (Label) | Formatting tags stripped (`\P`), content |
| `INSERT` | Expanded nested entities | WCS transformed translation, rotation, scale |
| `HATCH` | Polygon | Exterior/interior boundary paths |
| `ARC` | LineString | Tessellated curve vertices |
| `CIRCLE` | Polygon / LineString | Tessellated 360-degree boundary |
| `ELLIPSE` | LineString / Polygon | Discretized elliptical geometry |
| `SPLINE` | LineString | Flattened B-spline control curves |

---

## Execution Output Summary Example

When running `dxf2kml`, a clean execution summary is output via `loguru`:

```text
==================================================
Loaded 824 entities
Merged 32 lines
Ignored 2 construction rectangles
Exported
  12 polygons
  41 polylines
  52 points
  13 labels
Finished in 0.8 seconds
==================================================
```

### Web Application & Live Satellite Map

Launch the interactive web UI server locally:

```bash
python main.py web --port 8000
```
Then visit `http://localhost:8000/` in your browser.

**Web App Features**:
- Dual-panel UI with interactive Esri World Imagery Satellite Map.
- Automatic UTM zone detection based on map clicks or browser geolocation.
- Live GeoJSON preview of converted CAD vectors overlaid on satellite imagery.
- Instant validation for `.dwg` files with clear conversion instructions.
- FastAPI interactive documentation available at `/docs`.

---

## Cloud Deployment

### 1. Deploying with Docker

Build and run the Docker image:

```bash
docker build -t dxf2kml-app .
docker run -p 8000:8000 dxf2kml-app
```

### 2. Deploying on Render / Railway / Heroku

The repository includes `render.yaml` and `Procfile` for 1-click cloud deployment:

- **Render**: Connect your GitHub repository and select **New Web Service** (Render will auto-detect `render.yaml`).
- **Railway / Heroku**: Connect your GitHub repository and set the start command to:
  ```bash
  uvicorn web_app.app:app --host 0.0.0.0 --port $PORT
  ```

---

## Testing

Run unit tests via `pytest`:

```bash
pytest -v
```

---

## Limitations

- **3D Solid Meshes**: 3D surfaces (`3DFACE`, `MESH`, `SOLID`) are skipped with a warning.
- **Custom Fonts**: Text labels rely on standard Google Earth font rendering.
- **Extrusions/UCS**: Entities are projected assuming WCS coordinates or exploded block transformations.
