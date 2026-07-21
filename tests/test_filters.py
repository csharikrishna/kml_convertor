"""
Unit tests for construction frame and border filtering.
"""

from shapely.geometry import Polygon, LineString
from dxf2kml.config import ConverterConfig
from dxf2kml.geometry import ReconstructedGeometry
from dxf2kml.filters import BoundaryFilter


def test_construction_frame_filtering():
    """Test filtering out a giant outer layout border polygon."""
    cfg = ConverterConfig(
        ignore_large_polygons=True,
        max_segment_length=5000.0,
        max_area_ratio=0.7
    )
    filter_engine = BoundaryFilter(cfg)

    # Normal small plot polygon: 100 x 100
    small_poly = Polygon([(10, 10), (110, 10), (110, 110), (10, 110)])
    # Giant outer sheet border: 10000 x 10000
    giant_poly = Polygon([(0, 0), (10000, 0), (10000, 10000), (0, 10000)])

    g1 = ReconstructedGeometry(layer="Plots", geometry_type="Polygon", geom=small_poly)
    g2 = ReconstructedGeometry(layer="Sheet_Border", geometry_type="Polygon", geom=giant_poly)

    filtered, ignored_count = filter_engine.filter_geometries([g1, g2])

    assert ignored_count == 1
    assert len(filtered) == 1
    assert filtered[0].layer == "Plots"
