"""The editor's Show blend view is held to the run.

tests/fixtures/show_blend_canvas.json holds, for a few crop, rotate and pad
settings, the blend mask the run's stitcher carries, reduced to the size the
editor draws its preview at: the four edges of the canvas and one line
across the middle each way. tests/stitch_preview.test.mjs holds the preview
to those numbers; this file holds the numbers to the run, so neither side
can drift from the other unnoticed. After a deliberate change to the run,
refresh the fixture with ComfyUI's Python:

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_show_blend_fixture.py --update

Without ComfyUI the cases that resize are skipped: the resize is ComfyUI's.
"""

from pathlib import Path
import json
import math
import os
import sys
import unittest
from unittest.mock import patch

from PIL import Image
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad  # noqa: E402

UPDATE = "--update" in sys.argv
COMFY_ROOT = os.environ.get("AUSBOSS_COMFY_ROOT")
if COMFY_ROOT:
    sys.path.append(COMFY_ROOT)
    sys.argv = sys.argv[:1]  # ComfyUI's argument parser reads sys.argv
    import comfy.cli_args  # noqa: E402

    # The resize imports comfy.model_management, which would otherwise
    # claim the GPU; these checks need none.
    comfy.cli_args.args.cpu = True

FIXTURE = ROOT / "tests" / "fixtures" / "show_blend_canvas.json"
PREVIEW_SIDE = 384  # overlayPlan's longest side, js/shared/stitch_preview.mjs
LINES = ("top", "bottom", "left", "right", "row", "column")

# name, source size, the node's inputs. Every canvas is longer than the
# preview on one side and comes to a part pixel on the other, which is
# where a preview can show a blend the run does not have.
CASES = (
    ("top band, the other edges bare", (1916, 821), dict(pad_top=100)),
    ("left band on a tall picture", (821, 1916), dict(pad_left=100)),
    ("a crop and no padding", (1916, 821), dict(crop_x=100, crop_y=50, crop_width=1500, crop_height=502)),
    ("quarter turn with a left band", (1916, 821), dict(rotation_degrees=-90, pad_left=100)),
    ("tilted, the whole turned picture, right band", (1916, 821), dict(rotation_degrees=7.5, pad_right=120)),
    ("tilted, cropped inside the picture, top band", (1916, 821), dict(
        rotation_degrees=5, crop_x=300, crop_y=250, crop_width=1400, crop_height=560, pad_top=92,
    )),
    ("right band with feather and grow", (1916, 821), dict(pad_right=150, feather=24, stitch_blend=48, stitch_grow=8)),
    ("top band, resized to 1 MP", (1916, 821), dict(
        pad_top=246, resize_to_megapixels=True, megapixels=1.0, resolution_steps=32,
    )),
)


def preview_size(width, height):
    """overlayPlan's raster for a canvas: JavaScript rounds a half up."""
    k = min(1.0, PREVIEW_SIDE / max(1, width, height))
    return max(1, math.floor(width * k + 0.5)), max(1, math.floor(height * k + 0.5))


def run_case(source, values):
    """The blend mask the run's stitcher carries for one case, and its size."""
    frame = Image.new("RGB", source, (46, 150, 72))
    with patch("nodes.node_image_crop_rotate_pad.resolve_input_path", return_value=Path("source.png")), \
            patch("nodes.node_image_crop_rotate_pad.load_image_frames", return_value=[frame]):
        outputs = AusBossImageCropRotatePad().load_transform("source.png", **{"feather": 0, **values})
    blend = outputs[2]["blend"][0]
    return blend, (int(blend.shape[1]), int(blend.shape[0]))


def reduce_blend(blend, size):
    width, height = size
    reduced = torch.nn.functional.adaptive_avg_pool2d(blend[None, None].float(), (height, width))[0, 0]
    lines = {
        "top": reduced[0], "bottom": reduced[-1], "left": reduced[:, 0], "right": reduced[:, -1],
        "row": reduced[height // 2], "column": reduced[:, width // 2],
    }
    return {name: [round(float(value), 4) for value in line] for name, line in lines.items()}


def build_case(name, source, values, canvas):
    blend, target = run_case(source, values)
    raster = preview_size(*canvas)
    return {
        "name": name, "source": list(source), "values": values,
        "canvas": list(canvas), "target": list(target), "raster": list(raster),
        **reduce_blend(blend, raster),
    }


def canvas_size(source, values):
    """The canvas before any resize, from the run itself."""
    return run_case(source, {**values, "resize_to_megapixels": False})[1]


def needs_comfy(values):
    return bool(values.get("resize_to_megapixels"))


class ShowBlendFixtureTests(unittest.TestCase):
    def test_the_fixture_is_what_the_run_produces(self):
        stored = {case["name"]: case for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]}
        self.assertEqual(list(stored), [name for name, _, _ in CASES])
        for name, source, values in CASES:
            if needs_comfy(values) and not COMFY_ROOT:
                continue
            with self.subTest(case=name):
                current = build_case(name, source, values, canvas_size(source, values))
                saved = stored[name]
                for key in ("source", "values", "canvas", "target", "raster"):
                    self.assertEqual(current[key], saved[key], key)
                for line in LINES:
                    self.assertEqual(len(current[line]), len(saved[line]), line)
                    worst = max(abs(a - b) for a, b in zip(current[line], saved[line]))
                    self.assertLess(worst, 2e-3, f"{line}: refresh the fixture with --update (see this file's docstring)")

    def test_the_run_blends_nothing_on_a_bare_edge(self):
        # The reported picture: 100 px of padding on top only. The run's
        # paste mask is exactly 0 along the bottom, so the preview's must be.
        blend, _ = run_case((1916, 821), dict(pad_top=100))
        self.assertEqual(float(blend[-40:].max()), 0.0)
        self.assertEqual(float(blend[:100].min()), 1.0)

    def test_the_preview_size_rounds_as_javascript_does(self):
        self.assertEqual(preview_size(1916, 921), (384, 185))
        self.assertEqual(preview_size(1500, 502), (384, 129))
        self.assertEqual(preview_size(200, 100), (200, 100))


if __name__ == "__main__":
    if UPDATE:
        if not COMFY_ROOT:
            sys.exit("Set AUSBOSS_COMFY_ROOT to a ComfyUI checkout.")
        cases = [build_case(name, source, values, canvas_size(source, values)) for name, source, values in CASES]
        lines = ["{", ' "cases": [']
        lines += [f"  {json.dumps(case)}{',' if index < len(cases) - 1 else ''}" for index, case in enumerate(cases)]
        lines += [" ]", "}"]
        FIXTURE.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"Wrote {FIXTURE.relative_to(ROOT)}: {len(cases)} cases.")
    else:
        unittest.main()
