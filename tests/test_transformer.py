"""
Unit tests for coordinate transformation.
"""

import pytest
from dxf2kml.transformer import CoordinateTransformer


def test_coordinate_transformer_single():
    """Test transforming a single point from EPSG:32644 (UTM 44N) to EPSG:4326 (WGS84)."""
    transformer = CoordinateTransformer(source_crs="EPSG:32644", target_crs="EPSG:4326")
    # Coordinates in UTM zone 44N (e.g. Hyderabad / South-Central India area)
    utm_x = 250000.0
    utm_y = 1900000.0

    lon, lat, elev = transformer.transform_point(utm_x, utm_y)

    assert isinstance(lon, float)
    assert isinstance(lat, float)
    assert 75.0 <= lon <= 85.0
    assert 15.0 <= lat <= 20.0


def test_coordinate_transformer_bulk():
    """Test bulk coordinate list transformation."""
    transformer = CoordinateTransformer(source_crs="EPSG:32644", target_crs="EPSG:4326")
    coords = [(250000.0, 1900000.0), (250100.0, 1900100.0)]

    transformed = transformer.transform_coords(coords)

    assert len(transformed) == 2
    assert all(isinstance(pt[0], float) and isinstance(pt[1], float) for pt in transformed)
