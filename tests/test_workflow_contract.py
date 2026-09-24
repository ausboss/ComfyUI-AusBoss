"""Catch saved graphs that parse successfully but fail to load or read cleanly."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from workflow_contract import workflow_problems, example_problems


def good_graph():
    return {
        "last_node_id": 3, "last_link_id": 1,
        "nodes": [
            {"id": 1, "type": "Source", "pos": [0, 100], "size": [100, 80], "outputs": [{"links": [1]}]},
            {"id": 2, "type": "Target", "pos": [180, 100], "size": [100, 80], "inputs": [{"link": 1}]},
            {"id": 3, "type": "AUSBOSS_NODES_WorkflowNote", "pos": [-200, 100], "size": [100, 80],
             "widgets_values": ['{"title":"Example","body":"Choose a source and queue."}']},
        ],
        "links": [[1, 1, 0, 2, 0, "IMAGE"]],
        "groups": [{"bounding": [-20, 40, 320, 160]}],
    }


class WorkflowContractTests(unittest.TestCase):
    def test_complete_graph(self):
        self.assertEqual(workflow_problems(good_graph()), [])

    def test_named_widget_copy_must_match_the_loaded_values(self):
        graph = good_graph()
        graph["nodes"][0]["widgets_values"] = [7, "fixed", ""]
        graph["nodes"][0]["widgets_values_named"] = {"seed": 7, "control_after_generate": "fixed", "ausboss_seed_panel": ""}
        self.assertEqual(workflow_problems(graph), [])
        graph["nodes"][0]["widgets_values_named"]["control_after_generate"] = "randomize"
        self.assertIn("stale named widget values: control_after_generate", " ".join(workflow_problems(graph)))
        graph = good_graph()
        graph["nodes"][0]["widgets_values"] = {"video": "sample.mp4", "start_seconds": 0}
        graph["nodes"][0]["widgets_values_named"] = {"video": "someone_else.mp4", "start_seconds": 0, "upload": ""}
        self.assertIn("stale named widget values: video", " ".join(workflow_problems(graph)))

    def test_workflow_id_and_zoom(self):
        graph = good_graph()
        graph["id"] = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"
        graph["extra"] = {"ds": {"scale": 0.6, "offset": [0, 0]}}
        self.assertEqual(workflow_problems(graph), [])
        for bad in ("", "ausboss-showcase", "00000000-0000-0000-0000-000000000000"):
            graph["id"] = bad
            self.assertIn("workflow id", " ".join(workflow_problems(graph)))
        graph["id"] = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"
        graph["extra"]["ds"]["scale"] = 0.45
        self.assertIn("saved zoom", " ".join(workflow_problems(graph)))

    def test_download_info_and_save_prefix(self):
        graph = good_graph()
        graph["nodes"][0]["widgets_values"] = ["model.safetensors", "default"]
        graph["nodes"][0]["properties"] = {"models": [{"name": "model.safetensors", "url": "https://example.invalid/model.safetensors", "directory": "vae"}]}
        self.assertEqual(workflow_problems(graph), [])
        graph["nodes"][0]["properties"]["models"][0]["name"] = "other.safetensors"
        self.assertIn("does not select", " ".join(workflow_problems(graph)))
        graph = good_graph()
        graph["nodes"][1]["type"] = "AUSBOSS_NODES_SaveImage"
        graph["nodes"][1]["widgets_values"] = ["AusBoss/image", "png"]
        self.assertIn("saves into a folder", " ".join(workflow_problems(graph)))
        graph["nodes"][1]["widgets_values"] = ["image", "png"]
        self.assertEqual(workflow_problems(graph), [])

    def test_link_must_agree_in_all_three_places(self):
        graph = good_graph()
        graph["nodes"][1]["inputs"][0]["link"] = 99
        self.assertIn("target input", " ".join(workflow_problems(graph)))
        self.assertIn("stale link", " ".join(workflow_problems(graph)))
        graph = good_graph()
        graph["nodes"][0]["outputs"][0]["links"] = []
        self.assertIn("source output", " ".join(workflow_problems(graph)))

    def test_missing_nodes_and_stale_counters(self):
        graph = good_graph()
        graph["links"][0][1] = 99
        graph["last_link_id"] = 0
        problems = " ".join(workflow_problems(graph))
        self.assertIn("missing node", problems)
        self.assertIn("last_link_id", problems)

    def test_title_bars_count_as_overlap(self):
        graph = good_graph()
        graph["nodes"][1]["pos"] = [0, 195]  # Body clears; title collides.
        self.assertIn("overlap", " ".join(workflow_problems(graph)))

    def test_notes_and_group_containment(self):
        graph = good_graph()
        graph["nodes"][2]["widgets_values"] = ['{"title":"Example","body":"one\\\\ntwo"}']
        graph["nodes"][1]["pos"] = [500, 100]
        problems = " ".join(workflow_problems(graph))
        self.assertIn("escaped line breaks", problems)
        self.assertIn("outside its stage", problems)

    def test_all_shipped_examples(self):
        self.assertEqual(example_problems(ROOT / "example_workflows"), [])


if __name__ == "__main__":
    unittest.main()
