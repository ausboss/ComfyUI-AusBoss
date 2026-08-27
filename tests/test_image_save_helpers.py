from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from PIL import Image

from nodes._image_save_helpers import (
    encode_image,
    existing_action,
    jxl_available,
    plan_exact_names,
    resolve_output_root,
    sanitize_exact_name,
    sidecar_path,
    strip_image_extension,
)
from nodes import node_save_image


def gradient_batch(count: int, height: int, width: int) -> torch.Tensor:
    ramp = torch.linspace(0.0, 1.0, width).view(1, 1, width, 1)
    return ramp.expand(count, height, width, 3).clone()


class NamingTests(unittest.TestCase):
    def test_image_extensions_strip_and_others_stay(self):
        self.assertEqual(strip_image_extension("photo123.jpg"), "photo123")
        self.assertEqual(strip_image_extension("photo123.JXL"), "photo123")
        self.assertEqual(strip_image_extension("photo123"), "photo123")
        # A dot that is not an image extension is part of the name.
        self.assertEqual(strip_image_extension("shot.v2"), "shot.v2")
        self.assertEqual(strip_image_extension("a.b.png"), "a.b")

    def test_sanitize_allows_subfolders_and_blocks_escape(self):
        self.assertEqual(sanitize_exact_name("set1/photo"), "set1/photo")
        self.assertEqual(sanitize_exact_name("  set1\\photo  "), "set1/photo")
        self.assertEqual(sanitize_exact_name("./photo"), "photo")
        with self.assertRaises(ValueError):
            sanitize_exact_name("../photo")
        with self.assertRaises(ValueError):
            sanitize_exact_name("/rooted/photo")
        with self.assertRaises(ValueError):
            sanitize_exact_name("C:\\rooted\\photo")

    def test_single_image_gets_exactly_the_name(self):
        self.assertEqual(plan_exact_names("photo123", "png", 1), ["photo123.png"])

    def test_batches_number_their_frames_stably(self):
        names = plan_exact_names("clip", "jxl", 3)
        self.assertEqual(names, ["clip_001.jxl", "clip_002.jxl", "clip_003.jxl"])

    def test_existing_policies(self):
        self.assertEqual(existing_action(False, "error"), "write")
        self.assertEqual(existing_action(True, "overwrite"), "write")
        self.assertEqual(existing_action(True, "skip"), "skip")
        with self.assertRaises(ValueError):
            existing_action(True, "error")
        with self.assertRaises(ValueError):
            existing_action(False, "ask nicely")

    def test_output_root_resolution(self):
        with tempfile.TemporaryDirectory() as tmp:
            default = Path(tmp)
            self.assertEqual(resolve_output_root("", default), default)
            self.assertEqual(resolve_output_root("sub/dir", default), (default / "sub/dir").resolve())
            absolute = Path(tmp) / "elsewhere"
            self.assertEqual(resolve_output_root(str(absolute), default), absolute)
            with self.assertRaises(ValueError):
                resolve_output_root("../outside", default)

    def test_sidecar_shares_the_basename(self):
        self.assertEqual(sidecar_path(Path("/x/photo123.png")), Path("/x/photo123.txt"))


class EncodeTests(unittest.TestCase):
    def test_png_roundtrips_and_embeds_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "one.png"
            encode_image(path, gradient_batch(1, 8, 16)[0], "png", {"prompt": "{}", "workflow": "{\"a\": 1}"})
            with Image.open(path) as image:
                self.assertEqual(image.size, (16, 8))
                self.assertEqual(image.text.get("workflow"), '{"a": 1}')

    def test_png_without_metadata_is_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "one.png"
            encode_image(path, gradient_batch(1, 8, 16)[0], "png", None)
            with Image.open(path) as image:
                self.assertEqual(dict(image.text), {})

    @unittest.skipUnless(jxl_available(), "pillow-jxl-plugin not installed")
    def test_jxl_lossless_roundtrips_bit_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "one.jxl"
            frame = gradient_batch(1, 8, 16)[0]
            encode_image(path, frame, "jxl lossless", None)
            import numpy as np

            with Image.open(path) as image:
                back = np.asarray(image.convert("RGB"))
            expected = np.clip(frame.numpy() * 255.0, 0, 255).astype("uint8")
            self.assertTrue((back == expected).all())

    def test_unknown_format_is_rejected(self):
        with self.assertRaises(ValueError):
            encode_image(Path("/nonexistent/x.png"), gradient_batch(1, 4, 4)[0], "bmp", None)


class SaveImageNodeTests(unittest.TestCase):
    def run_node(self, output_root, **overrides):
        class FakeFolderPaths:
            @staticmethod
            def get_output_directory():
                return str(output_root)

            @staticmethod
            def get_save_image_path(prefix, root, _w, _h):
                folder = Path(root) / Path(prefix).parent
                folder.mkdir(parents=True, exist_ok=True)
                name = Path(prefix).name
                existing = sorted(folder.glob(f"{name}_*_.*"))
                return str(folder), name, len(existing) + 1, str(Path(prefix).parent), prefix

        values = {
            "images": gradient_batch(1, 8, 16),
            "filename_prefix": "AusBoss/image",
            "format": "png",
            "save_metadata": False,
        }
        values.update(overrides)
        with patch.object(node_save_image, "folder_paths", FakeFolderPaths):
            return node_save_image.AusBossSaveImage().save(**values)

    def test_exact_name_saves_without_any_suffix(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_node(tmp, exact_name="photo123.jpg")
            saved = Path(result["result"][0])
            self.assertEqual(saved, Path(tmp) / "photo123.png")
            self.assertTrue(saved.exists())
            # In the output root, so a preview entry is offered.
            self.assertEqual(result["ui"]["images"][0]["filename"], "photo123.png")

    def test_exact_name_skip_leaves_the_original_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "photo.png"
            target.write_bytes(b"original")
            result = self.run_node(tmp, exact_name="photo", on_existing="skip")
            self.assertEqual(target.read_bytes(), b"original")
            # No file saved: empty path, but the passthrough batch still flows.
            self.assertEqual(result["result"][0], "")
            self.assertEqual(tuple(result["result"][1].shape), (1, 8, 16, 3))

    def test_exact_name_error_policy_stops_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "photo.png").write_bytes(b"x")
            with self.assertRaises(ValueError):
                self.run_node(tmp, exact_name="photo", on_existing="error")

    def test_caption_writes_the_paired_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.run_node(tmp, exact_name="photo123", caption="a red bicycle")
            self.assertEqual(
                (Path(tmp) / "photo123.txt").read_text(encoding="utf-8"),
                "a red bicycle",
            )

    def test_exact_batch_numbers_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.run_node(tmp, images=gradient_batch(2, 8, 16), exact_name="clip")
            self.assertTrue((Path(tmp) / "clip_001.png").exists())
            self.assertTrue((Path(tmp) / "clip_002.png").exists())

    def test_absolute_output_dir_saves_outside_and_skips_preview(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as elsewhere:
            result = self.run_node(tmp, exact_name="photo", output_dir=elsewhere)
            self.assertEqual(Path(result["result"][0]).parent, Path(elsewhere))
            self.assertEqual(result["ui"]["images"], [])

    def test_classic_mode_counters_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = self.run_node(tmp)
            second = self.run_node(tmp)
            self.assertNotEqual(first["result"], second["result"])
            self.assertTrue(Path(first["result"][0]).exists())
            self.assertTrue(Path(second["result"][0]).exists())

    def test_validation_rejects_rooted_exact_names_early(self):
        node = node_save_image.AusBossSaveImage
        self.assertIsInstance(node.VALIDATE_INPUTS(exact_name="../x"), str)
        self.assertIs(node.VALIDATE_INPUTS(exact_name="fine/name"), True)
        self.assertIs(node.VALIDATE_INPUTS(), True)


if __name__ == "__main__":
    unittest.main()
