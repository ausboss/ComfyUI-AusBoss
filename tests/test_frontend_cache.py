from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._frontend_cache import is_pack_module_path, list_pack_modules, make_revalidate_middleware


class PackModuleListTests(unittest.TestCase):
    def test_lists_only_mjs_files_relative_to_js(self):
        with tempfile.TemporaryDirectory() as folder:
            js = Path(folder) / "js"
            (js / "shared").mkdir(parents=True)
            (js / "seed").mkdir()
            (js / "shared" / "index.mjs").write_text("")
            (js / "shared" / "notes.md").write_text("")
            (js / "seed" / "index.js").write_text("")
            self.assertEqual(list_pack_modules(folder), ["shared/index.mjs"])

    def test_missing_js_folder_gives_empty_list(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(list_pack_modules(folder), [])

    def test_real_pack_lists_the_shared_index(self):
        self.assertIn("shared/index.mjs", list_pack_modules())

    def test_path_check_matches_only_this_packs_mjs(self):
        self.assertTrue(is_pack_module_path("/extensions/ausboss-nodes/shared/index.mjs", "ausboss-nodes"))
        self.assertFalse(is_pack_module_path("/extensions/ausboss-nodes/seed/index.js", "ausboss-nodes"))
        self.assertFalse(is_pack_module_path("/extensions/other-pack/shared/index.mjs", "ausboss-nodes"))
        self.assertFalse(is_pack_module_path("/extensions/ausboss-nodes-extra/a.mjs", "ausboss-nodes"))


class MiddlewareTests(unittest.TestCase):
    def test_header_is_set_on_pack_modules_only(self):
        try:
            from aiohttp import web
            from aiohttp.test_utils import TestClient, TestServer
        except ImportError:
            self.skipTest("aiohttp is not installed")

        async def modules_get(request):
            return web.Response(text="export const a = 1;", content_type="text/javascript")

        async def run():
            app = web.Application(middlewares=[make_revalidate_middleware("ausboss-nodes")])
            app.router.add_get("/extensions/ausboss-nodes/shared/index.mjs", modules_get)
            app.router.add_get("/extensions/ausboss-nodes/seed/index.js", modules_get)
            app.router.add_get("/extensions/other-pack/shared/index.mjs", modules_get)
            async with TestClient(TestServer(app)) as client:
                seen = {}
                for path in (
                    "/extensions/ausboss-nodes/shared/index.mjs",
                    "/extensions/ausboss-nodes/seed/index.js",
                    "/extensions/other-pack/shared/index.mjs",
                ):
                    response = await client.get(path)
                    seen[path] = response.headers.get("Cache-Control")
                return seen

        seen = asyncio.run(run())
        self.assertEqual(seen["/extensions/ausboss-nodes/shared/index.mjs"], "no-cache")
        self.assertIsNone(seen["/extensions/ausboss-nodes/seed/index.js"])
        self.assertIsNone(seen["/extensions/other-pack/shared/index.mjs"])


if __name__ == "__main__":
    unittest.main()
