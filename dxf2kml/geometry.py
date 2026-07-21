"""
Geometry reconstruction engine.
Merges touching polylines/lines into continuous LineStrings using Shapely and NetworkX.
Detects closed loops and converts them into valid Polygons.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional, Set, Union
import networkx as nx
from shapely.geometry import LineString, Polygon, MultiLineString
from shapely.ops import linemerge, polygonize, unary_union
from loguru import logger

from dxf2kml.parser import ParsedPath, ParsedHatch
from dxf2kml.config import ConverterConfig


@dataclass
class ReconstructedGeometry:
    """Output primitive containing processed Shapely geometries ready for CRS transform."""
    layer: str
    geometry_type: str  # "Polygon" or "LineString"
    geom: Union[LineString, Polygon]
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None
    lineweight: Optional[float] = None


@dataclass
class GeometryStats:
    """Statistics for geometry reconstruction."""
    input_paths_count: int = 0
    merged_lines_count: int = 0
    detected_polygons_count: int = 0
    output_linestrings_count: int = 0


class GeometryEngine:
    """Intelligent geometry processing & topology reconstruction engine."""

    def __init__(self, config: ConverterConfig):
        self.config = config

    def process(
        self,
        paths: List[ParsedPath],
        hatches: List[ParsedHatch]
    ) -> Tuple[List[ReconstructedGeometry], GeometryStats]:
        """
        Process DXF paths and hatches:
        1. Group by layer.
        2. Closed polylines -> Polygons.
        3. Open lines/polylines -> merge via linemerge & networkx graph analysis.
        4. Detect closed loops -> Polygons.
        """
        stats = GeometryStats(input_paths_count=len(paths))
        results: List[ReconstructedGeometry] = []

        # Process Hatches directly into Polygons
        for hatch in hatches:
            if not hatch.paths:
                continue
            try:
                exterior = hatch.paths[0]
                interiors = hatch.paths[1:] if len(hatch.paths) > 1 else []
                poly = Polygon(shell=exterior, holes=interiors)
                if poly.is_valid and not poly.is_empty:
                    results.append(ReconstructedGeometry(
                        layer=hatch.layer,
                        geometry_type="Polygon",
                        geom=poly,
                        color_aci=hatch.color_aci,
                        rgb_color=hatch.rgb_color
                    ))
                    stats.detected_polygons_count += 1
            except Exception as e:
                logger.warning(f"Error building hatch polygon: {e}")

        # Group paths by layer
        layer_paths: Dict[str, List[ParsedPath]] = {}
        for p in paths:
            layer_paths.setdefault(p.layer, []).append(p)

        for layer, p_list in layer_paths.items():
            lines_to_merge: List[LineString] = []

            for p in p_list:
                if len(p.vertices) < 2:
                    continue

                ls = LineString(p.vertices)
                if not ls.is_valid or ls.is_empty:
                    continue

                # Check if polyline is already closed
                if p.closed or (p.vertices[0] == p.vertices[-1] and len(p.vertices) >= 4):
                    try:
                        poly = Polygon(p.vertices)
                        if poly.is_valid and not poly.is_empty and poly.area > 0:
                            results.append(ReconstructedGeometry(
                                layer=layer,
                                geometry_type="Polygon",
                                geom=poly,
                                color_aci=p.color_aci,
                                rgb_color=p.rgb_color,
                                lineweight=p.lineweight
                            ))
                            stats.detected_polygons_count += 1
                            continue
                    except Exception:
                        pass

                lines_to_merge.append(ls)

            if not lines_to_merge:
                continue

            if not self.config.merge_lines:
                # Without line merging, convert each LineString directly
                for ls in lines_to_merge:
                    results.append(ReconstructedGeometry(
                        layer=layer,
                        geometry_type="LineString",
                        geom=ls,
                        color_aci=p_list[0].color_aci,
                        rgb_color=p_list[0].rgb_color,
                        lineweight=p_list[0].lineweight
                    ))
                    stats.output_linestrings_count += 1
                continue

            # --- INTELLIGENT LINE MERGING VIA SHAPELY & NETWORKX ---
            try:
                merged = linemerge(lines_to_merge)
                merged_geoms = []

                if isinstance(merged, LineString):
                    merged_geoms = [merged]
                elif isinstance(merged, MultiLineString):
                    merged_geoms = list(merged.geoms)
                else:
                    merged_geoms = lines_to_merge

                # Check if any merged lines form polygons via polygonize
                polygons_found = list(polygonize(merged_geoms))

                for poly in polygons_found:
                    if poly.is_valid and not poly.is_empty and poly.area > 0:
                        results.append(ReconstructedGeometry(
                            layer=layer,
                            geometry_type="Polygon",
                            geom=poly,
                            color_aci=p_list[0].color_aci,
                            rgb_color=p_list[0].rgb_color,
                            lineweight=p_list[0].lineweight
                        ))
                        stats.detected_polygons_count += 1

                # Graph-based segment connection for remaining lines
                G = nx.Graph()
                tol = self.config.merge_distance

                def snap_pt(pt: Tuple[float, float]) -> Tuple[float, float]:
                    if tol > 0:
                        return (round(pt[0] / tol) * tol, round(pt[1] / tol) * tol)
                    return pt

                for geom in merged_geoms:
                    if geom.is_empty:
                        continue
                    coords = list(geom.coords)
                    if len(coords) < 2:
                        continue

                    # Add path segments to graph
                    u = snap_pt(coords[0])
                    v = snap_pt(coords[-1])
                    G.add_edge(u, v, coords=coords)

                # Reconstruct merged paths from connected components in NetworkX
                for component in nx.connected_components(G):
                    subgraph = G.subgraph(component)
                    endpoints = [n for n, d in subgraph.degree() if d % 2 != 0]

                    if len(endpoints) == 2:
                        try:
                            path_nodes = nx.shortest_path(subgraph, endpoints[0], endpoints[1])
                            combined_coords = []
                            for i in range(len(path_nodes) - 1):
                                edge_data = subgraph.get_edge_data(path_nodes[i], path_nodes[i+1])
                                seg_coords = edge_data['coords']
                                if snap_pt(seg_coords[0]) != path_nodes[i]:
                                    seg_coords = list(reversed(seg_coords))
                                if not combined_coords:
                                    combined_coords.extend(seg_coords)
                                else:
                                    combined_coords.extend(seg_coords[1:])

                            if len(combined_coords) >= 2:
                                ls = LineString(combined_coords)
                                if ls.is_valid and not ls.is_empty:
                                    results.append(ReconstructedGeometry(
                                        layer=layer,
                                        geometry_type="LineString",
                                        geom=ls,
                                        color_aci=p_list[0].color_aci,
                                        rgb_color=p_list[0].rgb_color,
                                        lineweight=p_list[0].lineweight
                                    ))
                                    stats.output_linestrings_count += 1
                                    stats.merged_lines_count += 1
                                    continue
                        except Exception:
                            pass

                    # Fallback for remaining components
                    for _, _, data in subgraph.edges(data=True):
                        coords = data['coords']
                        if len(coords) >= 2:
                            ls = LineString(coords)
                            if ls.is_valid and not ls.is_empty:
                                results.append(ReconstructedGeometry(
                                    layer=layer,
                                    geometry_type="LineString",
                                    geom=ls,
                                    color_aci=p_list[0].color_aci,
                                    rgb_color=p_list[0].rgb_color,
                                    lineweight=p_list[0].lineweight
                                ))
                                stats.output_linestrings_count += 1

            except Exception as e:
                logger.warning(f"Error during line merging for layer {layer}: {e}")
                for ls in lines_to_merge:
                    results.append(ReconstructedGeometry(
                        layer=layer,
                        geometry_type="LineString",
                        geom=ls,
                        color_aci=p_list[0].color_aci,
                        rgb_color=p_list[0].rgb_color,
                        lineweight=p_list[0].lineweight
                    ))
                    stats.output_linestrings_count += 1

        logger.info(
            f"Geometry Engine finished: Reconstructed {stats.detected_polygons_count} polygons, "
            f"{stats.output_linestrings_count} linestrings ({stats.merged_lines_count} merged)."
        )
        return results, stats
