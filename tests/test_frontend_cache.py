from __future__ import annotations

import asyncio
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._frontend_cache import (
    _MODULE_IMPORT,
    add_module_version,
    compute_module_token,
    is_pack_module_path,
    list_pack_modules,
    make_revalidate_middleware,
)


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


class ModuleVersionTests(unittest.TestCase):
    def test_every_kind_of_relative_import_gets_the_tag(self):
        source = (
            'import { a } from "../shared/index.mjs";\n'
            "import {b} from './b.mjs';\n"
            'export * from "./c.mjs";\n'
            'export { d } from "../shared/d.mjs";\n'
            'import "./side.mjs";\n'
            'const e = await import("../shared/e.mjs");\n'
        )
        tagged = add_module_version(source, "t0")
        self.assertEqual(
            tagged,
            'import { a } from "../shared/index.mjs?v=t0";\n'
            "import {b} from './b.mjs?v=t0';\n"
            'export * from "./c.mjs?v=t0";\n'
            'export { d } from "../shared/d.mjs?v=t0";\n'
            'import "./side.mjs?v=t0";\n'
            'const e = await import("../shared/e.mjs?v=t0");\n',
        )

    def test_everything_else_is_left_alone(self):
        source = (
            'import { app } from "/scripts/app.js";\n'
            'import { x } from "./plain.js";\n'
            'import { y } from "./old.mjs?v=1";\n'
            'import { z } from "https://example.com/z.mjs";\n'
            'const url = base + "../shared/index.mjs";\n'
        )
        self.assertEqual(add_module_version(source, "t0"), source)

    def test_tagging_twice_changes_nothing_more(self):
        once = add_module_version('import { a } from "./a.mjs";', "t0")
        self.assertEqual(add_module_version(once, "t0"), once)

    def test_the_tag_follows_the_scripts(self):
        with tempfile.TemporaryDirectory() as folder:
            js = Path(folder)
            (js / "a.mjs").write_text("export const a = 1;")
            (js / "readme.md").write_text("one")
            first = compute_module_token(js)
            self.assertEqual(compute_module_token(js), first)
            (js / "readme.md").write_text("two")
            self.assertEqual(compute_module_token(js), first)
            (js / "a.mjs").write_text("export const a = 2;")
            self.assertNotEqual(compute_module_token(js), first)

    def test_real_pack_scripts_refer_to_modules_only_in_ways_the_server_tags(self):
        # A script that names a .mjs some other way (built from pieces,
        # new URL(...)) would load a second, untagged copy of it.
        quoted = re.compile(r"""["'][^"'\n]*\.mjs["']""")
        loose = []
        for path in sorted((ROOT / "js").rglob("*")):
            if path.suffix not in (".js", ".mjs") or not path.is_file():
                continue
            source = path.read_text(encoding="utf-8")
            if len(quoted.findall(source)) != len(_MODULE_IMPORT.findall(source)):
                loose.append(path.relative_to(ROOT).as_posix())
            tagged = add_module_version(source, "t0")
            if re.search(r"""\bfrom\s*["']\.{1,2}/[^"']+\.mjs["']""", tagged):
                loose.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(loose, [])


class VersionedServingTests(unittest.TestCase):
    def setUp(self):
        try:
            from aiohttp import web
            from aiohttp.test_utils import TestClient, TestServer
        except ImportError:
            self.skipTest("aiohttp is not installed")
        self.web, self.TestClient, self.TestServer = web, TestClient, TestServer
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        base = Path(self.folder.name)
        self.js = base / "js"
        (self.js / "shared").mkdir(parents=True)
        (self.js / "seed").mkdir()
        (self.js / "shared" / "a.mjs").write_text("export const a = 1;")
        (self.js / "shared" / "b.mjs").write_text('import { a } from "./a.mjs"; export const b = a;')
        (self.js / "seed" / "index.js").write_text('import { b } from "../shared/b.mjs";')
        (self.js / "seed" / "plain.js").write_text("console.log(1);")
        (base / "secret.mjs").write_text('import "./a.mjs";')

    def fetch(self, paths, token="tok", headers=None, js_root="default", setup=None):
        web = self.web

        async def handled(request):
            return web.Response(text="from the handler", content_type="text/javascript")

        async def run():
            root = self.js if js_root == "default" else js_root
            app = web.Application(middlewares=[make_revalidate_middleware("ausboss-nodes", root, token)])
            app.router.add_get("/extensions/{tail:.*}", handled)
            async with self.TestClient(self.TestServer(app)) as client:
                out = {}
                for path in paths:
                    response = await client.get(path, headers=headers)
                    out[path] = (response.status, await response.text(), response.headers)
                return out

        return asyncio.run(run())

    def test_module_with_imports_is_served_tagged_and_revalidated(self):
        path = "/extensions/ausboss-nodes/shared/b.mjs"
        status, body, headers = self.fetch([path])[path]
        self.assertEqual(status, 200)
        self.assertIn('"./a.mjs?v=tok"', body)
        self.assertEqual(headers["Cache-Control"], "no-cache")
        self.assertIn("javascript", headers["Content-Type"])
        etag = headers["ETag"]
        again = self.fetch([path], headers={"If-None-Match": etag})[path]
        self.assertEqual(again[0], 304)
        self.assertEqual(again[2]["Cache-Control"], "no-cache")

    def test_entry_script_is_served_tagged_and_never_stored(self):
        path = "/extensions/ausboss-nodes/seed/index.js"
        status, body, headers = self.fetch([path])[path]
        self.assertEqual(status, 200)
        self.assertIn('"../shared/b.mjs?v=tok"', body)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_files_with_nothing_to_tag_go_to_the_normal_server(self):
        seen = self.fetch(["/extensions/ausboss-nodes/shared/a.mjs", "/extensions/ausboss-nodes/seed/plain.js"])
        self.assertEqual(seen["/extensions/ausboss-nodes/shared/a.mjs"][1], "from the handler")
        self.assertEqual(seen["/extensions/ausboss-nodes/shared/a.mjs"][2]["Cache-Control"], "no-cache")
        self.assertEqual(seen["/extensions/ausboss-nodes/seed/plain.js"][1], "from the handler")

    def test_other_packs_and_missing_files_are_not_touched(self):
        seen = self.fetch(
            ["/extensions/other-pack/shared/b.mjs", "/extensions/ausboss-nodes/shared/missing.mjs"]
        )
        self.assertEqual(seen["/extensions/other-pack/shared/b.mjs"][1], "from the handler")
        self.assertNotIn("Cache-Control", seen["/extensions/other-pack/shared/b.mjs"][2])
        self.assertEqual(seen["/extensions/ausboss-nodes/shared/missing.mjs"][1], "from the handler")

    def test_nothing_outside_the_js_folder_is_read(self):
        outside = "/extensions/ausboss-nodes/%2e%2e/secret.mjs"
        link = self.js / "shared" / "link.mjs"
        try:
            os.symlink(Path(self.folder.name) / "secret.mjs", link)
        except (OSError, NotImplementedError):
            link = None
        paths = [outside] + (["/extensions/ausboss-nodes/shared/link.mjs"] if link else [])
        for path, (_status, body, _headers) in self.fetch(paths).items():
            self.assertNotIn("?v=tok", body, path)

    def test_without_a_tag_the_files_are_served_as_before(self):
        path = "/extensions/ausboss-nodes/shared/b.mjs"
        status, body, headers = self.fetch([path], token=None)[path]
        self.assertEqual(body, "from the handler")
        self.assertEqual(headers["Cache-Control"], "no-cache")


if __name__ == "__main__":
    unittest.main()
