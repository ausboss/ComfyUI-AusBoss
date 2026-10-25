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
