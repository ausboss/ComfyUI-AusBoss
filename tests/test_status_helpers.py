"""Offline tests for the live node-status push.

The real websocket delivery needs a running PromptServer and is exercised in
the browser acceptance pass; what matters here is that no failure mode of
the send ever escapes into the node that reported the status.
"""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._status_helpers import EVENT_NAME, push_node_status


class FakePromptServer:
    def __init__(self, instance):
        self.instance = instance


class RecordingServer:
    def __init__(self):
        self.sent = []

    def send_sync(self, event, payload):
        self.sent.append((event, payload))


class ExplodingServer:
    def send_sync(self, event, payload):
        raise RuntimeError("socket closed")


class StatusPushTests(unittest.TestCase):
    def install_server(self, instance):
        """Stand in for ComfyUI's `server` module for one test."""
        module = types.ModuleType("server")
        module.PromptServer = FakePromptServer(instance)
        previous = sys.modules.get("server")
        sys.modules["server"] = module
        self.addCleanup(
            lambda: sys.modules.__setitem__("server", previous)
            if previous is not None
            else sys.modules.pop("server", None)
        )

    def test_payload_carries_the_node_id_text_and_clamped_progress(self):
        server = RecordingServer()
        self.install_server(server)
        push_node_status(7, "frame 2/9", 0.25)
        push_node_status("7", "frame 9/9", 4.0)
        self.assertEqual(
            server.sent,
            [
                (EVENT_NAME, {"node_id": "7", "text": "frame 2/9", "progress": 0.25}),
                (EVENT_NAME, {"node_id": "7", "text": "frame 9/9", "progress": 1.0}),
            ],
        )

    def test_unusable_progress_is_reported_as_none(self):
        server = RecordingServer()
        self.install_server(server)
        for progress in (None, "soon", float("nan"), float("inf")):
            with self.subTest(progress=progress):
                server.sent.clear()
                push_node_status(1, "working", progress)
                self.assertIsNone(server.sent[0][1]["progress"])

    def test_a_failing_send_never_reaches_the_caller(self):
        self.install_server(ExplodingServer())
        push_node_status(1, "working", 0.5)

    def test_no_server_instance_and_no_node_id_are_silent_no_ops(self):
        self.install_server(None)
        push_node_status(1, "working", 0.5)
        server = RecordingServer()
        self.install_server(server)
        push_node_status(None, "working", 0.5)
        self.assertEqual(server.sent, [])

    def test_missing_comfyui_server_module_is_a_silent_no_op(self):
        previous = sys.modules.get("server")
        sys.modules["server"] = None  # import server -> ImportError
        self.addCleanup(
            lambda: sys.modules.__setitem__("server", previous)
            if previous is not None
            else sys.modules.pop("server", None)
        )
        push_node_status(1, "working", 0.5)


if __name__ == "__main__":
    unittest.main()
