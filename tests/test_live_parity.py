"""The browser's live preview must agree with the nodes it draws.

Film Grain, Keep Detail and Cut Out redraw their result on the node while a
value is dragged, in the browser (js/shared/live_grain.mjs, live_detail.mjs,
live_cutout.mjs). tests/live_preview.test.mjs holds that code to the numbers
in tests/fixtures/live_parity.json, which this file makes from the Python
nodes: a small picture, the settings, and what the node returned. This test
checks that the nodes still return those numbers, so a change to a node shows
up here until the fixture is refreshed (and the JS follows):

    python tests/test_live_parity.py --update

The grain's random numbers cannot be shared (torch's generator is not
reproduced in the browser), so the fixture also records the random cells the
node drew, and the JS is run on those.
"""

from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _grain_helpers
from nodes._cut_out_helpers import cut_out
from nodes._detail_helpers import keep_detail
from nodes._grain_helpers import add_film_grain, auto_grain, grain_frame, measure_noise

FIXTURE = ROOT / "tests" / "fixtures" / "live_parity.json"
DIGITS = 5


def flat(tensor):
    return [round(float(v), DIGITS) for v in tensor.reshape(-1).tolist()]


def picture(height=24, width=32, seed=1, noise=0.0):
    """A small picture with a soft gradient, a hard edge and a bit of texture."""
    generator = torch.Generator().manual_seed(seed)
    ys = torch.linspace(0.1, 0.9, height).view(height, 1, 1)
    xs = torch.linspace(0.2, 0.8, width).view(1, width, 1)
    base = torch.cat([ys.expand(height, width, 1), xs.expand(height, width, 1), (ys * xs).expand(height, width, 1)], dim=-1)
    base[:, width // 2 :, :] *= 0.55
    base = base + noise * torch.randn((height, width, 3), generator=generator)
    return base.clamp(0.0, 1.0).unsqueeze(0)


def mask_blob(height=24, width=32):
    ys = torch.arange(height).view(-1, 1).float()
    xs = torch.arange(width).view(1, -1).float()
    inside = ((ys - 12) ** 2 / 81 + (xs - 16) ** 2 / 144) <= 1.0
    soft = (1.0 - (((ys - 12) ** 2 / 81 + (xs - 16) ** 2 / 144) - 0.6).clamp(0.0, 0.4) / 0.4)
    return torch.where(inside, soft, torch.zeros_like(soft)).clamp(0.0, 1.0).unsqueeze(0)


def record_cells(run):
    """Run `run()` and return its result with every random grid it drew."""
    drawn = []
    real = torch.randn

    def recording(*args, **kwargs):
        value = real(*args, **kwargs)
        drawn.append({"shape": list(value.shape[1:]), "data": flat(value)})
        return value

    _grain_helpers.torch.randn = recording
    try:
        result = run()
    finally:
        _grain_helpers.torch.randn = real
    return result, drawn


def build():
    cases = {"grain": [], "detail": [], "cutout": [], "noise": [], "auto": []}
    height, width = 24, 32
    base = picture(height, width)
    for name, size, roughness, color in (
        ("plain", 1.0, 0.0, 0.0),
        ("bigger", 2.0, 0.5, 0.3),
        ("finer", 0.5, 0.0, 0.0),
        ("rough colour", 1.5, 1.0, 0.7),
    ):
        # The grid draws round(side / size) cells; recorded as drawn.
        def run(size=size, roughness=roughness, color=color):
            return grain_frame(11, height, width, size, roughness, color)

        grain, cells = record_cells(run)
        out = add_film_grain(base, 0.4, size, roughness, color, True, 11)
        cases["grain"].append({
            "name": name, "size": size, "roughness": roughness, "color": color, "amount": 0.4,
            "cells": cells, "grain": flat(grain), "grain_channels": int(grain.shape[0]),
            "result": flat(out),
        })
    original = picture(height, width, seed=2, noise=0.04)
    smooth = picture(height, width, seed=2, noise=0.0)
    for name, kwargs in (
        ("edge safe, light", dict(detail_size=3.0, strength=1.0, color_detail=False, edge_safe=True)),
        ("plain blur, colour", dict(detail_size=2.0, strength=1.5, color_detail=True, edge_safe=False)),
        ("half strength", dict(detail_size=4.0, strength=0.5, color_detail=False, edge_safe=True)),
    ):
        result, _ = keep_detail(smooth, original, **kwargs)
        cases["detail"].append({"name": name, **kwargs, "result": flat(result)})
    mask = mask_blob(height, width)
    for name, kwargs in (
        ("plain", dict(keep="white", grow=0, feather=1.0, clean_edges=True, clear_haze=0.0, solid_above=1.0)),
        ("grown and feathered", dict(keep="white", grow=2, feather=2.0, clean_edges=True, clear_haze=0.1, solid_above=0.9)),
        ("black, shrunk", dict(keep="black", grow=-2, feather=0.0, clean_edges=False, clear_haze=0.0, solid_above=1.0)),
    ):
        result, alpha = cut_out(base, mask, **kwargs)
        cases["cutout"].append({"name": name, **kwargs, "result": flat(result), "alpha": flat(alpha)})
    for name, noise in (("clean", 0.0), ("light", 0.01), ("heavy", 0.05)):
        image = picture(30, 40, seed=3, noise=noise)
        cases["noise"].append({"name": name, "noise": noise, "height": 30, "width": 40, "image": flat(image), "measured": round(measure_noise(image), 8)})
    for h, w, n in ((1000, 1000, 0.0), (2000, 2000, 0.0), (2000, 2000, 0.02), (500, 700, 0.2)):
        amount, size = auto_grain(h, w, n)
        cases["auto"].append({"height": h, "width": w, "noise": n, "amount": round(amount, 8), "size": round(size, 8)})
    return {
        "digits": DIGITS,
        "height": height,
        "width": width,
        "image": flat(base),
        "original": flat(original),
        "smooth": flat(smooth),
        "mask": flat(mask),
        "cases": cases,
    }


class LiveParityFixtureTests(unittest.TestCase):
    def test_fixture_is_what_the_nodes_return(self):
        saved = json.loads(FIXTURE.read_text())
        fresh = json.loads(json.dumps(build()))

        def close(a, b, path=""):
            if isinstance(a, dict):
                self.assertEqual(a.keys(), b.keys(), path)
                for key in a:
                    close(a[key], b[key], f"{path}/{key}")
            elif isinstance(a, list):
                self.assertEqual(len(a), len(b), path)
                for index, (x, y) in enumerate(zip(a, b)):
                    close(x, y, f"{path}/{index}")
            elif isinstance(a, float):
                self.assertAlmostEqual(a, b, delta=2e-5, msg=path)
            else:
                self.assertEqual(a, b, path)

        close(saved, fresh)


if __name__ == "__main__":
    if "--update" in sys.argv:
        FIXTURE.write_text(json.dumps(build(), separators=(",", ":")) + "\n")
        print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size} bytes)")
    else:
        unittest.main()
