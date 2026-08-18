"""Select Frame 🆎."""

from __future__ import annotations

from ._batch_helpers import select_one_based_frame
from ._preview_helpers import preview_payload, temp_prefix


class AusBossSelectFrame:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Selects one frame from an IMAGE batch with a one-based frame number. "
        "The selected frame is returned unchanged as a one-image batch."
    )
    SEARCH_ALIASES = ["frame select", "pick video frame", "image batch", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "Video frames or any other BHWC IMAGE batch."},
                ),
                "frame_number": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": "One-based frame number: 1 selects the first frame.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The selected frame as a one-image BHWC batch.",)
    FUNCTION = "select_frame"

    def __init__(self):
        self._prefix = temp_prefix("select_frame")

    def select_frame(self, frames, frame_number):
        selected = select_one_based_frame(frames, frame_number)
        return preview_payload(selected, self._prefix, "Select Frame", (selected,))


# No legacy "Frame Select" alias: that ID belongs to RES4LYF, whose node is
# zero-based with a differently named widget, so an alias either loses the
# load-order race or silently changes which frame old workflows select.
NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_SelectFrame": AusBossSelectFrame}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_SelectFrame": "Select Frame 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
