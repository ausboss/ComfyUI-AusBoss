"""Select Frame Range (AusBoss)."""

from __future__ import annotations

from ._batch_helpers import select_one_based_frame_range


NODE_ID = "AUSBOSS_NODES_SelectFrameRange"


class AusBossSelectFrameRange:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Selects a contiguous run of frames from an IMAGE batch with a "
        "one-based start frame and a frame count. A count of 0 keeps every "
        "frame through the last one. The frames are returned unchanged."
    )
    SEARCH_ALIASES = ["frame range", "sub batch", "trim frames", "cut frames", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "Video frames or any other BHWC IMAGE batch."},
                ),
                "start_frame": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": "One-based first frame of the range: 1 starts at the first frame.",
                    },
                ),
                "frame_count": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": (
                            "How many frames to keep from start_frame. 0 means "
                            "through the last frame; an explicit count past the "
                            "end stops with the available range."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("images", "frame_count")
    OUTPUT_TOOLTIPS = (
        "The selected frames as an unchanged BHWC sub-batch.",
        "The actual number of frames in the sub-batch.",
    )
    FUNCTION = "select_frame_range"

    def select_frame_range(self, images, start_frame, frame_count):
        selected = select_one_based_frame_range(images, start_frame, frame_count)
        return (selected, int(selected.shape[0]))


NODE_CLASS_MAPPINGS = {NODE_ID: AusBossSelectFrameRange}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "Select Frame Range (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
