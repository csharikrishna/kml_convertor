"""
DWG handling: content sniffing, missing converter, converter failure and timeouts.

The real ODA File Converter is exercised only when it is installed (e.g. in the Docker
image); everything else uses a stand-in Python script so the subprocess lifecycle
(argument list, timeout kill, output detection) is tested on every platform.
"""

import sys
import textwrap

import pytest

from dxf2kml import dwg
from dxf2kml.config import ConverterConfig
from dxf2kml.errors import DWGConversionError, InputFileError
from dxf2kml.pipeline import convert

from .conftest import EXAMPLE_DWG


def _fake_converter(tmp_path, monkeypatch, body: str):
    script = tmp_path / "fake_oda.py"
    script.write_text(textwrap.dedent(body), encoding="utf-8")
    monkeypatch.setattr(dwg, "find_oda_converter", lambda: "fake")
    monkeypatch.setattr(dwg, "_build_command",
                        lambda exe, in_dir, out_dir, name: [sys.executable, str(script), in_dir, out_dir, name])


@pytest.fixture
def dwg_file(tmp_path):
    path = tmp_path / "drawing.dwg"
    path.write_bytes(b"AC1032" + b"\x00" * 64)
    return path


def test_dwg_is_detected_by_content_not_extension(tmp_path):
    fake = tmp_path / "actually_dwg.dxf"
    fake.write_bytes(b"AC1027" + b"\x00" * 10)
    text = tmp_path / "text.dwg"
    text.write_text("0\nSECTION\n", encoding="ascii")
    assert dwg.is_dwg_file(fake) and not dwg.is_dwg_file(text)


def test_missing_converter_gives_actionable_error(dwg_file, tmp_path, monkeypatch):
    monkeypatch.setattr(dwg, "find_oda_converter", lambda: None)
    with pytest.raises(DWGConversionError, match="save the drawing as DXF"):
        dwg.convert_dwg_to_dxf(dwg_file, tmp_path / "out")


def test_non_dwg_input_rejected(tmp_path):
    path = tmp_path / "x.dwg"
    path.write_bytes(b"hello")
    with pytest.raises(InputFileError):
        dwg.convert_dwg_to_dxf(path, tmp_path / "out")


def test_successful_conversion(dwg_file, tmp_path, monkeypatch):
    _fake_converter(tmp_path, monkeypatch, """
        import sys, pathlib, ezdxf
        in_dir, out_dir, name = sys.argv[1:4]
        assert (pathlib.Path(in_dir) / name).read_bytes().startswith(b"AC10")
        doc = ezdxf.new("R2018"); doc.modelspace().add_line((250000, 1900000), (250010, 1900000))
        doc.saveas(pathlib.Path(out_dir) / pathlib.Path(name).with_suffix(".dxf").name)
    """)
    out = dwg.convert_dwg_to_dxf(dwg_file, tmp_path / "out")
    assert out.name == "input.dxf" and out.stat().st_size > 0

    kml = tmp_path / "from_dwg.kml"
    result = convert(dwg_file, kml, ConverterConfig())
    assert result.parse_result.source_format == "DWG"
    assert result.export_stats.polylines_exported == 1


def test_converter_producing_nothing_is_an_error(dwg_file, tmp_path, monkeypatch):
    _fake_converter(tmp_path, monkeypatch, "import sys; sys.exit(3)\n")
    with pytest.raises(DWGConversionError, match="could not be converted"):
        dwg.convert_dwg_to_dxf(dwg_file, tmp_path / "out")


def test_converter_timeout_is_enforced(dwg_file, tmp_path, monkeypatch):
    _fake_converter(tmp_path, monkeypatch, "import time; time.sleep(30)\n")
    import time
    t = time.monotonic()
    with pytest.raises(DWGConversionError, match="timed out"):
        dwg.convert_dwg_to_dxf(dwg_file, tmp_path / "out", timeout=1)
    assert time.monotonic() - t < 15


def test_linux_command_uses_xvfb_run_when_available(monkeypatch):
    monkeypatch.setattr(dwg.platform, "system", lambda: "Linux")
    monkeypatch.setattr(dwg.shutil, "which", lambda name: "/usr/bin/xvfb-run" if name == "xvfb-run" else None)
    cmd = dwg._build_command("/usr/bin/ODAFileConverter", "/in", "/out", "input.dwg")
    assert cmd[:2] == ["xvfb-run", "-a"]
    assert cmd[-7:] == ["/in", "/out", dwg.ODA_OUTPUT_VERSION, "DXF", "0", "1", "input.dwg"]


@pytest.mark.skipif(not dwg.is_dwg_supported(), reason="ODA File Converter not installed")
def test_real_oda_converts_example_dwg(tmp_path):
    result = convert(EXAMPLE_DWG, tmp_path / "example.kml", ConverterConfig())
    assert result.parse_result.source_format == "DWG"
    assert result.export_stats.labels_exported >= 8
