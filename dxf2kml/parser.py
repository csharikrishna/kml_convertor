"""
DXF Parser module using ezdxf.
Parses AutoCAD modelspace, expands INSERT/BLOCK references, converts curves to discrete vertices,
and safely extracts entities into structured geometric primitives.

Improvements over v1.0:
- BYLAYER (ACI 256) and BYBLOCK (ACI 0) color resolution from layer table
- LWPOLYLINE bulge arc tessellation via ezdxf.path
- DIMENSION and LEADER entity support (virtual entity explosion)
- DXF drawing units detection ($INSUNITS)
- 3D coordinate preservation (Z values kept through pipeline)
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple, Optional, Set, Dict
import ezdxf
import ezdxf.path
import ezdxf.colors
from loguru import logger

from dxf2kml.labels import parse_text_entity, parse_mtext_entity, LabelData
from dxf2kml.config import ConverterConfig


# DXF $INSUNITS value mapping
DXF_UNITS_MAP = {
    0: "Unitless",
    1: "Inches",
    2: "Feet",
    3: "Miles",
    4: "Millimeters",
    5: "Centimeters",
    6: "Meters",
    7: "Kilometers",
    8: "Microinches",
    9: "Mils",
    10: "Yards",
    11: "Angstroms",
    12: "Nanometers",
    13: "Microns",
    14: "Decimeters",
    15: "Decameters",
    16: "Hectometers",
}


@dataclass
class ParsedPoint:
    """Parsed AutoCAD POINT entity."""
    position: Tuple[float, float, float]
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None


@dataclass
class ParsedPath:
    """Parsed AutoCAD linear/curve path entity (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE)."""
    vertices: List[Tuple[float, float]]
    closed: bool
    entity_type: str
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None
    lineweight: Optional[float] = None


@dataclass
class ParsedHatch:
    """Parsed AutoCAD HATCH entity boundary paths."""
    paths: List[List[Tuple[float, float]]]  # List of boundary rings (outer + inner holes)
    layer: str
    color_aci: Optional[int] = None
    rgb_color: Optional[Tuple[int, int, int]] = None


@dataclass
class DXFParseResult:
    """Container for all parsed DXF drawing elements."""
    paths: List[ParsedPath] = field(default_factory=list)
    points: List[ParsedPoint] = field(default_factory=list)
    labels: List[LabelData] = field(default_factory=list)
    hatches: List[ParsedHatch] = field(default_factory=list)
    layers: Set[str] = field(default_factory=set)
    unsupported_counts: dict = field(default_factory=dict)
    total_entities_processed: int = 0
    # Drawing metadata
    drawing_units: str = "Meters"
    drawing_units_code: int = 6


SUPPORTED_ENTITIES = {
    "LINE", "LWPOLYLINE", "POLYLINE", "POINT", "TEXT", "MTEXT",
    "INSERT", "HATCH", "ARC", "CIRCLE", "ELLIPSE", "SPLINE",
    "DIMENSION", "LEADER"
}


class DXFParser:
    """Safe, robust AutoCAD DXF parser with BYLAYER color resolution and arc support."""

    def __init__(self, config: ConverterConfig):
        self.config = config
        self._layer_colors: Dict[str, Tuple[int, int, int]] = {}

    def _build_layer_color_table(self, doc) -> None:
        """Build a lookup table of layer name -> RGB color from the DXF layer table."""
        self._layer_colors = {}
        for layer in doc.layers:
            try:
                aci = layer.color
                if aci is not None and 1 <= aci <= 255:
                    self._layer_colors[layer.dxf.name] = ezdxf.colors.aci2rgb(aci)
            except Exception:
                pass

    def _resolve_entity_color(
        self, entity, layer: str
    ) -> Tuple[Optional[int], Optional[Tuple[int, int, int]]]:
        """
        Resolve the actual display color for an entity, handling BYLAYER (256) and BYBLOCK (0).
        
        Returns (color_aci, rgb_color) where rgb_color takes priority if available.
        """
        color_aci = entity.dxf.get("color", None)
        rgb_color = None

        # Check for true_color first (highest priority)
        if hasattr(entity.dxf, "true_color") and entity.dxf.true_color is not None:
            tc = entity.dxf.true_color
            rgb_color = ((tc >> 16) & 0xFF, (tc >> 8) & 0xFF, tc & 0xFF)
            return color_aci, rgb_color

        # BYLAYER (256) or None -> resolve from layer table
        if color_aci is None or color_aci == 256:
            if layer in self._layer_colors:
                rgb_color = self._layer_colors[layer]
                # Also set a valid aci for downstream fallback
                color_aci = None
            return color_aci, rgb_color

        # BYBLOCK (0) -> use default color (entity inside a block inheriting block color)
        if color_aci == 0:
            if layer in self._layer_colors:
                rgb_color = self._layer_colors[layer]
            return None, rgb_color

        # Valid ACI color (1-255)
        if 1 <= color_aci <= 255:
            return color_aci, None

        return color_aci, rgb_color

    def parse(self, dxf_filepath: Path) -> DXFParseResult:
        """Read and process DXF file, extracting all supported entities."""
        if not dxf_filepath.exists():
            raise FileNotFoundError(f"DXF file not found: {dxf_filepath}")

        logger.info(f"Loading DXF/DWG file: {dxf_filepath}")
        doc = None
        is_dwg = dxf_filepath.suffix.lower() == ".dwg"

        if is_dwg:
            # Try ezdxf odafc addon if installed
            try:
                from ezdxf.addons import odafc
                if odafc.is_installed():
                    doc = odafc.readfile(str(dxf_filepath))
            except Exception:
                pass

            if doc is None:
                raise ValueError(
                    f"Binary DWG format detected ('{dxf_filepath.name}').\n\n"
                    "DWG support requires the free 'ODA File Converter' to be installed on the server.\n"
                    "Please either:\n"
                    "1. Save your drawing as a DXF in AutoCAD and upload the DXF instead.\n"
                    "2. Install ODA File Converter from opendesign.com and ensure it's in your system PATH."
                )

        if doc is None:
            try:
                # Try standard ezdxf readfile
                doc = ezdxf.readfile(str(dxf_filepath))
            except Exception:
                try:
                    # Fallback to ezdxf recovery reader for damaged/non-standard DXF files
                    import ezdxf.recover
                    doc, auditor = ezdxf.recover.readfile(str(dxf_filepath))
                    logger.info(f"Recovered DXF file with {len(auditor.errors)} audited issues.")
                except Exception as ex:
                    logger.error(f"Failed to read DXF file: {ex}")
                    raise ValueError(f"Unable to parse DXF file ('{dxf_filepath.name}'). Please ensure it is a valid ASCII or Binary DXF.") from ex

        msp = doc.modelspace()
        result = DXFParseResult()

        # Detect drawing units from header
        try:
            units_code = doc.header.get("$INSUNITS", 6)  # default to Meters
            result.drawing_units_code = units_code
            result.drawing_units = DXF_UNITS_MAP.get(units_code, "Unknown")
            logger.info(f"DXF drawing units: {result.drawing_units} (code={units_code})")
        except Exception:
            result.drawing_units = "Meters"
            result.drawing_units_code = 6

        # Build layer color lookup table
        self._build_layer_color_table(doc)

        # Gather layer names from document header/layers table
        for layer in doc.layers:
            result.layers.add(layer.dxf.name)

        # Decompose INSERT/BLOCK references recursively to standard entities
        raw_entities = list(msp)
        entities_to_process = []

        for entity in raw_entities:
            dxftype = entity.dxftype()
            if dxftype == "INSERT":
                try:
                    # Decompose nested block references
                    for decomposed in entity.virtual_entities():
                        entities_to_process.append(decomposed)
                except Exception as ex:
                    logger.warning(f"Error expanding INSERT block entity: {ex}")
            elif dxftype in ("DIMENSION", "LEADER"):
                # Explode DIMENSION and LEADER into their constituent entities
                try:
                    for virtual_entity in entity.virtual_entities():
                        entities_to_process.append(virtual_entity)
                except Exception as ex:
                    logger.warning(f"Error exploding {dxftype} entity: {ex}")
            else:
                entities_to_process.append(entity)

        logger.info(f"Processing {len(entities_to_process)} total DXF entities (after block/dimension expansion)...")

        for entity in entities_to_process:
            result.total_entities_processed += 1
            dxftype = entity.dxftype()

            if dxftype not in SUPPORTED_ENTITIES:
                result.unsupported_counts[dxftype] = result.unsupported_counts.get(dxftype, 0) + 1
                continue

            try:
                self._process_entity(entity, result)
            except Exception as e:
                logger.warning(f"Skipping malformed {dxftype} entity due to processing error: {e}")

        logger.info(
            f"Parsed: {len(result.paths)} paths, {len(result.points)} points, "
            f"{len(result.labels)} labels, {len(result.hatches)} hatches. "
            f"Layers found: {len(result.layers)}"
        )
        return result

    def _process_entity(self, entity, result: DXFParseResult):
        """Process a single DXF entity into the DXFParseResult object."""
        dxftype = entity.dxftype()
        layer = str(entity.dxf.get("layer", "0"))
        result.layers.add(layer)

        # Resolve color with BYLAYER/BYBLOCK support
        color_aci, rgb_color = self._resolve_entity_color(entity, layer)

        lineweight = float(entity.dxf.get("lineweight", 0)) / 100.0 if hasattr(entity.dxf, "lineweight") else None

        # ------------------- POINT -------------------
        if dxftype == "POINT":
            pos = entity.dxf.location
            position = (float(pos.x), float(pos.y), float(pos.z if hasattr(pos, 'z') else 0.0))
            result.points.append(ParsedPoint(
                position=position,
                layer=layer,
                color_aci=color_aci,
                rgb_color=rgb_color
            ))

        # ------------------- TEXT / MTEXT -------------------
        elif dxftype == "TEXT":
            label_data = parse_text_entity(entity)
            if label_data:
                # Apply resolved BYLAYER color if entity had no explicit color
                if label_data.color_aci is None or label_data.color_aci == 256:
                    label_data.color_aci = color_aci
                    if rgb_color:
                        label_data.rgb_color = rgb_color
                result.labels.append(label_data)

        elif dxftype == "MTEXT":
            label_data = parse_mtext_entity(entity)
            if label_data:
                # Apply resolved BYLAYER color if entity had no explicit color
                if label_data.color_aci is None or label_data.color_aci == 256:
                    label_data.color_aci = color_aci
                    if rgb_color:
                        label_data.rgb_color = rgb_color
                result.labels.append(label_data)

        # ------------------- LINE -------------------
        elif dxftype == "LINE":
            start = entity.dxf.start
            end = entity.dxf.end
            coords = [(float(start.x), float(start.y)), (float(end.x), float(end.y))]
            result.paths.append(ParsedPath(
                vertices=coords,
                closed=False,
                entity_type="LINE",
                layer=layer,
                color_aci=color_aci,
                rgb_color=rgb_color,
                lineweight=lineweight
            ))

        # ------------------- LWPOLYLINE / POLYLINE -------------------
        elif dxftype in ("LWPOLYLINE", "POLYLINE"):
            try:
                # Check if polyline has any bulge (arc) segments
                has_bulge = False
                if dxftype == "LWPOLYLINE":
                    try:
                        for p in entity.get_points(format="xyseb"):
                            if len(p) >= 5 and p[4] != 0:
                                has_bulge = True
                                break
                    except Exception:
                        pass

                if has_bulge:
                    # Use ezdxf.path for accurate arc tessellation
                    try:
                        path = ezdxf.path.make_path(entity)
                        vertices = [(float(p.x), float(p.y)) for p in path.flattening(
                            distance=self.config.flattening_distance
                        )]
                        if len(vertices) >= 2:
                            is_closed = bool(entity.closed)
                            result.paths.append(ParsedPath(
                                vertices=vertices,
                                closed=is_closed,
                                entity_type=dxftype,
                                layer=layer,
                                color_aci=color_aci,
                                rgb_color=rgb_color,
                                lineweight=lineweight
                            ))
                    except Exception as e:
                        logger.warning(f"Error tessellating polyline bulge arcs, falling back to straight lines: {e}")
                        # Fallback to straight-line extraction
                        pts = [(float(p[0]), float(p[1])) for p in entity.get_points()]
                        if len(pts) >= 2:
                            result.paths.append(ParsedPath(
                                vertices=pts,
                                closed=bool(entity.closed),
                                entity_type=dxftype,
                                layer=layer,
                                color_aci=color_aci,
                                rgb_color=rgb_color,
                                lineweight=lineweight
                            ))
                else:
                    # No bulge segments: extract 2D points directly (faster)
                    pts = [(float(p[0]), float(p[1])) for p in entity.get_points()]
                    if len(pts) >= 2:
                        is_closed = bool(entity.closed)
                        result.paths.append(ParsedPath(
                            vertices=pts,
                            closed=is_closed,
                            entity_type=dxftype,
                            layer=layer,
                            color_aci=color_aci,
                            rgb_color=rgb_color,
                            lineweight=lineweight
                        ))
            except Exception as e:
                logger.warning(f"Error reading polyline points: {e}")

        # ------------------- CURVES (ARC, CIRCLE, ELLIPSE, SPLINE) -------------------
        elif dxftype in ("ARC", "CIRCLE", "ELLIPSE", "SPLINE"):
            try:
                path = ezdxf.path.make_path(entity)
                # Tessellate path into polyline vertices
                vertices_3d = list(path.flattening(distance=self.config.flattening_distance))
                pts = [(float(p.x), float(p.y)) for p in vertices_3d]
                if len(pts) >= 2:
                    is_closed = (dxftype == "CIRCLE") or (pts[0] == pts[-1])
                    result.paths.append(ParsedPath(
                        vertices=pts,
                        closed=is_closed,
                        entity_type=dxftype,
                        layer=layer,
                        color_aci=color_aci,
                        rgb_color=rgb_color,
                        lineweight=lineweight
                    ))
            except Exception as e:
                logger.warning(f"Error tessellating curve {dxftype}: {e}")

        # ------------------- HATCH -------------------
        elif dxftype == "HATCH":
            try:
                hatch_paths = []
                for path in ezdxf.path.from_hatch(entity):
                    vertices_3d = list(path.flattening(distance=self.config.flattening_distance * 2))
                    pts = [(float(pt.x), float(pt.y)) for pt in vertices_3d]
                    if len(pts) >= 3:
                        hatch_paths.append(pts)

                if hatch_paths:
                    result.hatches.append(ParsedHatch(
                        paths=hatch_paths,
                        layer=layer,
                        color_aci=color_aci,
                        rgb_color=rgb_color
                    ))
            except Exception as e:
                logger.warning(f"Error parsing HATCH entity: {e}")
