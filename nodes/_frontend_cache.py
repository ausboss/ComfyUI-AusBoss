"""Keep the browser from running old AusBoss JavaScript after an update.

ComfyUI tells browsers never to store .js files, but sends no cache header
for .mjs, so a browser may reuse an old copy for hours. After an update the
new entry scripts then import functions the old copies do not have, and part
of the pack stops loading. Two small pieces fix that:

- every .mjs of this pack is served with Cache-Control: no-cache, so the
  browser asks the server before reusing it (a quick "not modified" when
  nothing changed);
- /ausboss/pack_modules lists those files, so a tab that is already running
  old copies (js/cache_guard/index.js) can refresh them in one go.
"""

from pathlib import Path

PACK_DIR = Path(__file__).parent.parent
_registered = False


def list_pack_modules(pack_dir=PACK_DIR):
    """Paths of the pack's .mjs files, relative to its js folder, with '/'."""
    root = Path(pack_dir) / "js"
    if not root.is_dir():
        return []
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*.mjs"))


def is_pack_module_path(request_path, pack_name):
    """True for /extensions/<pack_name>/.../*.mjs."""
    return request_path.startswith(f"/extensions/{pack_name}/") and request_path.endswith(".mjs")


def make_revalidate_middleware(pack_name):
    """aiohttp middleware: no-cache on this pack's .mjs, nothing else touched."""
    from aiohttp import web

    @web.middleware
    async def revalidate_pack_modules(request, handler):
        response = await handler(request)
        if is_pack_module_path(request.path, pack_name):
            response.headers["Cache-Control"] = "no-cache"
        return response

    return revalidate_pack_modules


def register_frontend_cache_guard():
    """Add the no-cache header and the module list. Fail-soft, run once."""
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
        prompt_server.app.middlewares.append(make_revalidate_middleware(PACK_DIR.name))
    except Exception:
        pass

    @prompt_server.routes.get("/ausboss/pack_modules")
    async def ausboss_pack_modules(request):
        return web.json_response({"modules": list_pack_modules()})
