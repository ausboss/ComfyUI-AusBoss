"""Frame Chooser helpers: selection math, thumbnails, and pause plumbing.

The pure functions at the top are covered by offline unit tests. Everything
that talks to ComfyUI (thumbnail files, the websocket announcement, the
answer route, the blocking wait) imports server modules lazily so this file
stays importable without ComfyUI installed.

Deciding a pause is deliberately not part of that: claim_pause and
answer_pending take the store as an argument and touch no server module, so
the races between a second click, a cancel chasing a continue, and the
countdown expiring are all reachable from tests with real threads.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import re
import secrets
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

# The three ways a pause can end. Exactly one is ever recorded against it.
RESOLVED_CONTINUE = "continue"
RESOLVED_CANCEL = "cancel"
RESOLVED_TIMEOUT = "timeout"

ALREADY_RESOLVED = (
    "This Frame Chooser pause was already resolved - the answer that got "
    "there first stands."
)


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


def _is_frame_number(token: str) -> bool:
    """True for a token int() will actually accept.

    str.isdigit() is true for characters int() rejects outright, and for
    others it silently converts - a superscript pasted from a caption threw
    a raw ValueError out of IS_CHANGED, and an Arabic-Indic digit was read
    as a frame number nobody typed. ASCII is the only spelling of a frame
    index this widget means."""
    return token.isascii() and token.isdigit()


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
        if not _is_frame_number(token):
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
    if tokens and all(_is_frame_number(token) for token in tokens):
        canonical = ",".join(str(value) for value in sorted({int(t) for t in tokens}))
    else:
        canonical = ",".join(tokens)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"picks:{digest}"


def token_matches(expected, supplied) -> bool:
    """True only when a response carries this pause's own token.

    Both sides must be non-empty strings; comparison is constant-time. A
    stale panel (earlier pause, second tab left behind, reloaded page that
    never re-fetched) fails this check and can never resolve the wrong
    pause."""
    if not isinstance(expected, str) or not isinstance(supplied, str):
        return False
    if not expected or not supplied:
        return False
    # compare_digest raises on non-ASCII text rather than returning False, so
    # a token with an accent in it would leave the route throwing a 500 and
    # the pause stranded. Our tokens are always token_urlsafe output; anything
    # else is simply not this pause's token.
    if not expected.isascii() or not supplied.isascii():
        return False
    return hmac.compare_digest(expected, supplied)


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

    __slots__ = ("event", "frame_count", "resolution", "payload", "deadline", "token")

    def __init__(
        self,
        frame_count: int,
        payload: dict | None = None,
        deadline: float | None = None,
        token: str = "",
    ):
        self.event = threading.Event()
        self.frame_count = int(frame_count)
        # The single terminal outcome, written exactly once by claim_pause:
        # (RESOLVED_*, selection) once some path has ended this pause, None
        # while it is still waiting.
        self.resolution: tuple[str, list[int] | None] | None = None
        # The announce payload is kept so /pending can re-serve it after a
        # page reload; the deadline lets that route report a live countdown.
        self.payload = dict(payload) if payload else {}
        self.deadline = deadline
        # Per-pause random token: answers must echo it, so a stale panel or
        # second tab can never resolve a pause it was not shown.
        self.token = str(token)


def new_store() -> dict:
    """A fresh chooser store: the pending pauses, the remembered picks, and
    the one lock every terminal decision is taken under."""
    return {"pending": {}, "remembered": {}, "lock": threading.Lock()}


def claim_pause(store: dict, pending, outcome: str, selection=None) -> bool:
    """Record the one terminal outcome a paused chooser is allowed.

    Continue, cancel and the expiring countdown all race for the same pause:
    two clicks a frame apart, Escape chasing Enter, a POST landing as the
    timer runs out, a node deleted mid-request. The winner is whichever path
    reaches this first while holding ``store["lock"]``; every later claim
    returns False and must then change nothing - not the selection, not the
    result it reports back. The waiter is woken after the lock is released so
    it never has to queue behind the claimer to read what was decided."""
    with store["lock"]:
        if pending.resolution is not None:
            return False
        pending.resolution = (
            str(outcome),
            list(selection) if selection is not None else None,
        )
    pending.event.set()
    return True


def read_resolution(store: dict, pending) -> tuple[str, list[int] | None]:
    """How a pause ended, read under the lock that wrote it.

    An unresolved pause reads as a cancel: the only way to reach here without
    a claim is the wait loop unwinding, and releasing a graph on a selection
    nobody chose would be worse than stopping."""
    with store["lock"]:
        return pending.resolution or (RESOLVED_CANCEL, None)


def resumable_pauses(store: dict) -> list:
    """The pauses a reloaded page should re-render.

    A resolved pause lingers in the map until its waiter unwinds; re-serving
    it would hand the page a panel whose only possible answer is 410."""
    with store["lock"]:
        return [p for p in store["pending"].values() if p.resolution is None]


def answer_pending(store: dict, node_id, data: dict) -> tuple[int, dict]:
    """Decide one POST to the answer route; returns (status, body).

    Split out of the aiohttp handler so the races it has to survive are
    reachable from offline tests with real threads. A pause that is already
    resolved answers 410 rather than a second success: the browser that lost
    the race must never be told its answer is the one that took effect."""
    if not isinstance(data, dict):
        return 400, {"error": "The request body must be a JSON object."}
    key = str(node_id)
    with store["lock"]:
        pending = store["pending"].get(key)
    if pending is None:
        return 404, {"error": "No Frame Chooser is paused under that id."}
    if not token_matches(pending.token, data.get("token")):
        return 409, {
            "error": (
                "This Frame Chooser answer belongs to an older pause. "
                "Refresh the page and answer the currently paused panel."
            )
        }
    action = data.get("action", "")
    if action == "cancel":
        if not claim_pause(store, pending, RESOLVED_CANCEL):
            return 410, {"error": ALREADY_RESOLVED}
        return 200, {"status": "cancelled"}
    if action == "continue":
        try:
            selection = normalize_selection(data.get("selected", []), pending.frame_count)
        except ValueError as exc:
            # Rejected before any claim, so a malformed answer leaves the
            # pause open: a corrected one - or the cancel a deleted node
            # sends - can still release the graph.
            return 400, {"error": str(exc)}
        if not claim_pause(store, pending, RESOLVED_CONTINUE, selection):
            return 410, {"error": ALREADY_RESOLVED}
        return 200, {
            "status": "continued",
            "kept": len(effective_indices(selection, pending.frame_count)),
        }
    return 400, {"error": "Action must be 'continue' or 'cancel'."}


def _store() -> dict:
    """Pending and remembered state, attached to the live PromptServer so a
    module reload (ComfyUI-Manager, dev restarts) keeps sharing one copy."""
    from server import PromptServer

    server = PromptServer.instance
    store = getattr(server, "_ausboss_frame_chooser", None)
    if store is None:
        store = new_store()
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
        "token": secrets.token_urlsafe(24),
        "urls": files,
        "count": count,
        "previous": list(previous) if previous else [],
        "timeout_seconds": int(timeout_seconds),
        "on_timeout": str(on_timeout),
    }
    pending = _PendingChoice(
        count,
        payload=payload,
        deadline=deadline,
        token=payload["token"],
    )
    with store["lock"]:
        store["pending"][key] = pending
    try:
        PromptServer.instance.send_sync(EVENT_NAME, payload)
        last_tick = None
        while not pending.event.wait(POLL_SECONDS):
            if model_management.processing_interrupted():
                # Stopping the queue outranks the panel. Claim first so an
                # answer landing in this same instant is told the pause is
                # gone instead of that it succeeded, then unwind either way:
                # a graph the user stopped must not run on regardless of who
                # reached the claim.
                claim_pause(store, pending, RESOLVED_CANCEL)
                raise model_management.InterruptProcessingException()
            if deadline is None:
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fallback = resolve_timeout_policy(str(on_timeout), count)
                # Losing this claim is not an error: an answer arrived as the
                # timer expired, and the read below reports whichever outcome
                # the store actually recorded.
                claim_pause(
                    store,
                    pending,
                    RESOLVED_TIMEOUT if fallback is not None else RESOLVED_CANCEL,
                    fallback,
                )
                break
            whole = math.ceil(remaining)
            if whole != last_tick:
                last_tick = whole
                PromptServer.instance.send_sync(
                    TICK_EVENT,
                    {"node_id": key, "token": pending.token, "remaining": whole},
                )
        outcome, selection = read_resolution(store, pending)
        if outcome == RESOLVED_CANCEL:
            raise model_management.InterruptProcessingException()
        answer = list(selection or [])
        # Every open tab hears how the pause resolved: stale panels release
        # and the pick_list widget receives the answer for headless reruns.
        _send_done(
            key,
            pending.token,
            answer,
            count,
            "timeout" if outcome == RESOLVED_TIMEOUT else "answered",
        )
        return answer
    finally:
        with store["lock"]:
            # Only this run's own pause: a re-queue can already have put a
            # fresh one under the same node id.
            if store["pending"].get(key) is pending:
                del store["pending"][key]


def done_payload(
    node_id: str,
    token: str,
    selection: list[int],
    frame_count: int,
    reason: str,
) -> dict:
    """The DONE_EVENT body describing how a pause resolved.

    ``indices`` carries the answer exactly as it was given, so keep-all stays
    the empty string it was posted as. Expanding it to "1,2,...,N" pins a
    batch-size-independent answer to the batch it happened to be given: the
    panel writes that string into pick_list, and the next run then either
    drops the frames the enumeration does not reach or fails outright on a
    shorter batch. ``kept`` is the resolved count, which is what the panel
    reports to the user."""
    answer = list(selection)
    return {
        "node_id": str(node_id),
        "token": str(token),
        "indices": indices_string(answer),
        "kept": len(effective_indices(answer, int(frame_count))),
        "count": int(frame_count),
        "reason": str(reason),
    }


def _send_done(
    node_id: str,
    token: str,
    selection: list[int],
    frame_count: int,
    reason: str,
) -> None:
    """Tell every open tab how a pause resolved (panel release + writeback)."""
    from server import PromptServer

    PromptServer.instance.send_sync(
        DONE_EVENT,
        done_payload(node_id, token, selection, frame_count, reason),
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
        waiting = resumable_pauses(_store())
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
        # Valid JSON is not necessarily an object: a bare list or number would
        # reach .get() and throw a 500 out of the handler.
        if not isinstance(data, dict):
            return web.json_response(
                {"error": "The request body must be a JSON object."}, status=400
            )
        status, body = answer_pending(_store(), data.get("node_id", ""), data)
        return web.json_response(body, status=status)


__all__ = [
    "ALREADY_RESOLVED",
    "DONE_EVENT",
    "EVENT_NAME",
    "POLL_SECONDS",
    "RESOLVED_CANCEL",
    "RESOLVED_CONTINUE",
    "RESOLVED_TIMEOUT",
    "THUMBNAIL_SUBFOLDER",
    "TICK_EVENT",
    "TIMEOUT_CANCEL",
    "TIMEOUT_KEEP_ALL",
    "TIMEOUT_KEEP_FIRST",
    "TIMEOUT_KEEP_LAST",
    "TIMEOUT_POLICIES",
    "answer_pending",
    "await_selection",
    "claim_pause",
    "done_payload",
    "effective_indices",
    "indices_string",
    "keep_frames",
    "new_store",
    "normalize_selection",
    "parse_pick_list",
    "pick_list_fingerprint",
    "read_resolution",
    "recall_selection",
    "register_chooser_route",
    "remember_selection",
    "resumable_pauses",
    "resolve_timeout_policy",
    "token_matches",
    "usable_remembered",
    "write_thumbnails",
]
