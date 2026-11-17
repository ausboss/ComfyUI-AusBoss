"""Every video list a node offers from the input folder takes uploads.

The flag (`video_upload`) is what gives the field an Upload button in
ComfyUI's App mode and in Nodes 2.0. Without it the clip field in an App
mode form was a bare list with nothing to upload a clip with. Read from the
source, so ComfyUI does not have to be importable.
"""
from __future__ import annotations

import ast
from pathlib import Path
import unittest

NODES = Path(__file__).resolve().parent.parent / "nodes"


def video_lists():
    for path in sorted(NODES.glob("node_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Tuple) or not node.elts:
                continue
            first = node.elts[0]
            if isinstance(first, ast.Call) and getattr(first.func, "id", "") == "list_input_videos":
                options = node.elts[1] if len(node.elts) > 1 and isinstance(node.elts[1], ast.Dict) else None
                flags = {}
                if options is not None:
                    for key, value in zip(options.keys, options.values):
                        if isinstance(key, ast.Constant) and isinstance(value, ast.Constant):
                            flags[key.value] = value.value
                yield path.name, node.lineno, flags


class VideoUploadFlag(unittest.TestCase):
    def test_every_input_video_list_takes_uploads(self):
        found = list(video_lists())
        self.assertGreaterEqual(len(found), 3, "expected Load Video and both video crop nodes")
        missing = [f"{name}:{line}" for name, line, flags in found if flags.get("video_upload") is not True]
        self.assertEqual(missing, [], "video lists without video_upload: True")


if __name__ == "__main__":
    unittest.main()
