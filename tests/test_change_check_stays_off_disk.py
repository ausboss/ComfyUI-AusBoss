"""A loader's change check never opens a value it refused.

ComfyUI calls a node's IS_CHANGED with the prompt's widget values before it
runs anything, and /prompt needs no login. The picture and video loaders
first hand the value to their resolver, which takes only a file named below
ComfyUI's input, output or temp folder. When the resolver refuses it, the
value is hashed as text and nothing else: on Windows, merely looking up a
network path ("//host/share/x.png") contacts that host and hands it the
server's login.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._transform_engine import stable_file_fingerprint  # noqa: E402
from nodes.node_image_crop_rotate_pad import AusBossImageCropRotatePad  # noqa: E402
from nodes.node_load_image import AusBossLoadImage  # noqa: E402
from nodes.node_load_image_pad import AusBossLoadImagePad  # noqa: E402
from nodes.node_video_crop_rotate_pad import AusBossVideoCropRotatePad  # noqa: E402
from nodes.node_video_crop_rotate_pad_clip import AusBossVideoCropRotatePadClip  # noqa: E402

REFUSED = [
    "//evil-host/share/photo.png",
    "\\\\evil-host\\share\\photo.png",
    "/evil-host/etc/photo.png",
    "../../evil-host/photo.png",
]


class DiskWatch:
    """Records every stat and resolve of a path that names the evil host."""

    def __init__(self):
        self.touched = []

    def __enter__(self):
        real_stat, real_resolve = os.stat, Path.resolve
        watch = self

        def stat(path, *args, **kwargs):
            if "evil-host" in str(path):
                watch.touched.append(("stat", str(path)))
            return real_stat(path, *args, **kwargs)

        def resolve(self, *args, **kwargs):
            if "evil-host" in str(self):
                watch.touched.append(("resolve", str(self)))
            return real_resolve(self, *args, **kwargs)

        self._patches = [patch("os.stat", stat), patch.object(Path, "resolve", resolve)]
        for item in self._patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in reversed(self._patches):
            item.stop()


class ChangeCheckTests(unittest.TestCase):
    def assert_off_disk(self, call):
        for value in REFUSED:
            with self.subTest(value=value), DiskWatch() as watch:
                first = call(value)
                self.assertEqual(watch.touched, [])
            # The text still counts: another refused value is another key.
            self.assertNotEqual(first, call(value + "x"))

    def test_picture_loaders(self):
        for node in (AusBossLoadImage, AusBossLoadImagePad, AusBossImageCropRotatePad):
            with self.subTest(node=node.__name__):
                self.assert_off_disk(lambda value, node=node: node.IS_CHANGED(image=value))

    def test_video_crop_nodes(self):
        for node in (AusBossVideoCropRotatePad, AusBossVideoCropRotatePadClip):
            for mode in ("input folder", "local path"):
                with self.subTest(node=node.__name__, mode=mode):
                    self.assert_off_disk(
                        lambda value, node=node, mode=mode: node.IS_CHANGED(
                            video=value if mode == "input folder" else "",
                            source_mode=mode,
                            local_path=value if mode == "local path" else "",
                            seek_mode="frame index",
                            frame_index=0,
                            frame_time=0.0,
                            **({"start_seconds": 0.0, "end_seconds": 0.0} if node is AusBossVideoCropRotatePadClip else {}),
                        )
                    )

    def test_the_fingerprint_opens_only_a_resolved_path(self):
        with DiskWatch() as watch:
            stable_file_fingerprint("//evil-host/share/photo.png", {})
            stable_file_fingerprint(None, {})
        self.assertEqual(watch.touched, [])


if __name__ == "__main__":
    unittest.main()
