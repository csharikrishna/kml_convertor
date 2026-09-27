"""
Boundary & Construction Frame Filter Module.
Identifies and removes layout boxes, title blocks, sheet borders, and giant construction rectangles.

A polygon is only treated as a sheet border / frame when it actually *encloses* other
drawing content. Without that guard, a drawing that consists of a single parcel boundary
(whose area is 100% of the drawing extent) would have its only feature removed.
"""

from __future__ import annotations
from typing import List, Tuple
import numpy as np
import shapely
from shapely import STRtree, box
from shapely.geometry import Polygon
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

        min_x, min_y, max_x, max_y = self._compute_overall_extent(geometries)
        total_extent_area = (max_x - min_x) * (max_y - min_y)

        polygon_areas = [
            g.geom.area for g in geometries
            if g.geometry_type == "Polygon" and isinstance(g.geom, Polygon)
        ]
        mean_area = float(np.mean(polygon_areas)) if polygon_areas else 0.0
        std_area = float(np.std(polygon_areas)) if len(polygon_areas) > 1 else 0.0

        tree = STRtree([g.geom for g in geometries])

        filtered: List[ReconstructedGeometry] = []
        ignored_count = 0

        max_edges = self._max_edge_lengths(geometries)

        for idx, g in enumerate(geometries):
            is_construction_frame = False
            reason = ""

            if self.config.max_segment_length and self.config.max_segment_length > 0:
                max_edge = float(max_edges[idx])
                if max_edge > self.config.max_segment_length:
                    is_construction_frame = True
                    reason = f"max edge length ({max_edge:.1f} > {self.config.max_segment_length})"

            if (not is_construction_frame and total_extent_area > 0
                    and g.geometry_type == "Polygon" and isinstance(g.geom, Polygon)):
                area = g.geom.area
                bbox = g.geom.bounds
                bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
                ratio = area / total_extent_area

                if ratio > self.config.max_area_ratio:
                    reason = f"relative area ratio ({ratio:.2f} > {self.config.max_area_ratio})"
                elif std_area > 0 and (area - mean_area) / std_area > self.config.border_z_score_threshold and ratio > 0.3:
                    reason = f"area z-score outlier ({(area - mean_area) / std_area:.2f} > {self.config.border_z_score_threshold})"
                elif bbox_area > 0 and bbox_area / total_extent_area > 0.85 and abs(area - bbox_area) / bbox_area < 0.15:
                    reason = "outer layout sheet rectangle border"

                # A frame must frame something: require enclosed content.
                if reason and self._encloses_other_features(idx, g, tree):
                    is_construction_frame = True

            if is_construction_frame:
                ignored_count += 1
                logger.info(f"Ignored construction frame/border in layer '{g.layer}' (Reason: {reason})")
            else:
                filtered.append(g)

        return filtered, ignored_count

    @staticmethod
    def _encloses_other_features(idx: int, g: ReconstructedGeometry, tree: STRtree) -> bool:
        candidates = tree.query(box(*g.geom.bounds), predicate="contains")
        return any(j != idx for j in candidates)

    def _compute_overall_extent(
        self,
        geometries: List[ReconstructedGeometry]
    ) -> Tuple[float, float, float, float]:
        """Calculate min_x, min_y, max_x, max_y for all geometries."""
        bounds = np.array([g.geom.bounds for g in geometries], dtype=float)
        return (float(bounds[:, 0].min()), float(bounds[:, 1].min()),
                float(bounds[:, 2].max()), float(bounds[:, 3].max()))

    @staticmethod
    def _max_edge_lengths(geometries: List[ReconstructedGeometry]) -> np.ndarray:
        """Longest edge of each geometry's exterior/line, computed in one vectorized pass."""
        outlines = [g.geom.exterior if isinstance(g.geom, Polygon) else g.geom for g in geometries]
        coords, index = shapely.get_coordinates(outlines, return_index=True)
        result = np.zeros(len(outlines))
        if len(coords) < 2:
            return result
        edges = np.hypot(np.diff(coords[:, 0]), np.diff(coords[:, 1]))
        same = index[1:] == index[:-1]
        np.maximum.at(result, index[1:][same], edges[same])
        return result
