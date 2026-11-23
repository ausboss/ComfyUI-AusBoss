"""Step pictures for the runs that show them.

ComfyUI makes a picture after every sampling step only when the run's
preview method is something other than `none`, and a fresh install starts
with `none` (`--preview-method`). The frontend's own setting, "Live preview
method", sends `default` unless the user picked one, which means "the
server's flag".

So when a queued workflow holds a Step Preview node, or a Save Image or
Save Video with its steps switch on, the pack asks for the cheap preview
(`auto`) for that one run. It never overrides a method the user chose in
the frontend, and never one the server was started with: only "nothing
chosen anywhere" becomes `auto`. ComfyUI resets the method at the start of
every run, so nothing carries over to the next one.
"""

from __future__ import annotations

STEP_PREVIEW_NODE = "AUSBOSS_NODES_StepPreview"
# The save nodes whose picture area can show the steps, and their switch.
STEP_SWITCH_NODES = ("AUSBOSS_NODES_SaveImage", "AUSBOSS_NODES_SaveVideo")
STEP_SWITCH = "step_preview"
# What the switch holds when a workflow or an API prompt leaves it out.
STEP_PREVIEW_DEFAULT = False
# The method asked for: ComfyUI's quick one, which every image model has.
STEP_METHOD = "auto"
# What the frontend sends when the user picked nothing.
UNCHOSEN = (None, "", "default")


def _switch_on(value, default: bool) -> bool:
    if value is None:
        return default
    # A linked switch is decided by another node during the run: show the
    # steps rather than guess they are off.
    if isinstance(value, (list, tuple)):
        return True
    return value is True


def wants_step_pictures(prompt) -> bool:
    """Whether any node in an API prompt shows the steps of the run."""
    if not isinstance(prompt, dict):
        return False
    for entry in prompt.values():
        if not isinstance(entry, dict):
            continue
        kind = entry.get("class_type")
        if kind == STEP_PREVIEW_NODE:
            return True
        if kind in STEP_SWITCH_NODES:
            inputs = entry.get("inputs") if isinstance(entry.get("inputs"), dict) else {}
            # Save Image with its picture switched off has nowhere to show them.
            if inputs.get("preview") is False:
                continue
            if _switch_on(inputs.get(STEP_SWITCH), STEP_PREVIEW_DEFAULT):
                return True
    return False


def ask_for_step_pictures(json_data, server_method: str | None):
    """Set `auto` on a queued prompt that shows its steps, when nobody chose.

    `json_data` is the body of POST /prompt; `server_method` is the method
    ComfyUI was started with (`none` on a fresh install). Returns the same
    object, changed or not.
    """
    if not isinstance(json_data, dict) or not wants_step_pictures(json_data.get("prompt")):
        return json_data
    if server_method not in UNCHOSEN and server_method != "none":
        return json_data
    extra = json_data.get("extra_data")
    if extra is None:
        extra = json_data["extra_data"] = {}
    if not isinstance(extra, dict) or extra.get("preview_method") not in UNCHOSEN:
        return json_data
    extra["preview_method"] = STEP_METHOD
    return json_data


def _server_method() -> str | None:
    try:
        from latent_preview import default_preview_method
    except Exception:
        return None
    return str(getattr(default_preview_method, "value", default_preview_method))


def register_step_preview_handler() -> None:
    """Hook ask_for_step_pictures onto every queued prompt, once per server."""
    try:
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None or getattr(instance, "_ausboss_step_preview", False):
        return
    if not callable(getattr(instance, "add_on_prompt_handler", None)):
        return
    instance._ausboss_step_preview = True

    def handler(json_data):
        try:
            return ask_for_step_pictures(json_data, _server_method())
        except Exception:
            # Never in the way of a run: it simply goes without step pictures.
            return json_data

    instance.add_on_prompt_handler(handler)
    register_moving_step_pictures()


# --- Moving step pictures for video models --------------------------------
#
# ComfyUI's step picture of a clip is its first frame only. For a run that
# shows its steps (the same runs as above), the pack also sends about one
# frame per second of the clip after each step, and the step overlay plays
# them in a loop (js/shared/step_preview.mjs).
#
# The frames come from the previewer ComfyUI picked for the run (the quick
# color estimate under `auto`, or a tiny video decoder from
# `models/vae_approx` when the user chose TAESD), one frame per call, which
# is exactly the call ComfyUI makes for the first frame. So the peak memory
# of a decode stays what it already was, and nothing is loaded that was not.

FRAMES_EVENT = "ausboss.step_frames"
# The frame rate the frame picks assume; H3, LTX and most video models make 24.
CLIP_FPS = 24
# About one picture per second of the clip, as many as this at most.
FRAMES_PER_SECOND = 1
MAX_FRAMES = 16
JPEG_QUALITY = 80
# The frames take at most this share of the run's time: a slow decoder
# (the tiny video decoder on a small card) skips steps, and the loop keeps
# playing the frames it has.
FRAME_BUDGET = 0.1


def frame_picks(latent_frames, temporal_ratio, *, clip_fps=CLIP_FPS, per_second=FRAMES_PER_SECOND, cap=MAX_FRAMES):
    """The latent frames to show, and the clip seconds between two of them.

    A clip latent holds one frame for every `temporal_ratio` frames of the
    clip. Returns ([], 0.0) when there is nothing to move.
    """
    try:
        count = int(latent_frames)
        ratio = max(1, int(temporal_ratio or 1))
    except (TypeError, ValueError):
        return [], 0.0
    if count < 2 or cap < 2:
        return [], 0.0
    stride = max(1, round(clip_fps / max(per_second, 1e-6) / ratio))
    picks = list(range(0, count, stride))
    if len(picks) < 2:
        picks = [0, count - 1]
    if len(picks) > cap:
        picks = sorted({round(index * (count - 1) / (cap - 1)) for index in range(cap)})
    gap = (picks[-1] - picks[0]) / (len(picks) - 1)
    return picks, gap * ratio / clip_fps


def _jpeg_data_url(picture, max_side: int) -> str:
    import base64
    import io

    from PIL import ImageOps

    if max_side and max(picture.size) > max_side:
        picture = ImageOps.contain(picture, (max_side, max_side))
    buffer = io.BytesIO()
    picture.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


class MovingStepPictures:
    """ComfyUI's previewer for one sampler, plus the clip's frames each step.

    Everything else is the previewer it wraps: ComfyUI's own step picture
    and every attribute pass through unchanged.
    """

    def __init__(self, inner, latent_format, send, where, max_side=512, clock=None):
        import time

        self.inner = inner
        self.clock = clock or time.perf_counter
        # How long the last frames took to make, and when they were sent.
        self.cost = 0.0
        self.sent_at = None
        self.ratio = getattr(latent_format, "temporal_downscale_ratio", 1) or 1
        self.send = send
        self.where = where
        self.max_side = max_side
        self.failed = False

    def __getattr__(self, name):
        # Only reached for names this class does not have.
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)

    def frames(self, x0):
        """The clip's frames as JPEG data URLs, and the seconds between them."""
        if getattr(x0, "ndim", 0) != 5:
            return [], 0.0
        picks, seconds = frame_picks(x0.shape[2], self.ratio)
        if not picks:
            return [], 0.0
        return [_jpeg_data_url(self.inner.decode_latent_to_preview(x0[:1, :, index:index + 1]), self.max_side) for index in picks], seconds

    def due(self, now) -> bool:
        """Whether making frames now keeps them within FRAME_BUDGET."""
        return self.sent_at is None or self.cost <= FRAME_BUDGET * (now - self.sent_at)

    def decode_latent_to_preview_image(self, preview_format, x0):
        now = self.clock()
        if not self.failed and self.due(now):
            try:
                frames, seconds = self.frames(x0)
                self.cost = self.clock() - now
                self.sent_at = now
                if frames:
                    prompt_id, node_id = self.where()
                    self.send(FRAMES_EVENT, {"prompt_id": prompt_id, "node": node_id, "frames": frames, "seconds": seconds})
            except Exception:
                # A previewer that cannot do single frames: the still stays.
                self.failed = True
        return self.inner.decode_latent_to_preview_image(preview_format, x0)


def _running_prompt():
    """The API prompt of the run executing now, or None."""
    from comfy_execution.utils import get_executing_context
    from server import PromptServer

    context = get_executing_context()
    queue = getattr(PromptServer.instance, "prompt_queue", None)
    running = getattr(queue, "currently_running", None)
    if context is None or not isinstance(running, dict):
        return None
    for item in list(running.values()):
        if isinstance(item, (list, tuple)) and len(item) > 2 and item[1] == context.prompt_id:
            return item[2]
    return None


def _where():
    from comfy_execution.utils import get_executing_context

    context = get_executing_context()
    return (context.prompt_id, context.node_id) if context else (None, None)


def _send(event, data):
    from server import PromptServer

    instance = PromptServer.instance
    instance.send_sync(event, data, getattr(instance, "client_id", None))


def register_moving_step_pictures() -> None:
    """Wrap ComfyUI's previewer choice once, so clips can move."""
    try:
        import latent_preview
    except Exception:
        return
    original = getattr(latent_preview, "get_previewer", None)
    if not callable(original) or getattr(original, "_ausboss_moving", False):
        return

    def get_previewer(device, latent_format):
        previewer = original(device, latent_format)
        try:
            if previewer is not None and getattr(latent_format, "latent_dimensions", 2) == 3 and wants_step_pictures(_running_prompt()):
                return MovingStepPictures(previewer, latent_format, _send, _where, getattr(latent_preview, "MAX_PREVIEW_RESOLUTION", 512))
        except Exception:
            pass
        return previewer

    get_previewer._ausboss_moving = True
    latent_preview.get_previewer = get_previewer
