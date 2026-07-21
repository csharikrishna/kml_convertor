"""
Coordinate reference system transformer using pyproj.
"""

from typing import List, Tuple, Union
from pyproj import Transformer, CRS
from loguru import logger


class CoordinateTransformer:
    """Handles transformation of coordinates from source CRS to target CRS (default EPSG:4326)."""

    def __init__(self, source_crs: str = "EPSG:32644", target_crs: str = "EPSG:4326"):
        self.source_crs_str = source_crs
        self.target_crs_str = target_crs

        try:
            self.transformer = Transformer.from_crs(
                source_crs,
                target_crs,
                always_xy=True
            )
            logger.info(f"Initialized CoordinateTransformer: {source_crs} -> {target_crs}")
        except Exception as e:
            logger.error(f"Failed to initialize pyproj Transformer ({source_crs} -> {target_crs}): {e}")
            raise ValueError(f"Invalid CRS specified: {source_crs} or {target_crs}") from e

    def transform_point(self, x: float, y: float, z: float = 0.0) -> Tuple[float, float, float]:
        """Transform a single 2D/3D coordinate. Returns (lon, lat, elev)."""
        lon, lat = self.transformer.transform(x, y)
        return (lon, lat, z)

    def transform_coords(
        self,
        coords: List[Union[Tuple[float, float], Tuple[float, float, float]]]
    ) -> List[Tuple[float, float]]:
        """Transform a list of 2D or 3D coordinates to (lon, lat)."""
        if not coords:
            return []

        xs = [p[0] for p in coords]
        ys = [p[1] for p in coords]

        lons, lats = self.transformer.transform(xs, ys)

        if isinstance(lons, float):
            return [(lons, lats)]

        return list(zip(lons, lats))
