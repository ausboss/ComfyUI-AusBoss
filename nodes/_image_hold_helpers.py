"""Pictures Save Image holds until they are kept.

With Auto save off, a run writes its pictures to ComfyUI's temp folder and
shows them on the node. A click on the node's Save button keeps the ones
that are wanted: they are copied into the output folder under the names the
node would have given them. Everything here works from names this module
made itself; the only thing a caller sends is the run's token and which
pictures to keep.

What a run holds (its settings, its count, what was kept) stays in this
process's memory, never in a file. ComfyUI's temp folder takes uploads, so a
list read back from there could be anyone's. The held pictures themselves
are named from the token, their number and one of the node's own formats,
and must still be in the held folder when they are copied.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from pathlib import Path
import re
import secrets
import shutil
import threading

from ._image_save_helpers import (
    FORMAT_EXTENSIONS,
    IMAGE_SAVE_LOCK,
    existing_action,
    name_stem,
    next_free_counter,
    plan_exact_names,
    plan_local_names,
    require_output_path,
    resolve_output_root,
    sidecar_path,
    split_prefix,
    strip_image_extension,
)

HELD_FOLDER = "ausboss_held"
_TOKEN = re.compile(r"^[0-9a-f]{16}$")
GONE = "These pictures are no longer held. Run the workflow again."
# The held pictures' formats: the extensions Save Image writes, nothing else.
HELD_EXTENSIONS = frozenset(FORMAT_EXTENSIONS.values())
# A run holds at most this many pictures, and the server remembers this many
# runs; the oldest is forgotten first and then says GONE.
MAX_HELD_PICTURES = 10000
MAX_HELD_RUNS = 256
_RUNS: "OrderedDict[str, dict]" = OrderedDict()
_RUNS_LOCK = threading.Lock()


def plan_destinations(settings: dict, count: int, now: datetime, root: Path, output_root: Path, picks=None):
    """Where each picture goes, as (path, what to do if it exists).

    Call it with IMAGE_SAVE_LOCK held: the counter it reads stays free only
    until the lock is let go. `picks` keeps some of a run's pictures; an
    exact name then keeps the number it would have had in the whole run.
    """
    wanted = list(range(count)) if picks is None else list(picks)
    extension = settings["extension"]
    exact = settings.get("exact") or ""
    if exact:
        names = plan_exact_names(strip_image_extension(exact), extension, count)
        return [(root / names[index], settings["on_existing"]) for index in wanted]
    subfolder, base = split_prefix(settings["filename_prefix"])
    folder = root / subfolder if subfolder else root
    require_output_path(folder, output_root)
    stem = name_stem(
        base,
        {"date": bool(settings["name_date"]), "time": bool(settings["name_time"]), "size": bool(settings["name_size"])},
        now,
        int(settings["width"]),
        int(settings["height"]),
    )
    counter = bool(settings["name_counter"])
    existing = [entry.name for entry in folder.iterdir()] if folder.is_dir() else []
    names = plan_local_names(
        stem, extension, len(wanted), counter=counter, batch=bool(settings["name_batch"]),
        next_counter=next_free_counter(existing, stem),
    )
    # With a counter the name is free by construction. Without one, the
    # legacy policy decides whether to overwrite.
    policy = "overwrite" if counter else settings["on_existing"]
    return [(folder / name, policy) for name in names]


def settle_destinations(planned, has_caption: bool, output_root: Path) -> list[str]:
    """Check every destination, then say 'write' or 'skip' for each.

    The whole batch is settled before any write: an "error" on a later
    picture stops the save before the first one lands.
    """
    for path, _policy in planned:
        require_output_path(path, output_root)
        if has_caption:
            require_output_path(sidecar_path(path), output_root)
    return [
        existing_action(path.exists() or (has_caption and sidecar_path(path).exists()), policy)
        for path, policy in planned
    ]


def _held_name(token: str, index: int, extension: str) -> str:
    if not _TOKEN.match(token) or extension not in HELD_EXTENSIONS or not 0 <= index < MAX_HELD_PICTURES:
        raise ValueError("Save Image: that is not a picture it is holding.")
    return f"{token}_{index:03d}.{extension}"


def _held_source(folder: Path, token: str, index: int, extension: str) -> Path:
    """A held picture's file, which must still sit directly in the held folder."""
    source = folder / _held_name(token, index, extension)
    if not source.is_file() or source.is_symlink() or source.resolve().parent != folder.resolve():
        raise LookupError(GONE)
    return source


def hold_pictures(temp_root, frames, settings: dict, encode) -> tuple[str, list[dict]]:
    """Write a run's pictures to the temp folder and remember how to name them.

    `encode(path, frame)` writes one picture in the run's format. Returns
    the run's token and the entries the node shows them from.
    """
    frames = list(frames)
    if len(frames) > MAX_HELD_PICTURES:
        raise ValueError(
            f"Save Image: {len(frames)} pictures are too many to hold (at most {MAX_HELD_PICTURES}). "
            "Turn Auto save on to save them straight away."
        )
    folder = Path(temp_root) / HELD_FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(8)
    previews = []
    for index, frame in enumerate(frames):
        name = _held_name(token, index, settings["extension"])
        encode(folder / name, frame)
        previews.append({"filename": name, "subfolder": HELD_FOLDER, "type": "temp"})
    with _RUNS_LOCK:
        _RUNS[token] = dict(settings, count=len(previews), kept={})
        while len(_RUNS) > MAX_HELD_RUNS:
            _RUNS.popitem(last=False)
    return token, previews


def keep_pictures(temp_root, output_root, token, picks=None, now: datetime | None = None) -> dict:
    """Copy held pictures into the output folder. Returns what was saved.

    `picks` lists which pictures of the run to keep, counted from 0; None
    keeps them all. A picture kept before is not saved a second time.
    """
    if not isinstance(token, str) or not _TOKEN.match(token):
        raise ValueError("Save Image: that is not a run it is holding.")
    folder = Path(temp_root) / HELD_FOLDER
    with _RUNS_LOCK:
        manifest = _RUNS.get(token)
    if manifest is None:
        raise LookupError(GONE)
    count = int(manifest["count"])
    kept = dict(manifest["kept"])

    if picks is None:
        wanted = list(range(count))
    else:
        if len(picks) > MAX_HELD_PICTURES:
            raise ValueError("Save Image: that picture is not in this run.")
        wanted = []
        for pick in picks:
            if isinstance(pick, bool) or not isinstance(pick, int) or not 0 <= pick < count:
                raise ValueError("Save Image: that picture is not in this run.")
            if pick not in wanted:
                wanted.append(pick)
    todo = [index for index in wanted if index not in kept]

    output_root = Path(output_root)
    caption = str(manifest.get("caption") or "")
    has_caption = bool(caption.strip())
    skipped: list[int] = []
    saved: list[int] = []
    with IMAGE_SAVE_LOCK:
        root = resolve_output_root(manifest.get("output_dir", ""), output_root)
        planned = plan_destinations(manifest, count, now or datetime.now(), root, output_root, picks=todo)
        actions = settle_destinations(planned, has_caption, output_root)
        resolved_root = output_root.resolve()
        for (path, _policy), action, index in zip(planned, actions, todo):
            if action == "skip":
                skipped.append(index)
                continue
            source = _held_source(folder, token, index, manifest["extension"])
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, path)
            if has_caption:
                sidecar_path(path).write_text(caption, encoding="utf-8")
            kept[index] = path.resolve().relative_to(resolved_root).as_posix()
            saved.append(index)
        manifest["kept"] = kept
    return {
        "count": count,
        "saved": [{"index": index, "path": kept[index]} for index in saved],
        "kept": sorted(kept),
        "skipped": skipped,
    }
