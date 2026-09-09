"""Run Timer 🆎 — how long the last queue took, on the canvas."""

from __future__ import annotations


class AusBossRunTimer:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A stopwatch for the whole run. It starts when a queued prompt "
        "begins executing, ticks on the node while it runs, and holds the "
        "total when it finishes — with the previous few runs kept underneath "
        "so a settings change can be judged against the last one. The times "
        "are saved with the workflow, so a shared graph carries its author's "
        "run time as a reference. No inputs, no outputs; it listens to the "
        "queue rather than sitting on a wire."
    )
    SEARCH_ALIASES = ["timer", "run time", "stopwatch", "elapsed", "benchmark", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"

    def noop(self):
        # Never reached: with no outputs the node is not part of any prompt.
        return ()


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_RunTimer": AusBossRunTimer}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_RunTimer": "Run Timer 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
