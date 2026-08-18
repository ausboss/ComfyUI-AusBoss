from __future__ import annotations

import io
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import torch
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _preview_helpers, node_lama_inpaint, node_refine_mask, node_select_frame
from nodes._preview_helpers import (
    first_frame_to_pil,
    mask_to_preview_batch,
    preview_payload,
    save_temp_preview,
    temp_prefix,
)


def fake_folder_paths(temp_dir: str):
    class FakeFolderPaths:
        @staticmethod
        def get_temp_directory():
            return temp_dir

        @staticmethod
        def get_save_image_path(prefix, output_dir, _width, _height):
            folder = Path(output_dir) / "ausboss"
            folder.mkdir(parents=True, exist_ok=True)
            return str(folder), prefix, 1, "ausboss", prefix

    return FakeFolderPaths


class FirstFrameTests(unittest.TestCase):
    def test_the_first_frame_of_the_batch_is_the_one_saved(self):
        batch = torch.zeros(3, 4, 6, 3)
        batch[0, :, :, 1] = 1.0  # first frame green, the rest black
        preview = first_frame_to_pil(batch)
        self.assertEqual((preview.width, preview.height), (6, 4))
        self.assertEqual(preview.getpixel((0, 0)), (0, 255, 0))

    def test_a_one_channel_frame_becomes_grayscale_not_a_broken_rgb(self):
        mask = torch.full((1, 3, 5), 0.5)
        preview = first_frame_to_pil(mask_to_preview_batch(mask))
        self.assertEqual(preview.mode, "L")
        self.assertEqual(preview.size, (5, 3))
        self.assertEqual(preview.getpixel((0, 0)), 128)

    def test_alpha_is_dropped_so_the_panel_shows_coverage_not_a_hole(self):
        rgba = torch.zeros(1, 2, 2, 4)
        rgba[..., 0] = 1.0  # opaque red pixels...
        rgba[..., 3] = 0.0  # ...with a fully transparent alpha channel
        preview = first_frame_to_pil(rgba)
        self.assertEqual(preview.mode, "RGB")
        self.assertEqual(preview.getpixel((0, 0)), (255, 0, 0))

    def test_values_outside_the_range_are_clamped_rather_than_wrapped(self):
        batch = torch.tensor([[[[-1.0, 0.5, 2.0]]]])
        self.assertEqual(first_frame_to_pil(batch).getpixel((0, 0)), (0, 128, 255))

    def test_the_shape_complaints_name_the_node_that_asked(self):
        with self.assertRaisesRegex(ValueError, "Mask Refine expected a BHWC"):
            first_frame_to_pil(torch.zeros(4, 6, 3), "Mask Refine")
        with self.assertRaisesRegex(ValueError, "empty"):
            first_frame_to_pil(torch.zeros(0, 4, 6, 3))
        with self.assertRaisesRegex(ValueError, "BHW MASK"):
            mask_to_preview_batch(torch.zeros(2, 3, 4, 1))


class SaveTempPreviewTests(unittest.TestCase):
    def test_a_png_lands_in_the_temp_folder_with_a_matching_ui_entry(self):
        image = torch.rand(2, 8, 12, 3)
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)):
                entry = save_temp_preview(image, "ausboss_test", "Select Frame")
            self.assertEqual(entry["type"], "temp")
            self.assertEqual(entry["subfolder"], "ausboss")
            self.assertEqual((entry["width"], entry["height"]), (12, 8))
            saved = Path(tmp) / "ausboss" / entry["filename"]
            with Image.open(saved) as png:
                self.assertEqual(png.size, (12, 8))

    def test_two_instances_of_a_node_never_share_a_prefix(self):
        self.assertNotEqual(temp_prefix("mask_refine"), temp_prefix("mask_refine"))
        self.assertTrue(temp_prefix("mask_refine").startswith("ausboss_mask_refine_"))


class PreviewPayloadTests(unittest.TestCase):
    def test_the_payload_carries_both_the_preview_and_the_outputs(self):
        image = torch.rand(1, 4, 4, 3)
        outputs = (image, "second")
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)):
                payload = preview_payload(image, "ausboss_test", "Select Frame", outputs)
        self.assertEqual(payload["result"], outputs)
        self.assertEqual(len(payload["ui"]["images"]), 1)

    def test_a_preview_that_cannot_be_written_never_costs_the_outputs(self):
        # A full disk or a swept temp folder must not turn a finished inpaint
        # into a failed node; the panel is the only thing that goes quiet.
        image = torch.rand(1, 4, 4, 3)
        outputs = (image,)
        with patch.object(_preview_helpers, "folder_paths", None):
            printed = io.StringIO()
            with redirect_stdout(printed):
                payload = preview_payload(image, "ausboss_test", "LaMa Inpaint", outputs)
        self.assertEqual(payload["result"], outputs)
        self.assertNotIn("ui", payload)
        note = printed.getvalue()
        self.assertIn("LaMa Inpaint", note)
        note.encode("ascii")  # Windows consoles are cp1252


class NodePreviewContractTests(unittest.TestCase):
    """The three nodes that now show their own result on their own face.

    Each returns a dict rather than a bare tuple, which ComfyUI unpacks in
    execution.py: 'ui' is forwarded to the frontend and 'result' becomes the
    node's outputs. The outputs must still match RETURN_TYPES exactly.
    """

    def run_with_temp(self, call):
        # mkdtemp with a cleanup hook, not a with-block: the returned paths
        # are opened by the test body, which runs after a with-block would
        # already have deleted the directory out from under them.
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with patch.object(_preview_helpers, "folder_paths", fake_folder_paths(tmp)):
            payload = call()
        return payload, sorted((Path(tmp) / "ausboss").glob("*.png"))

    def test_mask_refine_previews_the_refined_mask_and_still_returns_both_masks(self):
        mask = torch.zeros(1, 16, 24)
        mask[:, 4:12, 6:18] = 1.0
        node = node_refine_mask.AusBossRefineMask()
        payload, saved = self.run_with_temp(lambda: node.refine(
            mask, expand=2, blur=1.0, fill_holes=False, smooth=0,
            black_point=0.0, white_point=1.0, edge_refine="off",
        ))
        refined, inverted = payload["result"]
        self.assertEqual(len(payload["result"]), len(node.RETURN_TYPES))
        self.assertEqual(tuple(refined.shape), (1, 16, 24))
        torch.testing.assert_close(inverted, 1.0 - refined)
        # The preview is the mask this node produced, at the mask's own size.
        self.assertEqual(len(saved), 1)
        with Image.open(saved[0]) as png:
            self.assertEqual(png.size, (24, 16))
            self.assertEqual(png.mode, "L")

    def test_select_frame_previews_the_frame_it_selected(self):
        frames = torch.zeros(4, 6, 8, 3)
        frames[2, :, :, 0] = 1.0  # third frame is the red one
        node = node_select_frame.AusBossSelectFrame()
        payload, saved = self.run_with_temp(lambda: node.select_frame(frames, 3))
        (selected,) = payload["result"]
        self.assertEqual(len(payload["result"]), len(node.RETURN_TYPES))
        torch.testing.assert_close(selected[0], frames[2])
        with Image.open(saved[0]) as png:
            self.assertEqual(png.getpixel((0, 0)), (255, 0, 0))

    def test_lama_inpaint_previews_its_result_even_for_a_single_image(self):
        # The bug this replaces: previews were attached to the progress bar
        # only when the batch had more than one frame, so a one-image run
        # finished with an empty panel and nothing to look at.
        image = torch.rand(1, 8, 8, 3)
        inpainted = torch.rand(1, 8, 8, 3)
        node = node_lama_inpaint.AusBossLaMaInpaint()
        with patch.object(node_lama_inpaint, "run_lama_inpaint", return_value=inpainted):
            payload, saved = self.run_with_temp(
                lambda: node.inpaint(image, torch.ones(1, 8, 8), "big-lama.pt")
            )
        self.assertIs(payload["result"][0], inpainted)
        self.assertEqual(len(payload["result"]), len(node.RETURN_TYPES))
        self.assertEqual(len(saved), 1)

    def test_each_node_instance_writes_to_its_own_prefix(self):
        # Two of the same node run in one graph; without distinct prefixes the
        # second would overwrite the first and both panels show one picture.
        for factory in (
            node_refine_mask.AusBossRefineMask,
            node_select_frame.AusBossSelectFrame,
            node_lama_inpaint.AusBossLaMaInpaint,
        ):
            with self.subTest(node=factory.__name__):
                self.assertNotEqual(factory()._prefix, factory()._prefix)


if __name__ == "__main__":
    unittest.main()
