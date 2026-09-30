"""File reads stay inside ComfyUI's folders.

Widget values reach the pack through ComfyUI's /prompt route, which needs no
login, and the loaders' VALIDATE_INPUTS hand their source straight to these
functions. So they are the gate between a crafted prompt and the disk:

- resolve_input_path takes only files inside ComfyUI's input folder;
- a network path ("//host/share" or "\\\\host\\share") is refused from its
  text alone, before anything touches the path, since on Windows merely
  resolving one contacts that host;
- local path mode (local_preview_allowed) reads only inside the input,
  output and temp folders, and never a network path either.

The guards need neither torch nor PyAV, so this file runs in CI: the media
module's heavy imports are stubbed when they are missing.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

HEAVY = ("av", "PIL", "numpy", "torch")
REAL_MEDIA_STACK = all(importlib.util.find_spec(name) for name in HEAVY)

# Only the import line needs these; the guards never call into them.
if importlib.util.find_spec("av") is None:
    sys.modules["av"] = types.ModuleType("av")
if importlib.util.find_spec("PIL") is None:
    pil = types.ModuleType("PIL")
    for part in ("Image", "ImageOps", "ImageSequence"):
        setattr(pil, part, types.ModuleType(f"PIL.{part}"))
    sys.modules["PIL"] = pil

from nodes import _media_helpers  # noqa: E402
from nodes._media_helpers import local_preview_allowed, resolve_input_path, resolve_video_path  # noqa: E402

NETWORK_REFUSAL = "Network source paths are not allowed."
OUTSIDE_REFUSAL = "The selected source is outside ComfyUI's input folder."


class Folders:
    """A stand-in for ComfyUI's folder_paths over three chosen folders.

    A name may end in " [input]", " [output]" or " [temp]" to pick the
    folder, as the frontend writes for MaskEditor saves; otherwise it is
    joined onto the input folder the way ComfyUI does, so an absolute name
    stays absolute.
    """

    def __init__(self, input_dir, output_dir, temp_dir):
        self.dirs = {"input": str(input_dir), "output": str(output_dir), "temp": str(temp_dir)}
        self.looked_up = []

    def get_input_directory(self):
        return self.dirs["input"]

    def get_output_directory(self):
        return self.dirs["output"]

    def get_temp_directory(self):
        return self.dirs["temp"]

    def get_annotated_filepath(self, name):
        self.looked_up.append(name)
        base = self.dirs["input"]
        for kind in ("input", "output", "temp"):
            tag = f" [{kind}]"
            if name.endswith(tag):
                name, base = name[: -len(tag)], self.dirs[kind]
        return os.path.join(base, name)


class TempFolders(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.input = self.root / "input"
        self.output = self.root / "output"
        self.temp = self.root / "temp"
        for folder in (self.input, self.output, self.temp, self.input / "sub", self.input / "clipspace"):
            folder.mkdir(parents=True, exist_ok=True)
        self.inside = self.touch(self.input / "pic.png")
        self.nested = self.touch(self.input / "sub" / "pic.png")
        self.masked = self.touch(self.input / "clipspace" / "painted.png")
        self.outside = self.touch(self.root / "secret.png")
        self.in_output = self.touch(self.output / "render.mp4")
        self.folders = Folders(self.input, self.output, self.temp)
        patcher = patch.object(_media_helpers, "folder_paths", self.folders)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def touch(path):
        path.write_bytes(b"x")
        return path


class InputFolderTests(TempFolders):
    def test_files_inside_the_input_folder_resolve(self):
        self.assertEqual(resolve_input_path("pic.png"), self.inside)
        self.assertEqual(resolve_input_path("sub/pic.png"), self.nested)
        # A MaskEditor save names its folder; it is still the input folder.
        self.assertEqual(resolve_input_path("clipspace/painted.png [input]"), self.masked)

    def test_a_path_that_climbs_out_is_refused(self):
        with self.assertRaisesRegex(ValueError, OUTSIDE_REFUSAL):
            resolve_input_path("../secret.png")
        with self.assertRaisesRegex(ValueError, OUTSIDE_REFUSAL):
            resolve_input_path("sub/../../secret.png")

    def test_an_absolute_path_elsewhere_is_refused(self):
        # os.path.join keeps an absolute name as it is, so this is the path
        # a crafted prompt would reach for.
        with self.assertRaisesRegex(ValueError, OUTSIDE_REFUSAL):
            resolve_input_path(str(self.outside))

    def test_a_link_inside_that_points_outside_is_refused(self):
        (self.input / "shortcut.png").symlink_to(self.outside)
        with self.assertRaisesRegex(ValueError, OUTSIDE_REFUSAL):
            resolve_input_path("shortcut.png")

    def test_another_comfy_folder_is_still_outside(self):
        # Core Load Image reads "[output]" names; these loaders read input only.
        with self.assertRaisesRegex(ValueError, OUTSIDE_REFUSAL):
            resolve_input_path("render.mp4 [output]")

    def test_blank_and_missing_names_say_what_to_do(self):
        with self.assertRaisesRegex(ValueError, "Select or upload a source file first."):
            resolve_input_path("")
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            resolve_input_path("gone.png")


class NetworkPathTests(TempFolders):
    NAMES = ("//fileserver/share/pic.png", "\\\\fileserver\\share\\pic.png", "//fileserver/share/pic.png [input]")

    def test_a_network_source_is_refused_before_the_path_is_touched(self):
        resolved = []
        real_resolve = Path.resolve

        def recording_resolve(path, *args, **kwargs):
            resolved.append(str(path))
            return real_resolve(path, *args, **kwargs)

        for name in self.NAMES:
            with self.subTest(name=name), patch.object(Path, "resolve", recording_resolve):
                with self.assertRaisesRegex(ValueError, NETWORK_REFUSAL):
                    resolve_input_path(name)
        self.assertEqual(self.folders.looked_up, [], "the name was looked up before it was refused")
        self.assertEqual(resolved, [], "a network path was resolved before it was refused")

    def test_the_refusal_holds_when_the_input_folder_itself_is_on_a_share(self):
        # Inside the input folder by text, still a network read.
        self.folders.dirs["input"] = "//fileserver/comfy/input"
        with self.assertRaisesRegex(ValueError, NETWORK_REFUSAL):
            resolve_input_path("//fileserver/comfy/input/pic.png")


class LocalPathTests(TempFolders):
    def test_comfy_folders_are_readable_in_place(self):
        self.assertTrue(local_preview_allowed(str(self.in_output)))
        self.assertTrue(local_preview_allowed(f'"{self.inside}"'))
        self.assertEqual(resolve_video_path("local path", "", str(self.in_output)), self.in_output)

    def test_anywhere_else_is_refused(self):
        self.assertFalse(local_preview_allowed(str(self.outside)))
        self.assertFalse(local_preview_allowed(str(self.input / ".." / "secret.png")))
        self.assertFalse(local_preview_allowed(""))
        movie = self.touch(self.root / "movie.mp4")
        with self.assertRaisesRegex(ValueError, "Local path mode reads only videos inside"):
            resolve_video_path("local path", "", str(movie))

    def test_a_network_path_is_refused_from_its_text_alone(self):
        resolved = []
        real_resolve = Path.resolve

        def recording_resolve(path, *args, **kwargs):
            resolved.append(str(path))
            return real_resolve(path, *args, **kwargs)

        with patch.object(Path, "resolve", recording_resolve):
            self.assertFalse(local_preview_allowed("//fileserver/share/clip.mp4"))
            self.assertFalse(local_preview_allowed("\\\\fileserver\\share\\clip.mp4"))
        self.assertFalse([path for path in resolved if "fileserver" in path], resolved)

    def test_a_network_path_is_refused_even_inside_a_comfy_folder_on_a_share(self):
        self.folders.dirs["output"] = "//fileserver/comfy/output"
        self.assertFalse(local_preview_allowed("//fileserver/comfy/output/clip.mp4"))
        with self.assertRaisesRegex(ValueError, "Local path mode reads only videos inside"):
            resolve_video_path("local path", "", "//fileserver/comfy/output/clip.mp4")


@unittest.skipUnless(REAL_MEDIA_STACK, "needs torch, NumPy, Pillow and PyAV (ComfyUI's Python)")
class LoaderValidationTests(TempFolders):
    """The loaders refuse the same paths before a run, with one message each."""

    def test_image_loaders_refuse_paths_outside_the_input_folder(self):
        from nodes import node_image_crop_rotate_pad, node_load_image_pad

        for module, cls, label in (
            (node_image_crop_rotate_pad, node_image_crop_rotate_pad.AusBossImageCropRotatePad, "Image Crop + Rotate + Pad"),
            (node_load_image_pad, node_load_image_pad.AusBossLoadImagePad, "Load Image + Pad"),
        ):
            with self.subTest(node=label):
                self.assertIs(cls.VALIDATE_INPUTS(image="pic.png"), True)
                for name in ("../secret.png", str(self.outside), "//fileserver/share/pic.png"):
                    verdict = cls.VALIDATE_INPUTS(image=name)
                    self.assertIsInstance(verdict, str, name)
                    self.assertTrue(verdict.startswith(f"{label}: "), verdict)

    def test_video_loaders_refuse_paths_outside_comfy_folders(self):
        from nodes import node_load_video, node_video_crop_rotate_pad

        self.touch(self.input / "clip.mp4")
        load = node_load_video.AusBossLoadVideo
        self.assertIs(load.VALIDATE_INPUTS("clip.mp4"), True)
        self.assertIn("outside", load.VALIDATE_INPUTS("../secret.png"))
        frame = node_video_crop_rotate_pad.AusBossVideoCropRotatePad
        self.assertIs(frame.VALIDATE_INPUTS("clip.mp4", "input folder", ""), True)
        self.assertIs(frame.VALIDATE_INPUTS("", "local path", str(self.in_output)), True)
        movie = self.touch(self.root / "movie.mp4")
        self.assertIn("Local path mode reads only", frame.VALIDATE_INPUTS("", "local path", str(movie)))
        self.assertIn("Network", frame.VALIDATE_INPUTS("//fileserver/share/clip.mp4", "input folder", ""))


if __name__ == "__main__":
    unittest.main()
