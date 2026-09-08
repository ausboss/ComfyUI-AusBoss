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
