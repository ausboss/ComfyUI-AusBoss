"""ComfyUI runs a node again only when one of its inputs changes. The saved
workflow that rides along with a run (EXTRA_PNGINFO) is not one of them, so a
node that took a setting from it would hand back an old result after that
setting changed: Pause for Shot once read the viewer's 360 Turn that way. Only
the save nodes read it, to write it into the files they save."""

from __future__ import annotations

from pathlib import Path
import unittest

NODES = Path(__file__).resolve().parent.parent / "nodes"
# Embedding the workflow in a saved file, as ComfyUI's own Save Image does.
READ_TO_EMBED = {"node_save_image.py", "node_save_video.py"}


class WorkflowIsNotAnInputTests(unittest.TestCase):
    def test_only_save_nodes_read_the_saved_workflow(self):
        readers = sorted(path.name for path in NODES.glob("*.py") if "EXTRA_PNGINFO" in path.read_text(encoding="utf-8"))
        self.assertEqual([name for name in readers if name not in READ_TO_EMBED], [],
                         "A setting a node's result depends on must be one of its inputs, "
                         "not read from the saved workflow: ComfyUI would not run the node again when it changes.")


if __name__ == "__main__":
    unittest.main()
