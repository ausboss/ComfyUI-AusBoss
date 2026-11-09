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
import tomllib

PACK_NAME = "ausboss-nodes"
# A copy that has this file knows how to step aside.
_GUARD_FILE = os.path.join("nodes", "_single_copy.py")


def _read_pack(folder: str) -> dict | None:
    """Name the pack copy in ``folder``, or None when it is another pack."""
    try:
        with open(os.path.join(folder, "pyproject.toml"), "rb") as f:
            project = tomllib.load(f).get("project", {})
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
            folder = os.path.realpath(os.path.join(root, name))
            if folder in seen or not os.path.isdir(folder):
                continue
            seen.add(folder)
            pack = _read_pack(folder)
            if pack:
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
        roots = [os.path.dirname(os.path.realpath(own_folder))]
        try:
            import folder_paths

            roots += folder_paths.get_folder_paths("custom_nodes")
        except Exception:
            pass
    roots = list(dict.fromkeys(os.path.realpath(r) for r in roots))
    copies = find_copies(own_folder, roots)
    if len(copies) < 2:
        return None
    chosen = pick_copy(copies)
    return None if chosen["folder"] == os.path.realpath(own_folder) else chosen
