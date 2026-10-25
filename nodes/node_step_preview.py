"""Step Preview 🆎 - watch the picture form while it is being made."""

from __future__ import annotations

from ._step_preview_helpers import register_step_preview_handler


class AusBossStepPreview:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Shows the picture while it is being made, one step at a time, with "
        "a Stop button. If it is going wrong, stop it early instead of "
        "waiting for the last step. Put it anywhere: it needs no wires and "
        "shows whatever the workflow is making. A workflow with this node "
        "asks ComfyUI for the step pictures by itself, unless you chose a "
        "preview method in ComfyUI's settings."
    )
    SEARCH_ALIASES = [
        "live preview",
        "step preview",
        "sampler preview",
        "progress",
        "watch",
        "stop",
        "cancel",
        "interrupt",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"

    def noop(self):
        # Never reached: with no outputs the node is not run. It is still in
        # the queued prompt, which is how the server knows to make the steps.
        return ()


register_step_preview_handler()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_StepPreview": AusBossStepPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_StepPreview": "Step Preview 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
