"""
Coordinate reference system transformer using pyproj.

* ``always_xy=True``: coordinates are always (easting, northing) -> (lon, lat), regardless
  of the axis order declared by the EPSG definition (EPSG:4326 is officially lat/lon).
* ``errcheck=True``: a failed projection raises instead of silently producing ``inf``.
* Output is validated (finite, lon in [-180, 180], lat in [-90, 90]).
* ``check_extent`` warns when the drawing does not plausibly lie inside the source CRS's
  area of use - the typical symptom of a wrong CRS/zone or a local (non-georeferenced)
  drawing. The CRS itself is never guessed.

Z (elevation) values are passed through unchanged.
"""

from __future__ import annotations

from typing import List, Optional, Tuple, Union

import numpy as np
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError as ProjCRSError, ProjError
from loguru import logger

from dxf2kml.errors import CRSError

WGS84 = CRS.from_epsg(4326)


def normalize_crs_input(value: Optional[str]) -> str:
    """Accept '32644', 'EPSG:32644' or 'epsg:32644' and return 'EPSG:32644'."""
    text = (value or "").strip()
    if text.isdigit():
        return f"EPSG:{text}"
    if text.upper().startswith("EPSG:") and text[5:].strip().isdigit():
        return f"EPSG:{text[5:].strip()}"
    return text


def parse_crs(value: str, *, epsg_only: bool = False) -> CRS:
    """Parse a CRS definition; with ``epsg_only`` only 'EPSG:<code>' is accepted."""
    text = normalize_crs_input(value)
    if epsg_only and not (text.startswith("EPSG:") and text[5:].isdigit()):
        raise CRSError(f"Invalid CRS '{value}'. Expected an EPSG code such as EPSG:32644.")
    try:
        return CRS.from_user_input(text)
    except (ProjCRSError, ValueError, TypeError) as ex:
        raise CRSError(f"Unknown or invalid coordinate reference system: '{value}'.") from ex


class CoordinateTransformer:
    """Transforms coordinates from the source CRS to WGS84 lon/lat for KML."""

    def __init__(self, source_crs: str = "EPSG:32644", target_crs: str = "EPSG:4326"):
        self.source_crs_str = normalize_crs_input(source_crs)
        self.target_crs_str = normalize_crs_input(target_crs)
        try:
            self.source_crs = parse_crs(self.source_crs_str)
            self.target_crs = parse_crs(self.target_crs_str)
        except CRSError as ex:
            logger.error(f"Failed to parse CRS ({source_crs} -> {target_crs}): {ex.__cause__}")
            raise

        if not self.target_crs.equals(WGS84, ignore_axis_order=True):
            raise CRSError(
                f"KML coordinates must be WGS84 longitude/latitude (EPSG:4326); "
                f"'{target_crs}' is not supported as output CRS."
            )
        if self.source_crs.is_geocentric:
            raise CRSError(f"Geocentric source CRS '{source_crs}' is not supported.")

        try:
            self.transformer = Transformer.from_crs(self.source_crs, self.target_crs, always_xy=True)
        except ProjError as ex:
            raise CRSError(f"No transformation available from {source_crs} to {target_crs}.") from ex
        logger.info(f"Initialized CoordinateTransformer: {self.source_crs_str} -> {self.target_crs_str}")

    # ------------------------------------------------------------------ metadata

    @property
    def source_unit_label(self) -> Optional[str]:
        """Short linear unit label of the source CRS ('m', 'ft', 'ftUS'), None if angular."""
        if self.source_crs.is_geographic:
            return None
        try:
            unit = self.source_crs.axis_info[0].unit_name.lower()
        except (IndexError, AttributeError):
            return None
        if unit in ("metre", "meter"):
            return "m"
        if "us survey foot" in unit:
            return "ftUS"
        if "foot" in unit:
            return "ft"
        return unit

    # ------------------------------------------------------------------ transformation

    def _validate(self, lons: np.ndarray, lats: np.ndarray) -> None:
        if not (np.all(np.isfinite(lons)) and np.all(np.isfinite(lats))):
            raise CRSError(
                f"Coordinates could not be transformed from {self.source_crs_str}. "
                f"The drawing's coordinates do not match the selected CRS."
            )
        if np.any(np.abs(lats) > 90.0 + 1e-9) or np.any(np.abs(lons) > 180.0 + 1e-9):
            raise CRSError(
                f"Transformed coordinates are outside the valid longitude/latitude range. "
                f"The drawing's coordinates do not match {self.source_crs_str}."
            )

    def transform_point(self, x: float, y: float, z: float = 0.0) -> Tuple[float, float, float]:
        """Transform a single 2D/3D coordinate. Returns (lon, lat, elev)."""
        (lon,), (lat,) = self._transform_arrays(np.array([x], dtype=float), np.array([y], dtype=float))
        return (float(lon), float(lat), float(z))

    def _transform_arrays(self, xs: np.ndarray, ys: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        try:
            lons, lats = self.transformer.transform(xs, ys, errcheck=True)
        except ProjError as ex:
            raise CRSError(
                f"Coordinates could not be transformed from {self.source_crs_str}: "
                f"they are outside the domain of this CRS."
            ) from ex
        lons = np.asarray(lons, dtype=float)
        lats = np.asarray(lats, dtype=float)
        self._validate(lons, lats)
        return lons, lats

    def transform_coords(
        self,
        coords: List[Union[Tuple[float, float], Tuple[float, float, float]]]
    ) -> List[Tuple[float, float, float]]:
        """Transform a list of 2D or 3D coordinates to (lon, lat, elev)."""
        if not coords:
            return []
        xs = np.fromiter((p[0] for p in coords), dtype=float, count=len(coords))
        ys = np.fromiter((p[1] for p in coords), dtype=float, count=len(coords))
        zs = [float(p[2]) if len(p) > 2 else 0.0 for p in coords]
        lons, lats = self._transform_arrays(xs, ys)
        return list(zip(lons.tolist(), lats.tolist(), zs))

    # ------------------------------------------------------------------ plausibility

    def check_extent(self, bounds: Tuple[float, float, float, float]) -> List[str]:
        """
        Return human-readable warnings if the drawing extent (in source CRS units) does
        not plausibly belong to the source CRS. Never raises for implausible data.
        """
        warnings: List[str] = []
        min_x, min_y, max_x, max_y = bounds
        if not all(np.isfinite(bounds)):
            return warnings
        aou = self.source_crs.area_of_use
        if aou is None:
            return warnings

        try:
            if self.source_crs.is_projected:
                to_src = Transformer.from_crs(self.source_crs.geodetic_crs, self.source_crs, always_xy=True)
                vx0, vy0, vx1, vy1 = to_src.transform_bounds(aou.west, aou.south, aou.east, aou.north, densify_pts=21)
                # Allow a margin of 10% of the valid width/height around the area of use
                # (UTM: ~67 km, i.e. drawings slightly beyond the zone edge still pass,
                # while local drawings near the origin, easting << 166 km, are flagged).
                mx, my = 0.10 * (vx1 - vx0), 0.10 * (vy1 - vy0)
                inside = (min_x >= vx0 - mx and max_x <= vx1 + mx and min_y >= vy0 - my and max_y <= vy1 + my)
            else:
                inside = (-180 <= min_x and max_x <= 180 and -90 <= min_y and max_y <= 90)
        except (ProjError, ValueError) as ex:
            logger.debug(f"Extent plausibility check skipped: {ex}")
            return warnings

        if not inside:
            warnings.append(
                f"The drawing's coordinates (X {min_x:,.1f} to {max_x:,.1f}, Y {min_y:,.1f} to {max_y:,.1f}) "
                f"lie outside the area of use of {self.source_crs_str} ({self.source_crs.name}: {aou.name}). "
                f"The output is probably misplaced: check that the source CRS/UTM zone is correct and that the "
                f"drawing is georeferenced (not in local coordinates)."
            )
        return warnings
