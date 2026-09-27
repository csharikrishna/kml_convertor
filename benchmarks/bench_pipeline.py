"""
Pipeline benchmark: synthetic survey-like drawings of increasing size.

Each drawing contains, per "cell": a closed parcel LWPOLYLINE with a bulged corner,
four LINE road segments on a shared grid (so merging/polygonizing has real work),
an ARC, a TEXT label and a POINT; plus one block with 5 entities inserted per cell.

Usage:
    python benchmarks/bench_pipeline.py            # small, medium, large
    python benchmarks/bench_pipeline.py --sizes 100 1000 --kmz

Reports per-stage wall time (from ConversionResult.timings), output size and peak
resident memory (RSS, sampled) - numbers are machine-dependent; compare relatively.
"""

import argparse
import sys
import tempfile
import threading
import time
from pathlib import Path

import ezdxf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from loguru import logger  # noqa: E402

from dxf2kml.config import ConverterConfig  # noqa: E402
from dxf2kml.pipeline import convert  # noqa: E402

X0, Y0 = 250000.0, 1900000.0


def make_drawing(path: Path, cells: int) -> int:
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    for name, color in (("PARCELS", 1), ("ROADS", 3), ("TEXT", 7), ("TREES", 2)):
        doc.layers.add(name, color=color)
    tree = doc.blocks.new("TREE")
    tree.add_circle((0, 0), 1.5)
    tree.add_line((-1, 0), (1, 0))
    tree.add_line((0, -1), (0, 1))
    tree.add_point((0, 0))
    tree.add_arc((0, 0), 0.8, 0, 180)

    side = max(1, int(cells ** 0.5))
    for i in range(cells):
        cx = X0 + (i % side) * 30.0
        cy = Y0 + (i // side) * 30.0
        msp.add_lwpolyline(
            [(cx + 2, cy + 2, 0, 0, 0), (cx + 25, cy + 2, 0, 0, 0.2), (cx + 25, cy + 25), (cx + 2, cy + 25)],
            format="xyseb", close=True, dxfattribs={"layer": "PARCELS"},
        )
        for a, b in (((cx, cy), (cx + 30, cy)), ((cx, cy), (cx, cy + 30))):
            msp.add_line(a, b, dxfattribs={"layer": "ROADS"})
        msp.add_arc((cx + 15, cy + 15), 4, 10, 170, dxfattribs={"layer": "ROADS"})
        msp.add_text(f"P-{i}", dxfattribs={"insert": (cx + 10, cy + 10), "layer": "TEXT", "height": 2.5})
        msp.add_point((cx + 5, cy + 5), dxfattribs={"layer": "TREES"})
        msp.add_blockref("TREE", (cx + 20, cy + 8), dxfattribs={"layer": "TREES", "rotation": i % 360})
    doc.saveas(path)
    return len(msp)


class PeakRSS:
    def __init__(self, interval=0.02):
        import psutil
        self.proc = psutil.Process()
        self.interval = interval
        self.peak = self.proc.memory_info().rss
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            self.peak = max(self.peak, self.proc.memory_info().rss)
            time.sleep(self.interval)

    def __enter__(self):
        self.base = self.proc.memory_info().rss
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", type=int, nargs="+", default=[100, 1000, 5000])
    parser.add_argument("--kmz", action="store_true")
    args = parser.parse_args()
    logger.remove()

    header = f"{'cells':>7} {'entities':>9} {'dxf MB':>7} {'load':>6} {'parse':>6} {'geom':>6} {'tf+write':>8} {'total':>6} {'out MB':>7} {'peak MB':>8}"
    print(header)
    print("-" * len(header))
    with tempfile.TemporaryDirectory() as tmp:
        for cells in args.sizes:
            src = Path(tmp) / f"bench_{cells}.dxf"
            entities = make_drawing(src, cells)
            out = Path(tmp) / f"bench_{cells}.{'kmz' if args.kmz else 'kml'}"
            with PeakRSS() as mem:
                result = convert(src, out, ConverterConfig())
            t = result.timings
            print(f"{cells:>7} {entities:>9} {src.stat().st_size / 1e6:>7.1f} {t['load']:>6.2f} {t['parse']:>6.2f} "
                  f"{t['geometry']:>6.2f} {t['transform_write']:>8.2f} {t['total']:>6.2f} "
                  f"{out.stat().st_size / 1e6:>7.1f} {(mem.peak - mem.base) / 1e6:>8.0f}")


if __name__ == "__main__":
    main()
