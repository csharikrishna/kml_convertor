"""
Boundary & Construction Frame Filter Module.
Identifies and removes layout boxes, title blocks, sheet borders, and giant construction rectangles.
"""

from __future__ import annotations
from typing import List, Tuple, Union
import numpy as np
from shapely.geometry import Polygon, LineString, MultiPolygon
from loguru import logger

from dxf2kml.geometry import ReconstructedGeometry
from dxf2kml.config import ConverterConfig


class BoundaryFilter:
    """Detects and filters out construction frames, layout borders, and outlier rectangular bounds."""

    def __init__(self, config: ConverterConfig):
        self.config = config

    def filter_geometries(
        self,
        geometries: List[ReconstructedGeometry]
    ) -> Tuple[List[ReconstructedGeometry], int]:
        """
        Filter out construction frames and sheet borders from geometries list.
        Returns (filtered_geometries, ignored_count).
        """
        if not self.config.ignore_large_polygons or not geometries:
            return geometries, 0

        # Compute overall drawing extent bounding box and total area
        min_x, min_y, max_x, max_y = self._compute_overall_extent(geometries)
        extent_width = max_x - min_x
        extent_height = max_y - min_y
        total_extent_area = extent_width * extent_height

        if total_extent_area <= 0:
            return geometries, 0

        # Gather area statistics for outlier analysis
        polygon_areas = []
        for g in geometries:
            if g.geometry_type == "Polygon" and isinstance(g.geom, Polygon):
                polygon_areas.append(g.geom.area)

        mean_area = float(np.mean(polygon_areas)) if polygon_areas else 0.0
        std_area = float(np.std(polygon_areas)) if len(polygon_areas) > 1 else 0.0

        filtered: List[ReconstructedGeometry] = []
        ignored_count = 0

        for g in geometries:
            is_construction_frame = False
            reason = ""

            # Check max segment length threshold
            if self.config.max_segment_length and self.config.max_segment_length > 0:
                max_edge = self._get_max_edge_length(g.geom)
                if max_edge > self.config.max_segment_length:
                    is_construction_frame = True
                    reason = f"max edge length ({max_edge:.1f}m > {self.config.max_segment_length}m)"

            if not is_construction_frame and g.geometry_type == "Polygon" and isinstance(g.geom, Polygon):
                area = g.geom.area
                bbox = g.geom.bounds  # (minx, miny, maxx, maxy)
                bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])

                # 1. Relative area check (taking up major portion of entire drawing footprint)
                if area / total_extent_area > self.config.max_area_ratio:
                    is_construction_frame = True
                    reason = f"relative area ratio ({area / total_extent_area:.2f} > {self.config.max_area_ratio})"

                # 2. Outlier Z-score check
                elif std_area > 0:
                    z_score = (area - mean_area) / std_area
                    if z_score > self.config.border_z_score_threshold and (area / total_extent_area) > 0.3:
                        is_construction_frame = True
                        reason = f"area z-score outlier ({z_score:.2f} > {self.config.border_z_score_threshold})"

                # 3. Outer boundary box cover check (covers almost exact extent bounds)
                elif bbox_area > 0 and (bbox_area / total_extent_area) > 0.85:
                    if abs(area - bbox_area) / bbox_area < 0.15:
                        is_construction_frame = True
                        reason = f"outer layout sheet rectangle border"

            if is_construction_frame:
                ignored_count += 1
                logger.info(f"Ignored construction frame/border polygon in layer '{g.layer}' (Reason: {reason})")
            else:
                filtered.append(g)

        return filtered, ignored_count

    def _compute_overall_extent(
        self,
        geometries: List[ReconstructedGeometry]
    ) -> Tuple[float, float, float, float]:
        """Calculate min_x, min_y, max_x, max_y for all geometries."""
        min_x, min_y = float("inf"), float("inf")
        max_x, max_y = float("-inf"), float("-inf")

        for g in geometries:
            b = g.geom.bounds
            min_x = min(min_x, b[0])
            min_y = min(min_y, b[1])
            max_x = max(max_x, b[2])
            max_y = max(max_y, b[3])

        return min_x, min_y, max_x, max_y

    def _get_max_edge_length(self, geom: Union[Polygon, LineString]) -> float:
        """Find the longest individual edge length in a geometry."""
        coords = []
        if isinstance(geom, Polygon):
            coords = list(geom.exterior.coords)
        elif isinstance(geom, LineString):
            coords = list(geom.coords)

        if len(coords) < 2:
            return 0.0

        max_len = 0.0
        for i in range(len(coords) - 1):
            dx = coords[i+1][0] - coords[i][0]
            dy = coords[i+1][1] - coords[i][1]
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > max_len:
                max_len = dist

        return max_len
