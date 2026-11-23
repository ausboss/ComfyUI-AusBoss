"""Pause for Shot carries its viewer's model to every open page."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_pause_shot as ps

MESH = {"result": ["preview3d_advanced_abc.glb [temp]", {"fov": 35}, []]}


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


class PanoramaOffTests(unittest.TestCase):
    def test_taken_out_360_is_kept_in_the_answer(self):
        self.assertIs(ps.clean_shot({"panorama": False}).get("panorama"), False)
        self.assertNotIn("panorama", ps.clean_shot({"panorama": "yes"}))
        self.assertNotIn("panorama", ps.clean_shot({}))


if __name__ == "__main__":
    unittest.main()
