"""
DWG -> DXF conversion via the (free, closed-source) ODA File Converter.

Why not ``ezdxf.addons.odafc.readfile``?
  * it runs the converter without a timeout (a hung converter hangs the worker forever);
  * on Linux it needs either ``Xvfb`` or an existing ``DISPLAY`` (``KeyError`` otherwise)
    and starts Xvfb on display ``:<pid>``, which collides when two threads convert at once;
  * it converts from the *parent directory* of the input file.

This module invokes the converter directly: argument list (never a shell), a private
input directory per job, a hard timeout that kills the whole process group, headless
execution through ``xvfb-run -a`` (auto-selects a free display) or Qt's offscreen
platform, and bounded concurrency.

Configuration (environment variables):
  ODA_FILE_CONVERTER       explicit path to the ODAFileConverter executable
  ODA_TIMEOUT_SECONDS      per-file timeout (default 120)
  ODA_MAX_CONCURRENCY      simultaneous conversions (default 1)
"""

from __future__ import annotations

import glob
import os
import platform
import shutil
import signal
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import List, Optional

from loguru import logger

from dxf2kml.errors import DWGConversionError, InputFileError

ODA_OUTPUT_VERSION = "ACAD2018"
_DWG_MAGIC_PREFIX = b"AC10"
_DEFAULT_TIMEOUT = float(os.environ.get("ODA_TIMEOUT_SECONDS", "120"))
_semaphore = threading.BoundedSemaphore(max(1, int(os.environ.get("ODA_MAX_CONCURRENCY", "1"))))


def is_dwg_file(path: Path) -> bool:
    """Detect DWG by content (magic bytes 'AC10xx'), not by file extension."""
    try:
        with open(path, "rb") as f:
            return f.read(4) == _DWG_MAGIC_PREFIX
    except OSError:
        return False


def find_oda_converter() -> Optional[str]:
    """Locate the ODAFileConverter executable, or return None if it is not installed."""
    explicit = os.environ.get("ODA_FILE_CONVERTER")
    if explicit:
        return explicit if Path(explicit).is_file() else None

    found = shutil.which("ODAFileConverter")
    if found:
        return found

    if platform.system() == "Windows":
        candidates: List[str] = []
        for root in (os.environ.get("ProgramFiles", r"C:\Program Files"),
                     os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")):
            candidates += glob.glob(os.path.join(root, "ODA", "ODAFileConverter*", "ODAFileConverter.exe"))
        if candidates:
            return sorted(candidates)[-1]  # newest version directory sorts last
    else:
        for candidate in ("/usr/bin/ODAFileConverter", "/usr/local/bin/ODAFileConverter"):
            if Path(candidate).is_file():
                return candidate
    return None


def is_dwg_supported() -> bool:
    return find_oda_converter() is not None


def _build_command(executable: str, in_dir: str, out_dir: str, filename: str) -> List[str]:
    # ODAFileConverter <in folder> <out folder> <version> <type> <recurse> <audit> [filter]
    command = [executable, in_dir, out_dir, ODA_OUTPUT_VERSION, "DXF", "0", "1", filename]
    if platform.system() == "Linux" and shutil.which("xvfb-run"):
        command = ["xvfb-run", "-a", "-s", "-screen 0 800x600x24"] + command
    return command


def _run(command: List[str], timeout: float) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    kwargs = {}
    if platform.system() == "Windows":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        kwargs["startupinfo"] = startupinfo
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True  # own process group -> killable as a unit
        if command[0] != "xvfb-run":
            env.setdefault("QT_QPA_PLATFORM", "offscreen")

    proc = subprocess.Popen(
        command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env, shell=False, **kwargs,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if platform.system() == "Windows":
            proc.kill()
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        proc.communicate()
        raise
    return subprocess.CompletedProcess(command, proc.returncode, stdout, stderr)


def convert_dwg_to_dxf(dwg_path: Path, out_dir: Path, timeout: Optional[float] = None) -> Path:
    """
    Convert ``dwg_path`` to a DXF file inside ``out_dir`` and return its path.

    Raises:
        InputFileError: the file is not a DWG drawing.
        DWGConversionError: converter not installed, timed out, or failed.
    """
    if not is_dwg_file(dwg_path):
        raise InputFileError("The file is not a valid DWG drawing.")

    executable = find_oda_converter()
    if executable is None:
        raise DWGConversionError(
            "DWG files require the ODA File Converter, which is not installed on this server. "
            "Please save the drawing as DXF in AutoCAD (SAVEAS -> DXF) and upload the DXF instead."
        )

    timeout = timeout or _DEFAULT_TIMEOUT
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dxf2kml_oda_in_") as in_dir:
        # Fixed, safe filename in a private directory: the converter processes the
        # whole input folder, and user filenames never reach the command line.
        staged = Path(in_dir) / "input.dwg"
        shutil.copyfile(dwg_path, staged)
        command = _build_command(executable, in_dir, str(out_dir), staged.name)

        with _semaphore:
            logger.info(f"Running ODA File Converter ({executable}) with timeout {timeout:.0f}s")
            try:
                proc = _run(command, timeout)
            except subprocess.TimeoutExpired as ex:
                logger.warning("ODA File Converter timed out")
                raise DWGConversionError(
                    "DWG conversion timed out. The drawing may be too large or corrupt; "
                    "please save it as DXF and upload the DXF instead."
                ) from ex
            except OSError as ex:
                logger.error(f"Could not start ODA File Converter: {ex}")
                raise DWGConversionError("DWG conversion is currently unavailable on this server.") from ex

    output = out_dir / "input.dxf"
    stderr = (proc.stderr or b"").decode("utf-8", "replace").strip()
    if not output.is_file() or output.stat().st_size == 0:
        # The Linux build of the converter often exits non-zero ("Quit (core dumped)")
        # even on success, so the presence of the output file is the success criterion.
        logger.warning(f"ODA File Converter produced no output (rc={proc.returncode}, stderr={stderr[:500]!r})")
        raise DWGConversionError(
            "The DWG file could not be converted. It may be corrupt, password protected, "
            "or saved by an unsupported AutoCAD version."
        )
    if proc.returncode != 0:
        logger.info(f"ODA File Converter exited with rc={proc.returncode} but produced output ({stderr[:200]!r})")
    return output
