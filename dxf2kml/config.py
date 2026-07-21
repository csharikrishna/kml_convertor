"""
Configuration management for DXF2KML using Pydantic.
Supports CLI overrides and YAML file parsing.
"""

from pathlib import Path
from typing import Optional
import yaml
from pydantic import BaseModel, Field


class ConverterConfig(BaseModel):
    """Configuration model for DXF to KML conversion."""

    # Coordinate Reference Systems
    input_epsg: str = Field(default="EPSG:32644", description="Input Coordinate Reference System (e.g. EPSG:32644)")
    output_epsg: str = Field(default="EPSG:4326", description="Output Coordinate Reference System (e.g. EPSG:4326)")

    # Processing Toggles
    merge_lines: bool = Field(default=True, description="Merge touching line segments into continuous LineStrings/Polygons")
    merge_distance: float = Field(default=0.05, description="Maximum distance threshold (in input CRS units) to merge line vertices")
    ignore_large_polygons: bool = Field(default=True, description="Filter out sheet borders and construction frames")
    export_text: bool = Field(default=True, description="Export TEXT and MTEXT entities as KML Placemarks")
    export_points: bool = Field(default=True, description="Export POINT entities as Google Earth Placemarks")
    export_hatches: bool = Field(default=True, description="Export HATCH entity boundary paths")

    # Tessellation & Geometry parameters
    tessellation_segments: int = Field(default=32, description="Number of segments for curve/arc/spline discretization")
    
    # Boundary / Frame detection thresholds
    max_segment_length: Optional[float] = Field(default=5000.0, description="Max allowed length for a single segment before filtering as frame")
    max_area_ratio: float = Field(default=0.7, description="Max area ratio relative to full drawing extent to flag layout/sheet border")
    border_z_score_threshold: float = Field(default=3.0, description="Z-score threshold for bounding box area outlier detection")

    # Styling parameters
    default_line_width: float = Field(default=2.0, description="Default KML LineString width in pixels")
    default_line_color: str = Field(default="ff0000ff", description="Default KML color in AABBGGRR hex format")
    default_point_scale: float = Field(default=0.8, description="Default KML Placemark icon scale")
    default_label_scale: float = Field(default=0.7, description="Default KML Label text scale (e.g. 0.5 to 1.0)")
    point_icon_url: str = Field(
        default="http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png",
        description="Google Earth icon URL for points"
    )

    @classmethod
    def from_yaml(cls, yaml_path: Path) -> "ConverterConfig":
        """Load configuration from a YAML file."""
        if not yaml_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {yaml_path}")
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return cls(**data)
