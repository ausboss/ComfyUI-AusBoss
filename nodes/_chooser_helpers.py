"""Frame Chooser helpers: selection math, thumbnails, and pause plumbing.

The pure functions at the top are covered by offline unit tests. Everything
that talks to ComfyUI (thumbnail files, the websocket announcement, the
answer route, the blocking wait) imports server modules lazily so this file
stays importable without ComfyUI installed.
"""

from __future__ import annotations

import hashlib
import math
import re
import threading
import time
from pathlib import Path

import torch

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


POLL_SECONDS = 0.1
THUMBNAIL_SUBFOLDER = "ausboss_chooser"
EVENT_NAME = "ausboss-frame-choose"
TICK_EVENT = "ausboss-frame-choose-tick"
DONE_EVENT = "ausboss-frame-choose-done"

TIMEOUT_KEEP_ALL = "keep all"
TIMEOUT_KEEP_FIRST = "keep first"
TIMEOUT_KEEP_LAST = "keep last"
TIMEOUT_CANCEL = "cancel"
TIMEOUT_POLICIES = [
    TIMEOUT_KEEP_ALL,
    TIMEOUT_KEEP_FIRST,
    TIMEOUT_KEEP_LAST,
    TIMEOUT_CANCEL,
]


# --- pure selection logic ----------------------------------------------------

def normalize_selection(values, frame_count: int) -> list[int]:
    """Validate a browser-supplied selection of one-based frame indices.

    Returns the indices deduplicated and ascending, so the kept frames always
    stay in source order. An empty list is valid and means "keep every frame".
    Anything else invalid raises, so a malformed or hostile request can never
    release a paused graph with a selection the node did not offer."""
    if not isinstance(values, (list, tuple)):
        raise ValueError("Frame selection must be a list of one-based integers.")
    count = int(frame_count)
    kept: set[int] = set()
    for value in values:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Frame selection entries must be plain integers.")
        if value < 1 or value > count:
            raise ValueError(
                f"Frame {value} is outside this batch (1 through {count})."
            )
        kept.add(value)
    return sorted(kept)


def usable_remembered(values, frame_count: int) -> list[int] | None:
    """Adapt a remembered selection to the current batch size.

    Indices past the end of the new batch are dropped. Returns None when the
    memory named frames only beyond this batch (or is not a list at all): a
    useless memory means the node should pause and ask again."""
    if not isinstance(values, (list, tuple)):
        return None
    count = int(frame_count)
    valid = sorted(
        {
            int(value)
            for value in values
            if isinstance(value, int)
            and not isinstance(value, bool)
            and 1 <= value <= count
        }
    )
    if values and not valid:
        return None
    return valid


def keep_frames(frames: torch.Tensor, one_based: list[int]) -> torch.Tensor:
    """Slice a BHWC batch down to the chosen frames, keeping source order.

    An empty selection keeps the whole batch unchanged."""
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("Frame Chooser expected a BHWC IMAGE batch.")
    if not one_based:
        return frames
    index = torch.tensor(
        [int(value) - 1 for value in one_based], dtype=torch.long, device=frames.device
    )
    return frames.index_select(0, index)


def effective_indices(one_based: list[int], frame_count: int) -> list[int]:
    """Resolve "empty means keep all" into the concrete kept indices."""
    if one_based:
        return [int(value) for value in one_based]
    return list(range(1, int(frame_count) + 1))


def indices_string(one_based: list[int]) -> str:
    """One-based indices joined for the STRING output, e.g. '1,4,9'."""
    return ",".join(str(value) for value in one_based)


def _pick_tokens(text) -> list[str]:
    """Split a pick_list string on commas and whitespace, dropping blanks."""
    if text is None:
        return []
    return [token for token in re.split(r"[,\s]+", str(text).strip()) if token]


def parse_pick_list(text, frame_count: int) -> list[int] | None:
    """Turn the pick_list widget into a pre-answered selection.

    Returns None when the widget is empty (the node should pause as usual)
    and the validated one-based selection otherwise, deduplicated and
    ascending exactly like an answer from the browser route. Any token that
    is not a frame number inside this batch raises, so a typo fails the run
    loudly instead of silently keeping the wrong frames."""
    tokens = _pick_tokens(text)
    if not tokens:
        return None
    values: list[int] = []
    for token in tokens:
        if not token.isdigit():
            raise ValueError(
                f"pick_list entry '{token}' is not a one-based frame number."
            )
        values.append(int(token))
    return normalize_selection(values, frame_count)


def pick_list_fingerprint(text) -> str:
    """Stable IS_CHANGED value for a non-empty pick_list.

    Equivalent spellings ('1, 4, 9' vs '4 1 9 9') share one fingerprint, so
    a headless pre-answered run caches instead of re-executing every queue."""
    tokens = _pick_tokens(text)
    if tokens and all(token.isdigit() for token in tokens):
        canonical = ",".join(str(value) for value in sorted({int(t) for t in tokens}))
    else:
        canonical = ",".join(tokens)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"picks:{digest}"


def resolve_timeout_policy(policy: str, frame_count: int) -> list[int] | None:
    """Selection applied when a paused chooser's countdown expires.

    Returns a one-based selection ([] = keep all), or None for the cancel
    policy, which the caller turns into a queue interrupt. Unknown policy
    strings fall back to keep-all: an expired timer must never guess a
    destructive answer."""
    count = int(frame_count)
    if policy == TIMEOUT_CANCEL:
        return None
    if policy == TIMEOUT_KEEP_FIRST:
        return [1] if count >= 1 else []
    if policy == TIMEOUT_KEEP_LAST:
        return [count] if count >= 1 else []
    return []


# --- thumbnails ---------------------------------------------------------------

def write_thumbnails(frames: torch.Tensor, run_token: str, max_size: int) -> list[dict]:
    """Write one downscaled JPEG per frame into ComfyUI's temp folder.

    Returns /view descriptors ({filename, subfolder, type}) the frontend turns
    into URLs. The temp folder is ComfyUI-managed, so the files disappear with
    every normal temp cleanup."""
    from PIL import Image

    from ._media_helpers import encode_preview

    if folder_paths is None:
        raise RuntimeError("Frame Chooser thumbnails require ComfyUI's folder_paths.")
    root = Path(folder_paths.get_temp_directory()) / THUMBNAIL_SUBFOLDER
    root.mkdir(parents=True, exist_ok=True)
    files: list[dict] = []
    for index in range(int(frames.shape[0])):
        array = (
            (frames[index].detach().clamp(0.0, 1.0) * 255.0)
            .round()
            .to(torch.uint8)
            .cpu()
            .numpy()
        )
        if array.ndim == 3 and array.shape[-1] >= 3:
            image = Image.fromarray(array[..., :3], "RGB")
        else:
            image = Image.fromarray(array.reshape(array.shape[0], array.shape[1]), "L")
        name = f"{run_token}_{index + 1:04d}.jpg"
        (root / name).write_bytes(encode_preview(image, int(max_size), int(max_size)))
        files.append({"filename": name, "subfolder": THUMBNAIL_SUBFOLDER, "type": "temp"})
    return files


# --- pause plumbing -----------------------------------------------------------

class _PendingChoice:
    """One paused Frame Chooser execution awaiting a browser answer."""

    __slots__ = ("event", "frame_count", "selection", "cancelled", "payload", "deadline")

    def __init__(self, frame_count: int, payload: dict | None = None, deadline: float | None = None):
        self.event = threading.Event()
        self.frame_count = int(frame_count)
        self.selection: list[int] | None = None
        self.cancelled = False
        # The announce payload is kept so /pending can re-serve it after a
        # page reload; the deadline lets that route report a live countdown.
        self.payload = dict(payload) if payload else {}
        self.deadline = deadline


def _store() -> dict:
    """Pending and remembered state, attached to the live PromptServer so a
    module reload (ComfyUI-Manager, dev restarts) keeps sharing one copy."""
    from server import PromptServer

    server = PromptServer.instance
    store = getattr(server, "_ausboss_frame_chooser", None)
    if store is None:
        store = {"pending": {}, "remembered": {}, "lock": threading.Lock()}
        server._ausboss_frame_chooser = store
    return store


def recall_selection(node_id: str) -> list[int] | None:
    """Previous answer for this node id, or None when it never answered."""
    store = _store()
    with store["lock"]:
        remembered = store["remembered"].get(str(node_id))
    return list(remembered) if remembered is not None else None


def remember_selection(node_id: str, selection: list[int]) -> None:
    store = _store()
    with store["lock"]:
        store["remembered"][str(node_id)] = list(selection)


def await_selection(
    node_id: str,
    frame_count: int,
    files: list[dict],
    previous: list[int] | None,
    timeout_seconds: int = 0,
    on_timeout: str = TIMEOUT_KEEP_ALL,
) -> list[int]:
    """Announce the pause to the browser and block until it answers.

    Returns the validated one-based selection ([] = keep all). Raises
    InterruptProcessingException when the browser cancels or the queue is
    interrupted, so ComfyUI unwinds the run exactly like pressing stop.

    With timeout_seconds > 0 the wait also arms a countdown: once per second
    a TICK_EVENT ({node_id, remaining}) refreshes the panel's timer, and on
    expiry the on_timeout policy answers instead of the browser (the cancel
    policy raises the same interrupt as pressing stop)."""
    import comfy.model_management as model_management
    from server import PromptServer

    store = _store()
    key = str(node_id)
    count = int(frame_count)
    deadline = None
    if int(timeout_seconds) > 0:
        deadline = time.monotonic() + int(timeout_seconds)
    payload = {
        "node_id": key,
        "urls": files,
        "count": count,
        "previous": list(previous) if previous else [],
        "timeout_seconds": int(timeout_seconds),
        "on_timeout": str(on_timeout),
    }
    pending = _PendingChoice(count, payload=payload, deadline=deadline)
    with store["lock"]:
        store["pending"][key] = pending
    try:
        PromptServer.instance.send_sync(EVENT_NAME, payload)
        last_tick = None
        while not pending.event.wait(POLL_SECONDS):
            if model_management.processing_interrupted():
                raise model_management.InterruptProcessingException()
            if deadline is None:
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fallback = resolve_timeout_policy(str(on_timeout), count)
                if fallback is None:
                    raise model_management.InterruptProcessingException()
                _send_done(key, fallback, count, "timeout")
                return list(fallback)
            whole = math.ceil(remaining)
            if whole != last_tick:
                last_tick = whole
                PromptServer.instance.send_sync(
                    TICK_EVENT, {"node_id": key, "remaining": whole}
                )
        if pending.cancelled:
            raise model_management.InterruptProcessingException()
        answer = list(pending.selection or [])
        # Every open tab hears how the pause resolved: stale panels release
        # and the pick_list widget receives the answer for headless reruns.
        _send_done(key, answer, count, "answered")
        return answer
    finally:
        with store["lock"]:
            store["pending"].pop(key, None)


def _send_done(node_id: str, selection: list[int], frame_count: int, reason: str) -> None:
    """Tell every open tab how a pause resolved (panel release + writeback)."""
    from server import PromptServer

    kept = effective_indices(list(selection), int(frame_count))
    PromptServer.instance.send_sync(
        DONE_EVENT,
        {
            "node_id": str(node_id),
            "indices": indices_string(kept),
            "kept": len(kept),
            "count": int(frame_count),
            "reason": str(reason),
        },
    )


def register_chooser_route() -> None:
    """POST /ausboss/frame_chooser answers or cancels a paused chooser;
    GET /ausboss/frame_chooser/pending lists the pauses a reloaded page
    must re-render."""
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    server = getattr(PromptServer, "instance", None)
    if server is None or getattr(server, "_ausboss_chooser_route", False):
        return
    server._ausboss_chooser_route = True

    @server.routes.get("/ausboss/frame_chooser/pending")
    async def ausboss_frame_chooser_pending(request):
        store = _store()
        with store["lock"]:
            waiting = list(store["pending"].values())
        now = time.monotonic()
        entries = []
        for pending in waiting:
            entry = dict(pending.payload)
            if pending.deadline is not None:
                entry["remaining"] = max(0, math.ceil(pending.deadline - now))
            entries.append(entry)
        return web.json_response({"pending": entries})

    @server.routes.post("/ausboss/frame_chooser")
    async def ausboss_frame_chooser(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "The request body must be JSON."}, status=400)
        node_id = str(data.get("node_id", ""))
        action = data.get("action", "")
        store = _store()
        with store["lock"]:
            pending = store["pending"].get(node_id)
        if pending is None:
            return web.json_response(
                {"error": "No Frame Chooser is paused under that id."}, status=404
            )
        if action == "cancel":
            pending.cancelled = True
            pending.event.set()
            return web.json_response({"status": "cancelled"})
        if action == "continue":
            try:
                selection = normalize_selection(data.get("selected", []), pending.frame_count)
            except ValueError as exc:
                return web.json_response({"error": str(exc)}, status=400)
            pending.selection = selection
            pending.event.set()
            return web.json_response(
                {
                    "status": "continued",
                    "kept": len(effective_indices(selection, pending.frame_count)),
                }
            )
        return web.json_response({"error": "Action must be 'continue' or 'cancel'."}, status=400)


__all__ = [
    "DONE_EVENT",
    "EVENT_NAME",
    "POLL_SECONDS",
    "THUMBNAIL_SUBFOLDER",
    "TICK_EVENT",
    "TIMEOUT_CANCEL",
    "TIMEOUT_KEEP_ALL",
    "TIMEOUT_KEEP_FIRST",
    "TIMEOUT_KEEP_LAST",
    "TIMEOUT_POLICIES",
    "await_selection",
    "effective_indices",
    "indices_string",
    "keep_frames",
    "normalize_selection",
    "parse_pick_list",
    "pick_list_fingerprint",
    "recall_selection",
    "register_chooser_route",
    "remember_selection",
    "resolve_timeout_policy",
    "usable_remembered",
    "write_thumbnails",
]
