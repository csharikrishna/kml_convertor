"""
Shared test fixtures.

CAD fixtures are generated with ezdxf at test time instead of being committed as binary
files: they stay small, deterministic and reviewable, and each test documents exactly
which DXF feature it exercises.
"""

import sys
from pathlib import Path

import ezdxf
import pytest
from loguru import logger

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dxf2kml.config import ConverterConfig  # noqa: E402
from dxf2kml.parser import DXFParser  # noqa: E402

EXAMPLE_DXF = REPO_ROOT / "examples" / "3 Meedivemula  INDEX - Copy.dxf"
EXAMPLE_DWG = REPO_ROOT / "examples" / "3 Meedivemula  INDEX - Copy.dwg"

# UTM 44N coordinates near Kurnool, India (inside the CRS area of use)
UTM_X0, UTM_Y0 = 250000.0, 1900000.0


@pytest.fixture(autouse=True)
def _quiet_logs():
    logger.remove()
    yield


@pytest.fixture
def new_doc():
    """Fresh R2010 document factory."""
    def _make(version: str = "R2010"):
        doc = ezdxf.new(version)
        return doc, doc.modelspace()
    return _make


@pytest.fixture
def parse_doc(tmp_path):
    """Save an ezdxf document to disk and parse it with the production parser."""
    def _parse(doc, config: ConverterConfig = None, name: str = "fixture.dxf"):
        path = tmp_path / name
        doc.saveas(path)
        return DXFParser(config or ConverterConfig()).parse(path)
    return _parse
