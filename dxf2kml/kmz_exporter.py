"""
KMZ Exporter module.
Wraps the KML document in a ZIP archive with the .kmz extension.
"""

from pathlib import Path
import zipfile
from loguru import logger


def save_as_kmz(kml_path: Path, kmz_path: Path) -> None:
    """
    Compresses a KML file into a KMZ archive.
    If the KML file uses local resources (icons, images), they would be bundled here.
    For now, we just zip the KML.
    """
    if not kml_path.exists():
        raise FileNotFoundError(f"Source KML file not found: {kml_path}")

    kmz_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # ZIP_DEFLATED provides good compression
        with zipfile.ZipFile(kmz_path, 'w', zipfile.ZIP_DEFLATED) as kmz:
            # Add the main KML file to the archive as doc.kml (standard KMZ practice)
            kmz.write(kml_path, arcname='doc.kml')

        logger.info(f"Successfully packaged KMZ document: {kmz_path}")
    except Exception as e:
        logger.error(f"Failed to create KMZ file: {e}")
        raise
