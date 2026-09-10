"""Which folders on the ComfyUI computer the pack may read from or write to.

ComfyUI's /prompt route and the pack's own routes need no login, so a widget
value or a request parameter is no evidence that anyone at this computer
chose it. Wherever a node reaches a folder outside ComfyUI's own, the folder
has to pass this module:

  1. ComfyUI's input, output and temp folders are always usable.
  2. A folder the person at the computer approved: chosen in the operating
     system's own dialog (the Browse buttons on the nodes), or written by
     hand into <ComfyUI user folder>/ausboss/folder_access.json under
     "approved".
  3. With "any_folder": true in that file, any folder outside ComfyUI.

Nothing a request carries can approve a folder. Anyone who can reach the
server can make the dialog appear, but choosing a folder and pressing OK
happen in the operating system, and the dialog always opens in a folder that
is usable anyway, so an OK pressed by reflex approves nothing new. The file
is edited by hand; no route writes "any_folder".

Folders that hold ComfyUI itself are never usable, approved or not: its
install folder and every folder containing it, everything inside it apart
from input/output/temp, and the custom node and model folders registered
with ComfyUI. Even a careless approval therefore cannot let a workflow write
beside code that ComfyUI runs or files that it loads.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


CONFIG_NAME = "folder_access.json"
CHOOSE_KINDS = ("folder", "video")
_CONFIG_LOCK = threading.Lock()
_DIALOG_LOCK = threading.Lock()
_DIALOG_TITLES = {
    "folder": "AusBoss - choose a folder to save into",
    "video": "AusBoss - choose a video to read",
}


def _clean(raw) -> str:
    """Trim whitespace and the quotes a pasted "Copy as path" carries."""
    if isinstance(raw, Path):
        raw = str(raw)
    if not isinstance(raw, str):
        return ""
    return raw.strip().strip('"').strip("'").strip()


def looks_unc(raw) -> bool:
    """A Windows network path (\\\\host\\share or //host/share), decided from
    the text alone: merely resolving one makes Windows contact that host."""
    return _clean(raw).replace("/", "\\").startswith("\\\\")


def _real(path) -> str | None:
    text = _clean(path)
    if not text:
        return None
    try:
        return os.path.realpath(os.path.expanduser(text))
    except (OSError, ValueError, TypeError):
        return None


def _written(path) -> str:
    return os.path.normcase(os.path.abspath(os.path.expanduser(_clean(path))))


def is_within(path, *roots) -> bool:
    """True when ``path`` is one of ``roots`` or inside one, symlinks
    resolved on both sides. Paths that land on different drives (a folder
    junctioned to another disk on Windows) are compared as written instead,
    which '..' cannot climb out of either."""
    child = _real(path)
    if not child:
        return False
    for root in roots:
        base = _real(root)
        if not base:
            continue
        try:
            if os.path.commonpath([os.path.normcase(child), os.path.normcase(base)]) == os.path.normcase(base):
                return True
        except ValueError:
            try:
                if os.path.commonpath([_written(path), _written(root)]) == _written(root):
                    return True
            except ValueError:
                continue
    return False


def _within_text(path, roots) -> bool:
    """Prefix test on the written absolute paths, with no filesystem access:
    the only safe test for network paths."""
    child = _written(path)
    for root in roots:
        base = _written(root).rstrip("\\/")
        if base and any(child == base or child.startswith(base + sep) for sep in (os.sep, "/", "\\")):
            return True
    return False


def comfy_roots() -> list[str]:
    """ComfyUI's input, output and temp folders: always usable."""
    roots: list[str] = []
    if folder_paths is None:
        return roots
    for getter in ("get_input_directory", "get_output_directory", "get_temp_directory"):
        try:
            value = getattr(folder_paths, getter)()
        except Exception:
            continue
        if value:
            roots.append(str(value))
    return roots


def _comfy_code_folders() -> tuple[str | None, list[str]]:
    """ComfyUI's install folder, the custom node and model folders it
    registered (extra_model_paths can put those anywhere), and the real
    folders behind custom node packs that are links - a checkout linked
    into custom_nodes is code ComfyUI runs all the same."""
    if folder_paths is None:
        return None, []
    base = getattr(folder_paths, "base_path", None)
    registered: list[str] = []
    table = getattr(folder_paths, "folder_names_and_paths", None) or {}
    for name, entry in list(table.items()):
        paths = entry[0] if isinstance(entry, (tuple, list)) and entry else ()
        for item in paths or ():
            if not isinstance(item, str) or not item:
                continue
            registered.append(item)
            if name == "custom_nodes":
                registered.extend(_linked_packs(item))
    return (str(base) if base else None), registered


def _linked_packs(folder: str) -> list[str]:
    """Where the linked packs inside a custom_nodes folder really live."""
    targets: list[str] = []
    try:
        with os.scandir(folder) as entries:
            for entry in entries:
                linked = entry.is_symlink() or getattr(entry, "is_junction", lambda: False)()
                real = _real(entry.path) if linked else None
                if real:
                    targets.append(real)
    except OSError:
        pass
    return targets


def holds_comfyui(path) -> bool:
    """True for a folder that holds ComfyUI itself: never usable."""
    real = _real(path)
    if not real:
        return True
    roots = comfy_roots()
    if roots and is_within(real, *roots):
        return False
    base, registered = _comfy_code_folders()
    if base and (is_within(real, base) or is_within(base, real)):
        return True
    return bool(registered) and is_within(real, *registered)


def config_path() -> Path:
    """<ComfyUI user folder>/ausboss/folder_access.json, beside the pack's
    other per-user files and outside the pack folder, which is a git
    checkout that Manager may replace."""
    base = None
    if folder_paths is not None:
        try:
            base = folder_paths.get_user_directory()
        except Exception:
            base = None
    if base:
        return Path(base) / "ausboss" / CONFIG_NAME
    return Path.home() / ".ausboss" / CONFIG_NAME


def _load_raw() -> tuple[dict, bool]:
    """(file contents, damaged). A missing file is empty, not damaged."""
    path = config_path()
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}, False
    except OSError:
        return {}, True
    try:
        data = json.loads(text)
    except ValueError:
        return {}, True
    return (data, False) if isinstance(data, dict) else ({}, True)


def read_access() -> dict:
    """What the file approves. Never raises: a missing or damaged file
    approves nothing, and never stops a render. Read on every check, so a
    hand edit takes effect without a restart."""
    data, damaged = _load_raw()
    folders = data.get("approved", [])
    if not isinstance(folders, list):
        folders, damaged = [], True
    return {
        "approved": [item for item in folders if isinstance(item, str) and item.strip()],
        "any_folder": data.get("any_folder") is True,
        "damaged": damaged,
    }


def folder_allowed(path) -> bool:
    """True when the pack may read or write in ``path``."""
    text = _clean(path)
    if not text:
        return False
    access = read_access()
    if looks_unc(text):
        if access["any_folder"]:
            return True
        return _within_text(text, [item for item in access["approved"] if looks_unc(item)])
    roots = comfy_roots()
    if roots and is_within(text, *roots):
        return True
    if holds_comfyui(text):
        return False
    if access["any_folder"]:
        return True
    local = [item for item in access["approved"] if not looks_unc(item)]
    return bool(local) and is_within(text, *local)


def file_allowed(path) -> bool:
    """True when a file's folder is usable (see folder_allowed)."""
    text = _clean(path)
    if not text:
        return False
    if looks_unc(text):
        return folder_allowed(os.path.dirname(os.path.abspath(text)))
    real = _real(text)
    return bool(real) and folder_allowed(os.path.dirname(real))


def approve_folder(path) -> bool:
    """Record a folder the person at this computer chose in the system dialog.

    Only the dialog route calls this, and only with the dialog's answer: a
    path taken from a request would let the request approve its own target.
    Refuses folders that hold ComfyUI, and never rewrites a file it could not
    read, which would drop every earlier approval.
    """
    text = _clean(path)
    if not text:
        return False
    if looks_unc(text):
        chosen = os.path.abspath(text)
    else:
        chosen = _real(text)
        if not chosen or not os.path.isdir(chosen) or holds_comfyui(chosen):
            return False
    with _CONFIG_LOCK:
        if folder_allowed(chosen):
            return True
        data, damaged = _load_raw()
        approved = data.get("approved", [])
        if damaged or not isinstance(approved, list):
            return False

        def covered(item) -> bool:
            # An earlier approval inside the new one adds nothing any more.
            return not looks_unc(item) and not looks_unc(chosen) and is_within(item, chosen)

        data["approved"] = [
            item for item in approved if isinstance(item, str) and item.strip() and not covered(item)
        ] + [chosen]
        target = config_path()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".tmp")
            temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
            os.replace(temporary, target)
        except OSError:
            return False
    return True


def dialog_available() -> bool:
    """Whether this computer can show the system file dialog to someone at it.

    tkinter, part of Python, draws it; no helper program is started. Not on
    macOS, where a window may only open on the process's main thread, and not
    on Linux without a display (a headless server, Docker, a cloud box).
    """
    if sys.platform == "darwin":
        return False
    if sys.platform != "win32" and not os.environ.get("DISPLAY"):
        return False
    try:
        import tkinter  # noqa: F401
        from tkinter import filedialog  # noqa: F401
    except Exception:
        return False
    return True


def ask_in_dialog(kind: str, start: str, extensions=()) -> str | None:
    """Show the system dialog and wait for the person at the computer.
    Returns the chosen path, "" when cancelled or failed, and None while
    another dialog is still open."""
    if not _DIALOG_LOCK.acquire(blocking=False):
        return None
    try:
        import tkinter
        from tkinter import filedialog

        root = tkinter.Tk()
        try:
            root.withdraw()
            try:
                root.attributes("-topmost", True)
            except tkinter.TclError:
                pass
            options = {"parent": root, "title": _DIALOG_TITLES.get(kind, _DIALOG_TITLES["folder"])}
            if start and os.path.isdir(start):
                options["initialdir"] = start
            if kind == "video":
                patterns = " ".join(f"*{extension}" for extension in extensions) or "*"
                chosen = filedialog.askopenfilename(
                    filetypes=[("Videos", patterns), ("All files", "*")], **options
                )
            else:
                chosen = filedialog.askdirectory(mustexist=True, **options)
        finally:
            root.destroy()
        return chosen if isinstance(chosen, str) else ""
    except Exception as exc:
        print(f"[AusBoss] The folder dialog failed: {type(exc).__name__}")
        return ""
    finally:
        _DIALOG_LOCK.release()


def _start_folder(kind: str) -> str:
    """Where the dialog opens: a folder that is usable anyway and never a
    path from the request, so an OK pressed without looking approves
    nothing new."""
    if folder_paths is None:
        return ""
    getter = "get_input_directory" if kind == "video" else "get_output_directory"
    try:
        return str(getattr(folder_paths, getter)() or "")
    except Exception:
        return ""


def approval_help() -> str:
    """How to approve a folder on this computer, for refusal messages."""
    manual = (
        f'add the folder to "approved" in {config_path()} (write it with forward '
        'slashes, like "D:/Pictures"), or set "any_folder": true there to allow '
        "every folder outside ComfyUI"
    )
    if dialog_available():
        return (
            "Approve it once with the node's Browse button, which opens the system "
            f"dialog on the ComfyUI computer, or {manual}."
        )
    return f"This ComfyUI computer cannot show a folder dialog, so approve it by hand: {manual}."


def refusal_message(path, node_name: str = "") -> str:
    """Why a folder was refused, and how to approve it. ``node_name``
    prefixes the message where the caller adds no prefix of its own."""
    shown = _clean(path) or "(empty)"
    prefix = f"{node_name}: " if node_name else ""
    if not looks_unc(shown) and holds_comfyui(shown):
        return (
            f"{prefix}{shown} holds ComfyUI itself (its install, custom node or model "
            "folders), which a workflow may never read or write. Choose a folder outside "
            "ComfyUI, or use ComfyUI's input, output or temp folder."
        )
    return (
        f"{prefix}The folder {shown} is not approved on this computer, so it was not "
        f"used. {approval_help()} ComfyUI's input, output and temp folders always work."
    )


class FolderRefused(ValueError):
    """A refused folder. str() is the full message for the node's owner;
    ``public`` is a short one without server paths, for routes that any
    client on the network can call."""

    def __init__(self, message: str, public: str):
        super().__init__(message)
        self.public = public


def refusal(path, node_name: str = "") -> FolderRefused:
    """The error to raise when a local video's folder is refused."""
    shown = _clean(path)
    if shown and not looks_unc(shown) and holds_comfyui(shown):
        public = "That folder holds ComfyUI itself, which a workflow may never read or write."
    elif dialog_available():
        public = (
            "That folder is not approved on this computer. Choose the video with Browse... "
            "beside the path: the system dialog on the ComfyUI computer approves its folder."
        )
    else:
        public = (
            "That folder is not approved on this computer. Queue the node to see how to "
            "approve it on a server with no screen."
        )
    return FolderRefused(refusal_message(path, node_name), public)


async def choose_and_approve(kind: str, extensions=(), *, ask=None, available=None) -> dict:
    """The dialog route's work without the HTTP plumbing: show the dialog,
    approve what was chosen, and describe the outcome for the node."""
    kind = kind if kind in CHOOSE_KINDS else "folder"
    if not (available or dialog_available)():
        return {"ok": False, "unavailable": True, "message": approval_help()}
    loop = asyncio.get_running_loop()
    chosen = await loop.run_in_executor(
        None, ask or ask_in_dialog, kind, _start_folder(kind), tuple(extensions)
    )
    if chosen is None:
        return {"ok": False, "busy": True}
    if not chosen:
        return {"ok": False, "cancelled": True}
    folder = chosen if kind == "folder" else os.path.dirname(chosen)
    if folder_allowed(folder) or approve_folder(folder):
        return {"ok": True, "path": chosen}
    if not looks_unc(folder) and holds_comfyui(folder):
        return {"ok": False, "refused": True, "message": refusal_message(folder)}
    return {
        "ok": False,
        "refused": True,
        "message": (
            f"AusBoss could not record the approval in {config_path()}: the file is "
            "unreadable or cannot be written. Fix or delete it, then choose the folder again."
        ),
    }


def register_folder_access_routes() -> None:
    """POST /ausboss/folders/choose {"kind": "folder" | "video"}: show the
    system dialog on the ComfyUI computer and approve what was chosen."""
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None or getattr(prompt_server, "_ausboss_folder_access_routes", False):
        return
    prompt_server._ausboss_folder_access_routes = True

    @prompt_server.routes.post("/ausboss/folders/choose")
    async def ausboss_choose_folder(request):
        # POST, so ComfyUI's origin check keeps other websites from opening
        # the dialog; the body names only the kind of dialog, never a path.
        try:
            body = await request.json()
        except Exception:
            body = {}
        kind = body.get("kind") if isinstance(body, dict) else None
        extensions: tuple = ()
        if kind == "video":
            try:
                from ._media_helpers import VIDEO_EXTENSIONS

                extensions = tuple(sorted(VIDEO_EXTENSIONS))
            except Exception:
                extensions = ()
        result = await choose_and_approve(str(kind or "folder"), extensions)
        return web.json_response(result)


__all__ = [
    "CHOOSE_KINDS",
    "CONFIG_NAME",
    "FolderRefused",
    "approval_help",
    "approve_folder",
    "ask_in_dialog",
    "choose_and_approve",
    "comfy_roots",
    "config_path",
    "dialog_available",
    "file_allowed",
    "folder_allowed",
    "holds_comfyui",
    "is_within",
    "looks_unc",
    "read_access",
    "refusal",
    "refusal_message",
    "register_folder_access_routes",
]
