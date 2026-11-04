"""Exercise preview handlers offline, with decoding replaced by small fakes."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _media_helpers as media


class QueryNumberTests(unittest.TestCase):
    def test_missing_and_malformed_values_use_the_default(self):
        for parser, default in ((media._query_int, 17), (media._query_float, 2.5)):
            for query in ({}, {"value": ""}, {"value": "words"}, {"value": None}):
                with self.subTest(parser=parser.__name__, query=query):
                    self.assertEqual(parser(types.SimpleNamespace(query=query), "value", default), default)

    def test_non_finite_numbers_use_the_default(self):
        for parser, default in ((media._query_int, 17), (media._query_float, 2.5)):
            for value in ("nan", "NaN", "inf", "-inf", "1e999"):
                with self.subTest(parser=parser.__name__, value=value):
                    request = types.SimpleNamespace(query={"value": value})
                    self.assertEqual(parser(request, "value", default), default)

    def test_finite_decimal_and_exponent_values_keep_existing_conversion(self):
        request = types.SimpleNamespace(query={"value": " -1.25e1 "})
        self.assertEqual(media._query_int(request, "value", 0), -12)
        self.assertEqual(media._query_float(request, "value", 0.0), -12.5)


class VideoRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Keep the worker boundary awaitable without starting decoder threads.
        async def run_worker(executor, function, *args):
            return function(*args)

        patcher = patch.object(asyncio.get_running_loop(), "run_in_executor", run_worker)
        patcher.start()
        self.addCleanup(patcher.stop)

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.dirs = {kind: self.root / kind for kind in ("input", "output", "temp")}
        for root in self.dirs.values():
            root.mkdir()
            (root / "clip.mp4").write_bytes(b"placeholder")
        folders = types.SimpleNamespace(**{
            f"get_{kind}_directory": lambda root=root: str(root)
            for kind, root in self.dirs.items()
        })
        patcher = patch.object(media, "folder_paths", folders)
        patcher.start()
        self.addCleanup(patcher.stop)

        # Only collect route decorators; no server or listener is started.
        instance = types.SimpleNamespace(routes=web.RouteTableDef())
        server = types.ModuleType("server")
        server.PromptServer = types.SimpleNamespace(instance=instance)
        with patch.dict(sys.modules, {"server": server}):
            media.register_video_routes()
        self.handlers = {route.path: route.handler for route in instance.routes}

    async def call(self, endpoint, **query):
        request = types.SimpleNamespace(query=query)
        return await self.handlers[f"/ausboss/transform/video/{endpoint}"](request)

    async def test_annotated_names_select_each_allowed_root(self):
        for kind, root in self.dirs.items():
            with self.subTest(folder=kind):
                with patch.object(media, "cached_video_metadata", return_value={"fps": 24}) as worker:
                    response = await self.call("metadata", video=f"clip.mp4 [{kind}]")
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.text), {"fps": 24})
                    worker.assert_called_once_with(root / "clip.mp4")

    async def test_invalid_sources_never_reach_preview_workers(self):
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"keep")
        (self.dirs["input"] / "escape.mp4").symlink_to(outside)
        sources = (
            {"video": "../outside.mp4"},
            {"video": str(outside)},
            {"video": "escape.mp4"},
            {"source_mode": "local path", "local_path": "../outside.mp4 [output]"},
            {"source_mode": "unexpected", "video": "clip.mp4"},
        )
        for endpoint, name in (("metadata", "cached_video_metadata"),
                               ("frame", "cached_preview"), ("storyboard", "storyboard_payload")):
            for query in sources:
                with self.subTest(endpoint=endpoint, query=query):
                    with patch.object(media, name) as worker:
                        response = await self.call(endpoint, **query)
                        self.assertEqual(response.status, 400)
                        self.assertIn("error", json.loads(response.text))
                        self.assertNotIn(str(self.root), response.text)
                        worker.assert_not_called()

    async def test_non_finite_frame_parameters_are_normalized_before_decoding(self):
        with patch.object(media, "cached_preview", return_value=(b"jpeg", 0, 0.0)) as worker:
            response = await self.call(
                "frame", video="clip.mp4", frame_index="inf", frame_time="nan",
                max_width="1e999", max_height="-inf",
            )
            self.assertEqual(response.status, 200, response.text)
            worker.assert_called_once_with(
                self.dirs["input"] / "clip.mp4", "frame index", 0, 0.0, 1600, 1600
            )
            self.assertEqual(response.body, b"jpeg")

    async def test_decoder_errors_do_not_reveal_server_paths(self):
        for endpoint, name in (("metadata", "cached_video_metadata"),
                               ("frame", "cached_preview"), ("storyboard", "storyboard_payload")):
            with self.subTest(endpoint=endpoint):
                error = ValueError(f"Cannot decode '{self.dirs['input'] / 'clip.mp4'}'")
                with patch.object(media, name, side_effect=error):
                    response = await self.call(endpoint, video="clip.mp4")
                    self.assertEqual(response.status, 400)
                    self.assertEqual(json.loads(response.text), {"error": "The media request failed."})


if __name__ == "__main__":
    unittest.main()
