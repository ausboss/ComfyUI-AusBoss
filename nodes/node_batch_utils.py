"""Select Every Nth, Split Batch and Merge Batches 🆎 — IMAGE batch surgery.

One tight family: thin every nth frame out of a batch, cut a batch in two,
and join two batches into one. The shared tensor logic lives in
``_batch_helpers`` next to Select Frame's.
"""

from __future__ import annotations

from ._batch_helpers import (
    MERGE_MISMATCH_MODES,
    merge_batches,
    select_every_nth,
    split_batch,
)


class AusBossSelectEveryNth:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Keeps every nth frame of an IMAGE batch — halve a video's frame "
        "count before an expensive stage, or thin a sweep down to samples. "
        "offset skips that many frames before the first kept one, so "
        "nth 2 / offset 0 keeps frames 1, 3, 5 and offset 1 keeps 2, 4, 6."
    )
    SEARCH_ALIASES = ["every nth", "skip frames", "thin batch", "reduce frames", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "The BHWC IMAGE batch to thin out."},
                ),
                "nth": (
                    "INT",
                    {
                        "default": 2,
                        "min": 1,
                        "max": 4096,
                        "step": 1,
                        "tooltip": "Keep one frame in every nth: 2 keeps every other frame.",
                    },
                ),
                "offset": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": "Frames to skip before the first kept frame.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_TOOLTIPS = ("The kept frames, in their original order.",)
    FUNCTION = "select"

    def select(self, images, nth, offset):
        return (select_every_nth(images, nth, offset),)


class AusBossSplitBatch:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Splits an IMAGE batch in two after a one-based frame index: frames "
        "1 through index come out as a, the rest as b — send a clip's halves "
        "to different treatments, or peel leading frames off a batch. Both "
        "sides must keep at least one frame."
    )
    SEARCH_ALIASES = ["split batch", "divide batch", "cut batch", "batch halves", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "The BHWC IMAGE batch to split."},
                ),
                "index": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 2_147_483_647,
                        "step": 1,
                        "tooltip": (
                            "One-based split point: frames 1 through index go to a, "
                            "the rest to b."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("a", "b")
    OUTPUT_TOOLTIPS = (
        "Frames 1 through index.",
        "The remaining frames.",
    )
    FUNCTION = "split"

    def split(self, images, index):
        return split_batch(images, index)


class AusBossMergeBatches:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Joins two IMAGE batches into one, a's frames first — reassemble a "
        "split batch, or append a comparison strip to a run. When the two "
        "resolutions differ, on_mismatch picks which side is resized "
        "(bilinear) or refuses with both sizes named; channel counts must "
        "already match."
    )
    SEARCH_ALIASES = ["merge batches", "join batches", "concat images", "combine batch", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "a": (
                    "IMAGE",
                    {"tooltip": "The first batch; its frames come first in the result."},
                ),
                "b": (
                    "IMAGE",
                    {"tooltip": "The second batch, appended after a's frames."},
                ),
                "on_mismatch": (
                    list(MERGE_MISMATCH_MODES),
                    {
                        "default": "resize to a",
                        "tooltip": (
                            "When the sizes differ: resize b's frames to a's size, "
                            "resize a's to b's, or stop with an error."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_TOOLTIPS = ("One batch: a's frames followed by b's.",)
    FUNCTION = "merge"

    def merge(self, a, b, on_mismatch):
        return (merge_batches(a, b, on_mismatch),)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_SelectEveryNth": AusBossSelectEveryNth,
    "AUSBOSS_NODES_SplitBatch": AusBossSplitBatch,
    "AUSBOSS_NODES_MergeBatches": AusBossMergeBatches,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_SelectEveryNth": "Select Every Nth 🆎",
    "AUSBOSS_NODES_SplitBatch": "Split Batch 🆎",
    "AUSBOSS_NODES_MergeBatches": "Merge Batches 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
