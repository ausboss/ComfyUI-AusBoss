"""Only one copy of the pack loads.

A Manager install lands in ``custom_nodes/ausboss-nodes`` and a git clone in
``custom_nodes/ComfyUI-AusBoss``. With both in place every route is added
twice and ComfyUI stops while starting. So each copy looks for the others
and all of them agree on the one that loads; the rest step aside and say
which folder to delete.

A copy from before this file existed cannot step aside, so it always loads
and a newer copy yields to it. Among copies that can, the newest version
loads.
"""

from __future__ import annotations

import os

from ._pyproject import read_project

PACK_NAME = "ausboss-nodes"
# A copy that has this file knows how to step aside.
_GUARD_FILE = os.path.join("nodes", "_single_copy.py")


def _read_pack(folder: str) -> dict | None:
    """Name the pack copy in ``folder``, or None when it is another pack."""
    try:
        project = read_project(os.path.join(folder, "pyproject.toml"))
    except Exception:
        return None
    if project.get("name") != PACK_NAME:
        return None
    if not os.path.isfile(os.path.join(folder, "__init__.py")):
        return None
    version = project.get("version")
    return {
        "folder": folder,
        "version": version if isinstance(version, str) else "unknown",
        "guarded": os.path.isfile(os.path.join(folder, _GUARD_FILE)),
    }


def _version_key(version: str) -> tuple:
    parts = []
    for part in version.split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        parts.append(int(digits) if digits else -1)
    return tuple(parts)


def find_copies(own_folder: str, roots: list[str]) -> list[dict]:
    """Every copy of the pack below ``roots``, this one included."""
    own = os.path.realpath(own_folder)
    seen = {own}
    copies = [_read_pack(own) or {"folder": own, "version": "unknown", "guarded": True}]
    for root in roots:
        try:
            names = sorted(os.listdir(root))
        except OSError:
            continue
        for name in names:
            # ComfyUI skips these too.
            if name.endswith(".disabled") or name.startswith("."):
                continue
            entry = os.path.join(root, name)
            folder = os.path.realpath(entry)
            if folder in seen or not os.path.isdir(folder):
                continue
            seen.add(folder)
            pack = _read_pack(folder)
            if pack:
                pack["entry"] = entry
                copies.append(pack)
    return copies


def pick_copy(copies: list[dict]) -> dict:
    """The one copy that loads. Every copy reaches the same answer."""
    unguarded = [c for c in copies if not c["guarded"]]
    pool = unguarded or copies
    return max(pool, key=lambda c: (_version_key(c["version"]), c["folder"]))


def other_copy_that_loads(own_folder: str, roots: list[str] | None = None) -> dict | None:
    """The copy this one steps aside for, or None when this one loads."""
    if roots is None:
        # Outside ComfyUI nothing is served, so there is nothing to clash.
        try:
            import folder_paths

            roots = list(folder_paths.get_folder_paths("custom_nodes"))
        except Exception:
            return None
    roots = list(dict.fromkeys(os.path.realpath(r) for r in roots))
    copies = find_copies(own_folder, roots)
    if len(copies) < 2:
        return None
    chosen = pick_copy(copies)
    return None if chosen["folder"] == os.path.realpath(own_folder) else chosen


def is_older(version: str, than: str) -> bool:
    return _version_key(version) < _version_key(than)


def second_copy_notice(own_folder: str, own_version: str, other: dict) -> dict:
    """What the browser tells someone whose pack is installed twice.

    The usual case is an old git clone beside a newer Manager install: the
    old clone cannot step aside, so it loads, and every node added since
    shows as missing however often the Manager updates the other folder.
    """
    own = os.path.basename(os.path.realpath(own_folder))
    used = os.path.basename(other["folder"])
    if is_older(other["version"], own_version):
        summary = "AusBoss: an old copy is loading"
        detail = (
            f"ComfyUI is loading the old AusBoss v{other['version']} in "
            f"custom_nodes/{used}, not v{own_version} in custom_nodes/{own}. "
            f"Nodes added after v{other['version']} show as missing, and "
            f"updating does not fix it. Delete the custom_nodes/{used} "
            "folder, then restart ComfyUI."
        )
    else:
        summary = "AusBoss is installed twice"
        detail = (
            f"AusBoss is in custom_nodes/{used} (v{other['version']}) and "
            f"custom_nodes/{own} (v{own_version}). Only custom_nodes/{used} "
            f"loads. Delete custom_nodes/{own}, then restart ComfyUI."
        )
    return {"summary": summary, "detail": detail, "older": is_older(other["version"], own_version)}


NOTICE_ROUTE = "/ausboss/second_copy"


def register_second_copy_notice(notice: dict, prompt_server=None) -> bool:
    """Serve ``notice`` to the browser at NOTICE_ROUTE.

    Only copies that step aside call this, and the copy that loads never
    adds this route, so nothing is added twice. Two copies that both step
    aside share one route: the first adds it, the rest add their notice to
    its list.
    """
    if prompt_server is None:
        try:
            from server import PromptServer

            prompt_server = PromptServer.instance
        except Exception:
            return False
    notices = getattr(prompt_server, "_ausboss_second_copy_notices", None)
    if notices is not None:
        notices.append(notice)
        return True
    notices = [notice]
    prompt_server._ausboss_second_copy_notices = notices

    from aiohttp import web

    @prompt_server.routes.get(NOTICE_ROUTE)
    async def _second_copy_notices(_request):
        return web.json_response(notices)

    return True


def _disabled_name(entry: str) -> str:
    target = f"{entry}.disabled"
    n = 2
    while os.path.lexists(target):
        target = f"{entry}.{n}.disabled"
        n += 1
    return target


def retire_old_copies(own_folder: str, roots: list[str] | None = None) -> list[dict]:
    """Turn off every copy from before 2.24.0, before any copy loads.

    Those copies cannot step aside, so with one of them installed the old
    nodes keep loading however often the new copy is updated. Each one is
    renamed ``<folder>.disabled``, which ComfyUI and ComfyUI-Manager skip.
    Nothing is deleted, and renaming the folder back undoes it. Runs from
    prestartup_script.py, which ComfyUI calls for every pack before it imports
    any of them, so the old copy never gets the chance to load.
    """
    if roots is None:
        try:
            import folder_paths

            roots = list(folder_paths.get_folder_paths("custom_nodes"))
        except Exception:
            return []
    roots = list(dict.fromkeys(os.path.realpath(r) for r in roots))
    own_version = (_read_pack(os.path.realpath(own_folder)) or {}).get("version", "unknown")
    retired = []
    for copy in find_copies(own_folder, roots):
        entry = copy.get("entry")
        if not entry or copy["guarded"] or "unknown" in (copy["version"], own_version):
            continue
        if not is_older(copy["version"], own_version):
            continue
        target = _disabled_name(entry)
        try:
            os.rename(entry, target)
        except OSError as exc:
            retired.append({**copy, "disabled": None, "error": str(exc)})
            continue
        retired.append({**copy, "disabled": target})
    return retired
