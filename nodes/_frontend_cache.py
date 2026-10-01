"""Keep the browser from running old AusBoss JavaScript after an update.

ComfyUI tells browsers never to store .js files, but sends no cache header
for .mjs, so a browser may reuse an old copy for days. After an update the
new entry scripts then import functions the old copies do not have, and part
of the pack stops loading. Firefox can keep such a copy even through
Ctrl+Shift+R. Three small pieces fix that:

- every relative .mjs import in the pack's scripts is served with a version
  tag (shared/index.mjs becomes shared/index.mjs?v=<tag>). The tag changes
  whenever any script changes, so after an update the browser asks for
  addresses it has never stored, whatever it kept from before. The files on
  disk are not touched;
- every .mjs of this pack is served with Cache-Control: no-cache, so the
  browser asks the server before reusing it (a quick "not modified" when
  nothing changed);
- /ausboss/pack_modules lists those files, so a tab that is already running
  old copies (js/cache_guard/index.js) can refresh them in one go.
"""

import hashlib
import re
from pathlib import Path

PACK_DIR = Path(__file__).parent.parent
_registered = False

# `from "./x.mjs"`, `import "./x.mjs"` and `import("./x.mjs")`; the pack's own
# files only (a relative path), and only plain string literals.
# tests/test_frontend_cache.py fails if a script refers to a .mjs another way.
_MODULE_IMPORT = re.compile(r"""(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}/[^"'?\s]+\.mjs)\2""")


def list_pack_modules(pack_dir=PACK_DIR):
    """Paths of the pack's .mjs files, relative to its js folder, with '/'."""
    root = Path(pack_dir) / "js"
    if not root.is_dir():
        return []
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*.mjs"))


def is_pack_module_path(request_path, pack_name):
    """True for /extensions/<pack_name>/.../*.mjs."""
    return request_path.startswith(f"/extensions/{pack_name}/") and request_path.endswith(".mjs")


def compute_module_token(js_root):
    """Short tag that changes whenever any script in the js folder does."""
    root = Path(js_root)
    digest = hashlib.sha1()
    for path in sorted(root.rglob("*")):
        if path.suffix in (".js", ".mjs") and path.is_file():
            digest.update(path.relative_to(root).as_posix().encode("utf-8") + b"\0")
            digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()[:10]


def add_module_version(source, token):
    """The script with ?v=<token> on every relative .mjs import in it."""
    return _MODULE_IMPORT.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={token}{m.group(2)}", source)


def make_revalidate_middleware(pack_name, js_root=None, token=None):
    """aiohttp middleware for this pack's scripts, nothing else touched.

    Always: no-cache on the .mjs. With `js_root` and `token`: scripts that
    import another .mjs are served with the version tag on those imports.
    """
    from aiohttp import web

    marker = f"/extensions/{pack_name}/"
    root = Path(js_root).resolve() if js_root and token else None
    served = {}

    def versioned(path):
        """(body, etag) for a script with imports to tag, else None."""
        stat = path.stat()
        stamp = (stat.st_mtime_ns, stat.st_size)
        hit = served.get(path)
        if hit and hit[0] == stamp:
            return hit[1]
        source = path.read_text(encoding="utf-8")
        tagged = add_module_version(source, token)
        result = None
        if tagged != source:
            body = tagged.encode("utf-8")
            result = (body, '"' + hashlib.sha1(body).hexdigest()[:20] + '"')
        served[path] = (stamp, result)
        return result

    def tagged_response(request):
        """The tagged script for this request, or None to let ComfyUI serve it."""
        if root is None or request.method not in ("GET", "HEAD"):
            return None
        start = request.path.find(marker)
        if start < 0 or not request.path.endswith((".js", ".mjs")):
            return None
        try:
            target = (root / request.path[start + len(marker):]).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                return None
            found = versioned(target)
        except (OSError, ValueError, UnicodeDecodeError):
            return None
        if found is None:
            return None
        body, etag = found
        if target.suffix == ".js":
            return web.Response(body=body, content_type="text/javascript", headers={"Cache-Control": "no-store"})
        headers = {"Cache-Control": "no-cache", "ETag": etag}
        if request.headers.get("If-None-Match") == etag:
            return web.Response(status=304, headers=headers)
        return web.Response(body=body, content_type="text/javascript", headers=headers)

    @web.middleware
    async def revalidate_pack_modules(request, handler):
        response = tagged_response(request)
        if response is not None:
            return response
        response = await handler(request)
        if is_pack_module_path(request.path, pack_name):
            response.headers["Cache-Control"] = "no-cache"
        return response

    return revalidate_pack_modules


def register_frontend_cache_guard():
    """Add the version tags, the no-cache header and the module list. Fail-soft, run once."""
    global _registered
    if _registered:
        return
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None:
        return
    _registered = True
    try:
        js_root = PACK_DIR / "js"
        try:
            token = compute_module_token(js_root)
        except OSError:
            token = None
        prompt_server.app.middlewares.append(make_revalidate_middleware(PACK_DIR.name, js_root, token))
    except Exception:
        pass

    @prompt_server.routes.get("/ausboss/pack_modules")
    async def ausboss_pack_modules(request):
        return web.json_response({"modules": list_pack_modules()})
