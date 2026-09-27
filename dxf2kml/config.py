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
    output_epsg: str = Field(default="EPSG:4326", description="Output CRS. KML requires WGS84 (EPSG:4326).")

    # Processing Toggles
    merge_lines: bool = Field(default=True, description="Merge touching line segments into continuous LineStrings/Polygons")
    merge_distance: float = Field(default=0.05, ge=0, description="Maximum distance threshold (in input CRS units) to merge line vertices")
    ignore_large_polygons: bool = Field(default=True, description="Filter out sheet borders and construction frames")
    export_text: bool = Field(default=True, description="Export TEXT, MTEXT and visible ATTRIB entities as KML Placemarks")
    export_points: bool = Field(default=True, description="Export POINT entities as Google Earth Placemarks")
    export_hatches: bool = Field(default=True, description="Export HATCH entity boundary paths as polygons")
    fill_hatches: bool = Field(default=True, description="Fill HATCH polygons with the hatch color (at fill_opacity)")

    # Text / Font Accuracy
    auto_scale_text: bool = Field(default=True, description="Automatically scale KML labels based on DXF text height")
    reference_text_height: float = Field(default=2.5, gt=0, description="Reference DXF text height (in drawing units) for relative KML label scaling")

    # Tessellation & Geometry parameters
    tessellation_segments: int = Field(default=32, ge=4, le=1024, description="Minimum segments used to approximate a full circle")
    flattening_distance: float = Field(default=0.05, gt=0, description="Maximum deviation distance for curve flattening/tessellation")
    max_vertices_per_curve: int = Field(default=2048, ge=16, description="Upper bound on vertices generated for a single curve (guards against pathological radii)")

    # Boundary / Frame detection thresholds
    max_segment_length: Optional[float] = Field(default=5000.0, description="Max allowed length for a single segment before filtering as frame")
    max_area_ratio: float = Field(default=0.7, gt=0, description="Max area ratio relative to full drawing extent to flag layout/sheet border")
    border_z_score_threshold: float = Field(default=3.0, description="Z-score threshold for bounding box area outlier detection")

    # Resource limits (protect against pathological or malicious drawings)
    max_entities: int = Field(default=1_000_000, ge=1, description="Maximum number of drawing primitives (after block expansion)")
    max_vertices: int = Field(default=10_000_000, ge=1, description="Maximum total number of vertices across all geometry")
    max_block_depth: int = Field(default=16, ge=1, le=64, description="Maximum nesting depth of block references")
    timeout_seconds: Optional[float] = Field(default=None, gt=0, description="Abort conversion after this many seconds (None = no limit)")

    # Styling parameters
    default_line_width: float = Field(default=2.0, gt=0, description="Default KML LineString width in pixels")
    default_line_color: str = Field(default="ff0000ff", pattern=r"^[0-9a-fA-F]{8}$", description="Default KML color in AABBGGRR hex format")
    default_point_scale: float = Field(default=0.8, ge=0, description="Default KML Placemark icon scale")
    default_label_scale: float = Field(default=0.7, ge=0, le=10, description="Default KML Label text scale (e.g. 0.5 to 1.0)")
    line_width_multiplier: float = Field(default=1.0, gt=0, description="Multiplier for all KML line widths")
    point_icon_url: str = Field(
        default="http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png",
        description="Google Earth icon URL for points"
    )

    # Polygon fill styling
    fill_polygons: bool = Field(default=False, description="Fill closed polygons with color")
    fill_color: str = Field(default="ff0000ff", pattern=r"^[0-9a-fA-F]{8}$", description="Polygon fill color in KML AABBGGRR hex format")
    fill_opacity: int = Field(default=76, ge=0, le=255, description="Polygon fill opacity (0-255)")

    @classmethod
    def from_yaml(cls, yaml_path: Path) -> "ConverterConfig":
        """Load configuration from a YAML file."""
        if not yaml_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {yaml_path}")
        with open(yaml_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return cls(**data)
