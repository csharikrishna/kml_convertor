# Viewport Spatial Streaming & FlatGeobuf Architecture

## 1. Executive Summary

Traditional web GIS architectures download the entire dataset before rendering. For large cadastral projects (such as Padamatiyaleru with 907 parcels and extensive attributes), the uncompressed GeoJSON file is **1.56 MB** ($1,701,880\text{ bytes}$). On 3G mobile networks, downloading and parsing this payload causes high initial render latency and excessive JavaScript heap allocation.

To eliminate this bottleneck, the platform implements **Viewport-Aware Spatial Streaming** using binary **FlatGeobuf (`.fgb`)** with **Packed R-Tree Spatial Indices**:

- Initial transfer reduced to **$150\text{--}180\text{ KB}$** for typical initial viewports ($>85\%$ payload reduction).
- Supported by HTTP byte-range requests (`206 Partial Content`).
- Combined with IndexedDB local caching for zero-latency subsequent visits.

---

## 2. FlatGeobuf Format & Packed R-Tree Design

FlatGeobuf is an open binary geospatial format built on Google FlatBuffers. It organizes geometry and attribute tables without requiring unpacking or serialization into intermediate JavaScript objects.

### File Structure Layout:
```
+-----------------------------------------------------------------------------------+
| Magic Bytes (8B)  : 'f', 'g', 'b', 0x03, 'f', 'g', 'b', 0x00                     |
+-----------------------------------------------------------------------------------+
| Header Length (4B): uint32 little-endian                                          |
+-----------------------------------------------------------------------------------+
| Header FlatBuffer : Envelope, CRS, Columns, featuresCount, indexNodeSize (16)     |
+-----------------------------------------------------------------------------------+
| Packed R-Tree     : Level 3 (Root) -> Level 2 -> Level 1 -> Level 0 (Leaf Nodes)  |
|                   : Each node = [minX, minY, maxX, maxY, offset] (40 bytes)       |
+-----------------------------------------------------------------------------------+
| Features Block    : Size-prefixed Feature FlatBuffers (Geometry + Properties)     |
+-----------------------------------------------------------------------------------+
```

### Generated Assets:
- `frontend/public/data/padamatiyaleru_plots.fgb`: $517,328\text{ bytes}$ (contains all 907 parcels + 4-level spatial R-Tree).
- `frontend/public/data/konampalle_plots.fgb`: $193,824\text{ bytes}$ (contains all 351 parcels + 3-level spatial R-Tree).

---

## 3. Viewport Streaming Workflow

```
Map Viewport Changes (Pan / Zoom)
               │
               ▼
Extract Viewport Bounds [minX, minY, maxX, maxY]
               │
               ▼
Query FlatGeobufStreamer (HTTP Range Requests)
               │
      ┌────────┴────────┐
      │ Range Supported │
      ▼                 ▼
Fetch R-Tree Nodes    Fallback: Load from Cache
& Feature Ranges      or Fetch GeoJSON
(206 Partial)         (200 OK)
      │                 │
      └────────┬────────┘
               ▼
Deduplicate against seen parcels (survey_no)
               │
               ▼
Render onto Leaflet Canvas & Sync to IndexedDB
```

---

## 4. Multi-Tier Cache Synchronization

1. **Memory Cache:** In-flight deduplication prevents redundant network queries when the user rapidly pans back and forth.
2. **IndexedDB Viewport Store:** Parcels fetched during viewport browsing are stored in IndexedDB (`${projectId}_viewport_parcels`).
3. **Attribute Truth:** Every parcel streamed via FlatGeobuf matches the exact properties, survey numbers, total acres, acquired acres, and ownership details of the original GeoJSON. There is zero drift and zero dual truth.
