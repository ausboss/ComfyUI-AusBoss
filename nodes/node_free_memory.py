"""Free Memory 🆎."""

from __future__ import annotations

from ._memory_helpers import WILDCARD, free_gpu_memory


class AusBossFreeMemory:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Passes any wire through unchanged and, on the way, unloads comfy's "
        "cached models and empties the CUDA cache — put it between a heavy "
        "stage and the next so the second starts with free VRAM instead of "
        "an out-of-memory error. Every release step is best-effort: if an "
        "API is missing or moves, that step is skipped and the wire still "
        "flows. Like any node it only runs when its input changes, so it "
        "never breaks caching downstream."
    )
    SEARCH_ALIASES = ["free vram", "purge vram", "unload models", "empty cache", "cleanup", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    WILDCARD,
                    {
                        "tooltip": (
                            "Any wire. Memory is freed when this node runs, then "
                            "the value continues unchanged."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = (WILDCARD,)
    RETURN_NAMES = ("value",)
    OUTPUT_TOOLTIPS = ("The input, passed through unchanged.",)
    FUNCTION = "free_memory"

    def free_memory(self, value):
        freed = free_gpu_memory()
        detail = ", ".join(freed) if freed else "nothing to free"
        # Runtime log, not import-time, so the emoji rule does not apply -
        # but ASCII is kept anyway for cp1252 consoles.
        print(f"[AusBoss] Free Memory: {detail}.")
        return (value,)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_FreeMemory": AusBossFreeMemory}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_FreeMemory": "Free Memory 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
