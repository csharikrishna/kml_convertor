"""Cadastral Village Survey & Canal Land Acquisition Analysis Engine.

Performs planar polygonization of CAD plot boundaries, point-in-polygon
association of survey plot numbers, and spatial intersection against canal
right-of-way corridors to calculate Total, Acquired, and Balance acreage.
"""

from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import ezdxf
from loguru import logger
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import polygonize, unary_union, snap
from shapely import STRtree

from dxf2kml.dwg import convert_dwg_to_dxf

ACRES_PER_M2 = 1.0 / 4046.8564224


def clean_plot_text(text: str) -> str:
    """Normalize survey plot text label."""
    if not text:
        return ""
    # Strip common AutoCAD formatting codes like \\P, \\C7, etc.
    t = text.replace("\\P", "\n").replace("\\p", "\n")
    lines = [line.strip() for line in t.splitlines() if line.strip()]
    if not lines:
        return ""
    # Take primary line
    primary = lines[0]
    # Remove leading/trailing non-alphanumeric except slashes and dashes
    import re
    cleaned = re.sub(r'[\r\n\t]+', ' ', primary).strip()
    return cleaned


def analyze_cadastral_dwg(
    dwg_or_dxf_path: Path | str,
    input_epsg: str = "EPSG:32643",
    village_name: Optional[str] = None,
    mandal_name: Optional[str] = None,
    district_name: Optional[str] = None,
    canal_buffer_meters: float = 12.5,
) -> Dict[str, Any]:
    """Run full Cadastral Land Acquisition analysis on a DWG/DXF drawing."""
    file_path = Path(dwg_or_dxf_path)
    if not file_path.is_file():
        raise FileNotFoundError(f"CAD drawing not found: {file_path}")

    # Auto-detect village from filename if not specified
    fname = file_path.name.upper()
    if not village_name:
        if "PADAMATIYALERU" in fname:
            village_name = "Padamatiyaleru"
            mandal_name = mandal_name or "Beluguppa"
            district_name = district_name or "Anantapur"
        elif "KONAMPALLE" in fname:
            village_name = "Konampalle"
            mandal_name = mandal_name or "Beluguppa"
            district_name = district_name or "Anantapur"
        else:
            village_name = "Survey Village"
            mandal_name = mandal_name or "Cadastral Mandal"
            district_name = district_name or "District"

    # Initialize coordinate transformer to WGS84 for Leaflet map display
    transformer = Transformer.from_crs(input_epsg, "EPSG:4326", always_xy=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        if file_path.suffix.lower() == ".dwg":
            logger.info("Converting DWG to DXF for cadastral parsing: {}", file_path.name)
            dxf_path = convert_dwg_to_dxf(file_path, tmp_path)
        else:
            dxf_path = file_path

        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()

        plot_lines: List[LineString] = []
        plot_texts: List[Dict[str, Any]] = []
        canal_lines: List[LineString] = []
        road_lines: List[LineString] = []
        village_boundary_lines: List[LineString] = []
        structure_points: List[Dict[str, Any]] = []
        chainage_points: List[Dict[str, Any]] = []

        for e in msp:
            dxftype = e.dxftype()
            layer = e.dxf.layer.upper()

            # 1. Plot boundary lines & survey text labels
            if "PLOT" in layer or "PARCEL" in layer or "CADASTRAL" in layer or "REVENUE" in layer:
                if dxftype == "LWPOLYLINE":
                    pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                    if len(pts) > 1:
                        plot_lines.append(LineString(pts))
                elif dxftype == "LINE":
                    plot_lines.append(
                        LineString([
                            (float(e.dxf.start.x), float(e.dxf.start.y)),
                            (float(e.dxf.end.x), float(e.dxf.end.y)),
                        ])
                    )
                if dxftype in ("TEXT", "MTEXT"):
                    raw_text = e.dxf.text if dxftype == "TEXT" else getattr(e, "text", "")
                    clean_txt = clean_plot_text(raw_text)
                    ins = getattr(e.dxf, "insert", None)
                    if clean_txt and ins:
                        plot_texts.append({
                            "text": clean_txt,
                            "pt": Point(float(ins.x), float(ins.y)),
                            "rotation": float(getattr(e.dxf, "rotation", 0.0)),
                        })

            # 2. Village Boundary lines (used for polygonization + visual boundary)
            elif "VILLAGE BOUNDRY" in layer or "VILLAGE BOUNDARY" in layer:
                if dxftype == "LWPOLYLINE":
                    pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                    if len(pts) > 1:
                        plot_lines.append(LineString(pts))
                        village_boundary_lines.append(LineString(pts))
                elif dxftype == "LINE":
                    line = LineString([
                        (float(e.dxf.start.x), float(e.dxf.start.y)),
                        (float(e.dxf.end.x), float(e.dxf.end.y)),
                    ])
                    plot_lines.append(line)
                    village_boundary_lines.append(line)

            # 3. Survey Numbers (Labels) on explicit survey layers
            elif "SURVEY NO" in layer or "SURVEY" in layer:
                if dxftype in ("TEXT", "MTEXT"):
                    raw_text = e.dxf.text if dxftype == "TEXT" else getattr(e, "text", "")
                    clean_txt = clean_plot_text(raw_text)
                    ins = getattr(e.dxf, "insert", None)
                    if clean_txt and ins:
                        plot_texts.append({
                            "text": clean_txt,
                            "pt": Point(float(ins.x), float(ins.y)),
                            "rotation": float(getattr(e.dxf, "rotation", 0.0)),
                        })

            # 4. Canal alignment and RoW
            elif "CANAL" in layer:
                if dxftype == "LWPOLYLINE":
                    pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                    if len(pts) > 1:
                        canal_lines.append(LineString(pts))
                elif dxftype == "LINE":
                    canal_lines.append(
                        LineString([
                            (float(e.dxf.start.x), float(e.dxf.start.y)),
                            (float(e.dxf.end.x), float(e.dxf.end.y)),
                        ])
                    )

            # 5. Roads & Cart Tracks (provide natural parcel boundary enclosures)
            elif "ROAD" in layer or "CART TRACK" in layer:
                if dxftype == "LWPOLYLINE":
                    pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                    if len(pts) > 1:
                        road_lines.append(LineString(pts))
                        plot_lines.append(LineString(pts))
                elif dxftype == "LINE":
                    line = LineString([
                        (float(e.dxf.start.x), float(e.dxf.start.y)),
                        (float(e.dxf.end.x), float(e.dxf.end.y)),
                    ])
                    road_lines.append(line)
                    plot_lines.append(line)

            # 6. Structures
            elif "STRUCTURE" in layer:
                if dxftype in ("TEXT", "MTEXT"):
                    raw_text = e.dxf.text if dxftype == "TEXT" else getattr(e, "text", "")
                    ins = getattr(e.dxf, "insert", None)
                    if raw_text and ins:
                        structure_points.append({
                            "title": clean_plot_text(raw_text),
                            "x": float(ins.x),
                            "y": float(ins.y),
                        })

            # 7. Chainages
            elif "CH" in layer or "CSMARK" in layer:
                if dxftype in ("TEXT", "MTEXT"):
                    raw_text = e.dxf.text if dxftype == "TEXT" else getattr(e, "text", "")
                    ins = getattr(e.dxf, "insert", None)
                    if raw_text and ins:
                        clean_ch = clean_plot_text(raw_text)
                        if clean_ch:
                            try:
                                val = float(clean_ch.replace("KM", "").replace("km", "").replace("Ch.", "").replace("+", ".").strip())
                                km = int(val)
                                m = int(round((val - km) * 1000))
                                label = f"Ch. {km}+{m:03d}"
                                formatted = f"KM {val:.3f}"
                            except Exception:
                                label = f"Ch. {clean_ch}"
                                formatted = clean_ch
                            chainage_points.append({
                                "chainage": formatted,
                                "label": label,
                                "x": float(ins.x),
                                "y": float(ins.y),
                            })

    logger.info(
        "Extracted cadastral primitives: {} plot lines, {} plot texts, {} canal lines",
        len(plot_lines),
        len(plot_texts),
        len(canal_lines),
    )

    # 8. Reconstruct closed parcel polygons using planar topology with snapping
    if not plot_lines:
        ignored_keywords = ("CANAL", "TEXT", "MTEXT", "DIM", "CONTOUR", "GRID", "CHAIN", "DEFPOINTS")
        for e in msp:
            l_upper = e.dxf.layer.upper()
            if any(ign in l_upper for ign in ignored_keywords):
                continue
            dxftype = e.dxftype()
            if dxftype == "LWPOLYLINE":
                pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                if len(pts) > 1:
                    plot_lines.append(LineString(pts))
            elif dxftype == "LINE":
                plot_lines.append(LineString([
                    (float(e.dxf.start.x), float(e.dxf.start.y)),
                    (float(e.dxf.end.x), float(e.dxf.end.y)),
                ]))

    if not plot_lines:
        raise ValueError("No valid parcel boundary lines or closed polylines found in this CAD drawing.")

    # Snap plot boundary lines to close CAD draftsman undershoot gaps (up to 2.0m)
    union_raw = unary_union(plot_lines)
    union_snapped = unary_union(snap(union_raw, union_raw, 2.0))
    raw_polys = list(polygonize(union_snapped))
    # Filter out tiny sliver artifacts (< 50 m^2) and enormous outer boundary sheets
    valid_polys: List[Polygon] = [p for p in raw_polys if 50.0 < p.area < 100_000_000.0]
    logger.info("Constructed {} valid parcel polygons from topology", len(valid_polys))

    if not valid_polys:
        raise ValueError("Failed to construct closed polygons from plot boundary lines.")

    # 9. Assemble Canal Corridor Geometry
    canal_corridor = None
    if canal_lines:
        # Buffer lines by the canal width / 2 to create the RoW corridor
        buffered = [line.buffer(canal_buffer_meters) for line in canal_lines]
        canal_corridor = unary_union(buffered)

    # 10. Spatial Index & Association of Survey Numbers
    tree = STRtree(valid_polys)
    matched_parcels: Dict[int, Dict[str, Any]] = {}
    survey_register: List[Dict[str, Any]] = []

    def build_parcel_record(
        poly: Polygon,
        s_no: str,
        land_type: str = "Ryotwari Patta",
        is_poramboke: bool = False,
    ) -> Dict[str, Any]:
        t_area_m2 = poly.area
        t_acres = t_area_m2 * ACRES_PER_M2

        c_passing = False
        acq_area_m2 = 0.0
        acq_acres = 0.0
        bal_area_m2 = t_area_m2
        bal_acres = t_acres
        c_length_m = 0.0
        ch_str = "Non-acquired"
        inter_geom = None

        if canal_corridor is not None and poly.intersects(canal_corridor):
            try:
                igeom = poly.intersection(canal_corridor)
                if not igeom.is_empty and igeom.area > 1.0:
                    c_passing = True
                    acq_area_m2 = igeom.area
                    acq_acres = acq_area_m2 * ACRES_PER_M2
                    bal_area_m2 = max(0.0, t_area_m2 - acq_area_m2)
                    bal_acres = max(0.0, t_acres - acq_acres)
                    inter_geom = igeom

                    for c_line in canal_lines:
                        if poly.intersects(c_line):
                            cut = poly.intersection(c_line)
                            c_length_m += cut.length

                    nearby_chs = []
                    for ch in chainage_points:
                        ch_pt = Point(ch["x"], ch["y"])
                        if poly.distance(ch_pt) < 120.0:
                            nearby_chs.append(ch.get("label", ch["chainage"]))
                    if len(nearby_chs) == 1:
                        ch_str = nearby_chs[0]
                    elif len(nearby_chs) >= 2:
                        ch_str = f"{nearby_chs[0]} - {nearby_chs[-1]}"
                    else:
                        ch_str = "Within Canal RoW"
            except Exception as ex:
                logger.warning("Error during canal intersection: {}", ex)

        whole_ac = math.floor(t_acres)
        cents = round((t_acres - whole_ac) * 100.0, 1)
        ac_cts_str = f"{whole_ac} Ac {cents} Cts"

        return {
            "survey_no": s_no,
            "land_type": land_type,
            "is_poramboke": is_poramboke,
            "village": village_name,
            "mandal": mandal_name,
            "district": district_name,
            "total_area_m2": round(t_area_m2, 1),
            "total_acres": round(t_acres, 2),
            "total_ac_cts": ac_cts_str,
            "canal_passing": c_passing,
            "acquired_area_m2": round(acq_area_m2, 1),
            "acquired_acres": round(acq_acres, 2),
            "balance_area_m2": round(bal_area_m2, 1),
            "balance_acres": round(bal_acres, 2),
            "chainage_range": ch_str,
            "canal_length_m": round(c_length_m, 1),
            "canal_width_m": canal_buffer_meters * 2.0 if c_passing else 0.0,
            "poly": poly,
            "intersection_geom": inter_geom,
        }

    # Pass 1: Direct interior containment
    assigned_text_indices = set()
    for t_idx, item in enumerate(plot_texts):
        pt = item["pt"]
        hits = tree.query(pt, predicate="intersects")
        if len(hits) == 0:
            continue

        poly_idx = hits[0]
        assigned_text_indices.add(t_idx)

        # Check if text designates a public road, cart track, or poramboke corridor
        txt = item["text"]
        is_corridor = any(k in txt.lower() for k in ["miles", "to ", "cart", "road", "vagu", "vanka", "rasta", "bata", "canal"])
        land_type = "Government Poramboke (Rasta)" if is_corridor else "Ryotwari Patta"

        if poly_idx in matched_parcels:
            existing = matched_parcels[poly_idx]
            if txt not in existing["survey_no"]:
                existing["survey_no"] = f"{existing['survey_no']}, {txt}"
            continue

        poly = valid_polys[poly_idx]
        parcel_info = build_parcel_record(poly, txt, land_type=land_type, is_poramboke=is_corridor)
        matched_parcels[poly_idx] = parcel_info
        survey_register.append(parcel_info)

    # Pass 2: Boundary proximity snapping for unassigned texts (e.g. road labels placed 0.5 - 20m from verge)
    for t_idx, item in enumerate(plot_texts):
        if t_idx in assigned_text_indices:
            continue
        pt = item["pt"]
        nearby = tree.query(pt.buffer(20.0), predicate="intersects")
        unassigned_nearby = [idx for idx in nearby if idx not in matched_parcels]
        if unassigned_nearby:
            closest_idx = min(unassigned_nearby, key=lambda idx: valid_polys[idx].distance(pt))
            if valid_polys[closest_idx].distance(pt) <= 20.0:
                assigned_text_indices.add(t_idx)
                poly = valid_polys[closest_idx]
                txt = item["text"]
                is_corridor = any(k in txt.lower() for k in ["miles", "to ", "cart", "road", "vagu", "vanka", "rasta", "bata", "canal"])
                land_type = "Government Poramboke (Rasta)" if is_corridor else "Ryotwari Patta"

                parcel_info = build_parcel_record(poly, txt, land_type=land_type, is_poramboke=is_corridor)
                matched_parcels[closest_idx] = parcel_info
                survey_register.append(parcel_info)

    # Pass 3: Poramboke & Public Corridor recovery for remaining unassigned closed polygons
    poramboke_counter = 1
    road_counter = 1
    road_union = unary_union(road_lines) if road_lines else None
    for poly_idx, poly in enumerate(valid_polys):
        if poly_idx in matched_parcels:
            continue
        is_road = road_union is not None and poly.intersects(road_union)
        canal_hit = canal_corridor is not None and poly.intersects(canal_corridor)
        touches_known = any(poly.touches(valid_polys[m]) for m in matched_parcels)

        # Include all contiguous parcels in the cadastral fabric to prevent awkward blank voids
        if canal_hit or touches_known or is_road:
            if is_road:
                s_no = f"Cart Track / Road (R-{road_counter})"
                l_type = "Government Poramboke (Rasta)"
                road_counter += 1
            else:
                s_no = f"Govt Poramboke (P-{poramboke_counter})"
                l_type = "Government Land (Poramboke)"
                poramboke_counter += 1

            parcel_info = build_parcel_record(poly, s_no, land_type=l_type, is_poramboke=True)
            matched_parcels[poly_idx] = parcel_info
            survey_register.append(parcel_info)

    logger.info("Associated {} survey plots with geometry and area metrics", len(survey_register))

    # Convert geometries to GeoJSON in WGS84
    def transform_coords(coords: Any) -> Any:
        if isinstance(coords, (tuple, list)) and len(coords) >= 2 and isinstance(coords[0], (int, float)):
            x, y = coords[0], coords[1]
            lon, lat = transformer.transform(x, y)
            return [round(lon, 7), round(lat, 7)]
        elif isinstance(coords, (tuple, list)):
            return [transform_coords(c) for c in coords]
        return coords

    def geom_to_wgs84_geojson(shapely_geom: Any) -> Any:
        raw_geojson = mapping(shapely_geom)
        raw_geojson["coordinates"] = transform_coords(raw_geojson["coordinates"])
        return raw_geojson

    # 11. Build FeatureCollections
    parcel_features = []
    for info in survey_register:
        geom_wgs = geom_to_wgs84_geojson(info["poly"])
        props = {
            "type": "survey_plot",
            "survey_no": info["survey_no"],
            "village": info["village"],
            "mandal": info["mandal"],
            "district": info["district"],
            "total_area_m2": info["total_area_m2"],
            "total_acres": info["total_acres"],
            "total_ac_cts": info["total_ac_cts"],
            "canal_passing": info["canal_passing"],
            "acquired_area_m2": info["acquired_area_m2"],
            "acquired_acres": info["acquired_acres"],
            "balance_area_m2": info["balance_area_m2"],
            "balance_acres": info["balance_acres"],
            "chainage_range": info["chainage_range"],
            "canal_length_m": info["canal_length_m"],
            "canal_width_m": info["canal_width_m"],
            "land_type": info.get("land_type", "Ryotwari Patta"),
            "is_poramboke": info.get("is_poramboke", False),
            "stroke": "#eab308" if info["canal_passing"] else ("#ca8a04" if not info.get("is_poramboke") else "#94a3b8"),
            "stroke-width": 3 if info["canal_passing"] else 1.5,
            "fill": "#22c55e" if info["canal_passing"] else ("#0f172a" if not info.get("is_poramboke") else "#475569"),
            "fill-opacity": 0.25 if info["canal_passing"] else (0.08 if not info.get("is_poramboke") else 0.05),
        }
        parcel_features.append({
            "type": "Feature",
            "geometry": geom_wgs,
            "properties": props,
        })

    # Canal alignment features
    canal_features = []
    for line in canal_lines:
        canal_features.append({
            "type": "Feature",
            "geometry": geom_to_wgs84_geojson(line),
            "properties": {
                "layer": "Canal Alignment",
                "stroke": "#0284c7",
                "stroke-width": 3.5,
            },
        })

    # Canal corridor buffer features
    buffer_features = []
    if canal_corridor is not None:
        buffer_features.append({
            "type": "Feature",
            "geometry": geom_to_wgs84_geojson(canal_corridor),
            "properties": {
                "layer": "Canal Buffer (Proposed)",
                "stroke": "#38bdf8",
                "stroke-width": 2,
                "fill": "#0284c7",
                "fill-opacity": 0.35,
            },
        })

    # Roads features
    road_features = []
    for road in road_lines:
        road_features.append({
            "type": "Feature",
            "geometry": geom_to_wgs84_geojson(road),
            "properties": {
                "layer": "Roads",
                "stroke": "#ef4444",
                "stroke-width": 2.5,
            },
        })

    # Village Boundary features
    boundary_features = []
    for b_line in village_boundary_lines:
        boundary_features.append({
            "type": "Feature",
            "geometry": geom_to_wgs84_geojson(b_line),
            "properties": {
                "layer": "Village Boundary",
                "stroke": "#a855f7",
                "stroke-width": 3,
                "dashArray": "6, 6",
            },
        })

    # Structures features
    structure_features = []
    for st in structure_points:
        lon, lat = transformer.transform(st["x"], st["y"])
        structure_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": {
                "layer": "Structures (Culvert/Regulator)",
                "title": st["title"],
                "icon": "structure",
            },
        })

    # Chainage features
    chainage_features = []
    for ch in chainage_points:
        lon, lat = transformer.transform(ch["x"], ch["y"])
        chainage_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": {
                "layer": "Chainage Markers",
                "title": ch.get("label", ch["chainage"]),
                "chainage": ch["chainage"],
                "label": ch.get("label", ch["chainage"]),
                "icon": "chainage",
            },
        })

    # Combine all layers into master Cadastral dataset
    total_plots = len(survey_register)
    affected_plots = sum(1 for p in survey_register if p["canal_passing"])
    total_area_acres = sum(p["total_acres"] for p in survey_register)
    acquired_area_acres = sum(p["acquired_acres"] for p in survey_register)
    balance_area_acres = sum(p["balance_acres"] for p in survey_register)

    # Sort survey register naturally by survey number
    def natural_key(item: Dict[str, Any]) -> Any:
        import re
        s = item.get("survey_no", "")
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

    register_records = []
    for p in survey_register:
        poly = p["poly"]
        centroid_x, centroid_y = poly.centroid.x, poly.centroid.y
        min_x, min_y, max_x, max_y = poly.bounds
        min_lon, min_lat = transformer.transform(min_x, min_y)
        max_lon, max_lat = transformer.transform(max_x, max_y)

        # Local 2D coordinates for isolated SVG diagram
        local_poly = [
            [round(pt[0] - centroid_x, 2), round(pt[1] - centroid_y, 2)]
            for pt in poly.exterior.coords
        ]

        local_canal = []
        if p["canal_passing"] and p.get("intersection_geom") is not None:
            igeom = p["intersection_geom"]
            if hasattr(igeom, "geoms"):
                for g in igeom.geoms:
                    if hasattr(g, "exterior"):
                        local_canal.append([
                            [round(pt[0] - centroid_x, 2), round(pt[1] - centroid_y, 2)]
                            for pt in g.exterior.coords
                        ])
            elif hasattr(igeom, "exterior"):
                local_canal.append([
                    [round(pt[0] - centroid_x, 2), round(pt[1] - centroid_y, 2)]
                    for pt in igeom.exterior.coords
                ])

        rec = {k: v for k, v in p.items() if k not in ("poly", "intersection_geom")}
        rec["bounds"] = [[round(min_lat, 7), round(min_lon, 7)], [round(max_lat, 7), round(max_lon, 7)]]
        rec["center"] = [round((min_lat + max_lat) / 2.0, 7), round((min_lon + max_lon) / 2.0, 7)]
        rec["local_poly"] = local_poly
        rec["local_canal"] = local_canal
        register_records.append(rec)

    sorted_register = sorted(register_records, key=natural_key)

    return {
        "success": True,
        "village": village_name,
        "mandal": mandal_name,
        "district": district_name,
        "summary": {
            "total_plots": total_plots,
            "affected_plots": affected_plots,
            "total_area_acres": round(total_area_acres, 2),
            "acquired_area_acres": round(acquired_area_acres, 2),
            "balance_area_acres": round(balance_area_acres, 2),
        },
        "layers": {
            "survey_plots": {
                "type": "FeatureCollection",
                "features": parcel_features,
            },
            "canal_alignment": {
                "type": "FeatureCollection",
                "features": canal_features,
            },
            "canal_buffer": {
                "type": "FeatureCollection",
                "features": buffer_features,
            },
            "roads": {
                "type": "FeatureCollection",
                "features": road_features,
            },
            "village_boundary": {
                "type": "FeatureCollection",
                "features": boundary_features,
            },
            "structures": {
                "type": "FeatureCollection",
                "features": structure_features,
            },
            "chainage_markers": {
                "type": "FeatureCollection",
                "features": chainage_features,
            },
        },
        "survey_register": sorted_register,
    }
