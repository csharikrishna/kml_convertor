"""
Coordinate transformation correctness.

Reference values are computed independently of PROJ: on the central meridian of a UTM
zone, easting = 500000 and northing = k0 * M(lat), where M is the meridian arc length
of the WGS84 ellipsoid (series expansion, sub-millimetre accurate).
"""

import math

import pytest

from dxf2kml.errors import CRSError
from dxf2kml.transformer import CoordinateTransformer, normalize_crs_input, parse_crs

A = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)
K0 = 0.9996


def meridian_arc(lat_deg: float) -> float:
    phi = math.radians(lat_deg)
    e4, e6 = E2 * E2, E2 ** 3
    return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
                - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
                - (35 * e6 / 3072) * math.sin(6 * phi))


@pytest.mark.parametrize("zone, lat", [(44, 15.0), (44, 0.0), (43, 30.5), (33, 60.0)])
def test_utm_central_meridian_reference_points(zone, lat):
    t = CoordinateTransformer(source_crs=f"EPSG:{32600 + zone}", target_crs="EPSG:4326")
    lon, got_lat, z = t.transform_point(500000.0, K0 * meridian_arc(lat), 12.5)
    assert lon == pytest.approx(zone * 6 - 183, abs=1e-9)
    assert got_lat == pytest.approx(lat, abs=1e-7)
    assert z == 12.5  # elevation passes through


def test_southern_hemisphere_false_northing():
    t = CoordinateTransformer(source_crs="EPSG:32744")
    lon, lat, _ = t.transform_point(500000.0, 10_000_000.0 - K0 * meridian_arc(20.0))
    assert (lon, lat) == (pytest.approx(81.0, abs=1e-9), pytest.approx(-20.0, abs=1e-7))


def test_axis_order_is_lon_lat_even_for_epsg4326_source():
    """EPSG:4326 is officially lat/lon; always_xy must keep (lon, lat)."""
    t = CoordinateTransformer(source_crs="EPSG:4326", target_crs="EPSG:4326")
    assert t.transform_point(78.0, 15.0)[:2] == (pytest.approx(78.0), pytest.approx(15.0))


def test_bulk_matches_single():
    t = CoordinateTransformer(source_crs="EPSG:32644")
    coords = [(250000.0, 1900000.0), (250100.0, 1900100.0, 7.0)]
    bulk = t.transform_coords(coords)
    assert bulk[0] == pytest.approx(t.transform_point(250000.0, 1900000.0))
    assert bulk[1][2] == 7.0
    assert all(75 < lon < 85 and 15 < lat < 20 for lon, lat, _ in bulk)


@pytest.mark.parametrize("value, expected", [
    ("32644", "EPSG:32644"), ("epsg:32644", "EPSG:32644"), (" EPSG: 4326", "EPSG:4326"),
])
def test_normalize_crs_input(value, expected):
    assert normalize_crs_input(value) == expected


@pytest.mark.parametrize("bad", ["EPSG:999999", "not a crs", ""])
def test_invalid_source_crs_raises(bad):
    with pytest.raises(CRSError):
        CoordinateTransformer(source_crs=bad)


def test_epsg_only_rejects_proj_strings():
    with pytest.raises(CRSError):
        parse_crs("+proj=utm +zone=44", epsg_only=True)


def test_non_wgs84_output_is_rejected():
    with pytest.raises(CRSError, match="WGS84"):
        CoordinateTransformer(source_crs="EPSG:32644", target_crs="EPSG:3857")


def test_out_of_domain_coordinates_raise_instead_of_inf():
    t = CoordinateTransformer(source_crs="EPSG:32644")
    with pytest.raises(CRSError):
        t.transform_coords([(1e30, 1e30)])


def test_check_extent_flags_local_coordinates():
    t = CoordinateTransformer(source_crs="EPSG:32644")
    assert t.check_extent((0, 0, 500, 300))  # local drawing near the origin
    assert not t.check_extent((188004, 1730484, 197665, 1739816))  # real survey in zone 44N


def test_source_unit_label():
    assert CoordinateTransformer("EPSG:32644").source_unit_label == "m"
    assert CoordinateTransformer("EPSG:2227").source_unit_label == "ftUS"  # California zone 3 (US ft)
    assert CoordinateTransformer("EPSG:4326").source_unit_label is None
