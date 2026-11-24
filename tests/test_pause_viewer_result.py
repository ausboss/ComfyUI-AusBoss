"""Pause for Shot carries its viewer's model to every open page."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_pause_shot as ps

MESH = {"result": ["preview3d_advanced_abc.glb [temp]", {"fov": 35}, []]}
# ComfyUI since its "standard 3d output item" change: Preview 3D (Advanced)
# names its model in a "3d" list instead of "result".
MESH_3D = {"3d": [{"filename": "preview3d_advanced_abc.glb", "subfolder": "", "type": "temp"}],
           "camera_info": [{"fov": 35}], "model_3d_info": []}


class FakeServer:
    def __init__(self):
        self.sent = []

    def send_sync(self, event, data, sid=None):
        self.sent.append((event, data, sid))


class ViewerResultTests(unittest.TestCase):
    def setUp(self):
        ps._viewer_results.clear()

    def test_only_3d_results_are_kept(self):
        self.assertTrue(ps.model_result(MESH))
        self.assertTrue(ps.model_result(MESH_3D))
        self.assertFalse(ps.model_result({"3d": [{"filename": "a.png", "subfolder": "", "type": "temp"}]}))
        self.assertFalse(ps.model_result({"3d": []}))
        self.assertFalse(ps.model_result({"images": [{"filename": "a.png"}]}))
        self.assertFalse(ps.model_result({"result": ["notes.txt"]}))
        self.assertFalse(ps.model_result(None))

    def test_watch_keeps_the_viewer_result_and_still_sends(self):
        server = FakeServer()
        ps._watch_results(server)
        ps._watch_results(server)  # once only
        server.send_sync("executed", {"node": "30", "display_node": "30", "output": MESH, "prompt_id": "p"}, "client-a")
        server.send_sync("executed", {"node": "32", "output": {"images": []}}, "client-a")
        self.assertEqual(ps._viewer_results, {"30": MESH})
        self.assertEqual([s[2] for s in server.sent], ["client-a", "client-a"])

    def test_viewer_is_the_node_wired_into_model_3d_info(self):
        prompt = {"50": {"inputs": {"model_3d_info": ["30", 1]}}}
        self.assertEqual(ps.viewer_of(prompt, "50"), "30")
        self.assertIsNone(ps.viewer_of(prompt, "51"))
        self.assertIsNone(ps.viewer_of(None, "50"))

    def test_the_newer_3d_output_is_kept_too(self):
        server = FakeServer()
        ps._watch_results(server)
        server.send_sync("executed", {"node": "30", "display_node": "30", "output": MESH_3D, "prompt_id": "p"}, "client-a")
        self.assertEqual(ps._viewer_results, {"30": MESH_3D})


class PanoramaOffTests(unittest.TestCase):
    def test_taken_out_360_is_kept_in_the_answer(self):
        self.assertIs(ps.clean_shot({"panorama": False}).get("panorama"), False)
        self.assertNotIn("panorama", ps.clean_shot({"panorama": "yes"}))
        self.assertNotIn("panorama", ps.clean_shot({}))


class ViewInputTests(unittest.TestCase):
    """A run that goes straight through has no Continue answer, so the 360's
    Turn and the Cut come from the hidden `view` input, which the page fills
    from the viewer as Run is pressed. An input, so that ComfyUI runs the
    node again when one of them changes."""

    def test_settings_are_read_from_the_input(self):
        view = json.dumps({"sky": {"turn": 90, "tilt": 2}, "cut": {"back": 0.3}, "panorama": False})
        found = ps.view_settings(view)
        self.assertEqual(found["sky"], {"turn": 90, "tilt": 2})
        self.assertIn("cut", found)
        self.assertNotIn("panorama", found)

    def test_empty_or_junk_gives_nothing(self):
        for junk in ("", "   ", "{", "[1, 2]", '"text"', "x" * (ps.MAX_VIEW + 1), None, 3):
            self.assertEqual(ps.view_settings(junk), {})

    def test_the_input_changes_the_backdrop(self):
        import torch

        node = ps.AusBossPauseShot()
        pano = torch.zeros((1, 32, 64, 3))
        pano[:, :, :32, 0] = 1.0  # one half red, the other black
        camera = {"position": {"x": 0, "y": 0, "z": 2}, "target": {"x": 0, "y": 0, "z": 0}, "fov": 50}

        def backdrop(view):
            return node.wait([], camera, 32, 32, False, panorama=pano, view=view)[4]

        still = backdrop("")
        turned = backdrop(json.dumps({"sky": {"turn": 90}}))
        self.assertGreater(float((still - turned).abs().max()), 0.5)
        self.assertTrue(torch.equal(still, backdrop(json.dumps({"sky": {"turn": 0}}))))

    def test_the_saved_workflow_is_not_read(self):
        # Everything the result depends on is an input ComfyUI compares.
        self.assertNotIn("extra_pnginfo", ps.AusBossPauseShot.INPUT_TYPES()["hidden"])


if __name__ == "__main__":
    unittest.main()
