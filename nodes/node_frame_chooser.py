"""Frame Chooser (AusBoss)."""

from __future__ import annotations

import uuid

from ._chooser_helpers import (
    TIMEOUT_KEEP_ALL,
    TIMEOUT_POLICIES,
    await_selection,
    effective_indices,
    indices_string,
    keep_frames,
    normalize_selection,
    parse_pick_list,
    pick_list_fingerprint,
    recall_selection,
    register_chooser_route,
    remember_selection,
    usable_remembered,
    write_thumbnails,
)


NODE_ID = "AUSBOSS_NODES_FrameChooser"

BEHAVIOR_PAUSE = "always pause"
BEHAVIOR_REMEMBER = "keep last selection"

# IS_CHANGED tokens: one counter per node id, bumped once per queue (ComfyUI
# caches the value in the prompt), so a chooser re-runs and re-pauses even
# when none of its widgets changed between queues.
_RUN_COUNTERS: dict[str, int] = {}


class AusBossFrameChooser:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Pauses the running graph and shows every incoming frame as a clickable "
        "filmstrip on the node. Click the frames to keep and press Keep selected; "
        "the graph resumes with just those frames in their original order. An "
        "empty selection keeps every frame, and 'keep last selection' re-applies "
        "the previous answer without pausing."
    )
    SEARCH_ALIASES = ["pick frames", "pause", "choose frames", "filmstrip", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "Video frames or any other BHWC IMAGE batch to choose from."},
                ),
                "behavior": (
                    [BEHAVIOR_PAUSE, BEHAVIOR_REMEMBER],
                    {
                        "default": BEHAVIOR_PAUSE,
                        "tooltip": (
                            "'always pause' stops every run until you answer; 'keep last "
                            "selection' re-applies this node's previous answer without "
                            "pausing, and only pauses when no previous answer fits."
                        ),
                    },
                ),
                "preview_max_size": (
                    "INT",
                    {
                        "default": 256,
                        "min": 64,
                        "max": 1024,
                        "step": 32,
                        "tooltip": (
                            "Longest edge of the filmstrip thumbnails. Smaller encodes and "
                            "loads faster; the full-resolution frames are untouched."
                        ),
                    },
                ),
            },
            "optional": {
                "timeout_seconds": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 86400,
                        "tooltip": (
                            "How long a pause waits for an answer before on_timeout "
                            "decides. 0 waits forever. While counting down, the panel "
                            "shows the seconds left."
                        ),
                    },
                ),
                "on_timeout": (
                    TIMEOUT_POLICIES,
                    {
                        "default": TIMEOUT_KEEP_ALL,
                        "tooltip": (
                            "What an expired countdown answers: keep every frame, only "
                            "the first, only the last, or cancel the run like pressing "
                            "stop. Ignored while timeout_seconds is 0."
                        ),
                    },
                ),
                "pick_list": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "One-based frame numbers, e.g. '1,4,9'. When filled, the "
                            "node applies them immediately without pausing. Under "
                            "'keep last selection', answering a pause fills this in "
                            "for you so the next run repeats the choice headlessly; "
                            "clear it to pause again. Under 'always pause' nothing is "
                            "written here, so that setting keeps meaning what it says."
                        ),
                    },
                ),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("frames", "count", "indices")
    OUTPUT_TOOLTIPS = (
        "The kept frames in their original order; an empty selection keeps all.",
        "How many frames were kept.",
        "One-based indices of the kept frames, comma-joined, e.g. '1,4,9'.",
    )
    FUNCTION = "choose"

    def choose(
        self,
        frames,
        behavior,
        preview_max_size,
        timeout_seconds=0,
        on_timeout=TIMEOUT_KEEP_ALL,
        pick_list="",
        unique_id=None,
    ):
        node_id = str(unique_id)
        frame_count = int(frames.shape[0])

        # A filled pick_list is a headless pre-answer: no pause, no events.
        selection = parse_pick_list(pick_list, frame_count)
        if selection is None:
            previous = recall_selection(node_id)
            if behavior == BEHAVIOR_REMEMBER and previous is not None:
                selection = usable_remembered(previous, frame_count)
            if selection is None:
                files = write_thumbnails(frames, uuid.uuid4().hex[:12], int(preview_max_size))
                preselect = usable_remembered(previous or [], frame_count)
                selection = await_selection(
                    node_id,
                    frame_count,
                    files,
                    preselect,
                    int(timeout_seconds),
                    str(on_timeout),
                )
                selection = normalize_selection(selection, frame_count)
        remember_selection(node_id, selection)

        kept = effective_indices(selection, frame_count)
        return (keep_frames(frames, selection), len(kept), indices_string(kept))

    @classmethod
    def IS_CHANGED(cls, pick_list="", unique_id=None, **_inputs):
        # A filled pick_list answers headlessly and deterministically, so the
        # run may cache: equivalent spellings share one stable fingerprint.
        if str(pick_list or "").strip():
            return pick_list_fingerprint(pick_list)
        key = str(unique_id)
        _RUN_COUNTERS[key] = _RUN_COUNTERS.get(key, 0) + 1
        return f"{key}:{_RUN_COUNTERS[key]}"


register_chooser_route()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_FrameChooser": AusBossFrameChooser}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_FrameChooser": "Frame Chooser (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
