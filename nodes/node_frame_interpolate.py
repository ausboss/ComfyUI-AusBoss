"""Frame Interpolate (AusBoss)."""

from __future__ import annotations

from ._interpolate_helpers import METHOD_CHOICES, interpolate_frames


class AusBossFrameInterpolate:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Resamples a frame batch from a source fps to a target fps, so 24 to "
        "30 works as naturally as doubling. New in-between frames come from a "
        "fast crossfade blend or cached RAFT optical flow; frames that land exactly "
        "on a source frame are copied untouched. Hard scene cuts hold the "
        "last frame instead of morphing across the cut."
    )
    SEARCH_ALIASES = [
        "interpolation",
        "fps convert",
        "slow motion",
        "rife",
        "smooth video",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "Video frames as a BHWC IMAGE batch."},
                ),
                "source_fps": (
                    "FLOAT",
                    {
                        "default": 24.0,
                        "min": 0.01,
                        "max": 240.0,
                        "step": 0.01,
                        "tooltip": (
                            "Frame rate of the incoming batch; wire Load "
                            "Video's fps output to match the source."
                        ),
                    },
                ),
                "target_fps": (
                    "FLOAT",
                    {
                        "default": 30.0,
                        "min": 0.01,
                        "max": 240.0,
                        "step": 0.01,
                        "tooltip": (
                            "Frame rate to resample to. Matching the source "
                            "fps passes the frames through unchanged."
                        ),
                    },
                ),
                "method": (
                    METHOD_CHOICES,
                    {
                        "default": METHOD_CHOICES[0],
                        "tooltip": (
                            "blend crossfades neighboring frames: instant, no "
                            "downloads, soft on fast motion. Optical flow "
                            "warps both neighbors along RAFT motion vectors "
                            "for sharper in-betweens. It only uses an already-"
                            "cached checkpoint and never downloads one."
                        ),
                    },
                ),
                "scene_cut_threshold": (
                    "FLOAT",
                    {
                        "default": 0.35,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": (
                            "Mean absolute frame difference above this counts "
                            "as a hard cut, and the new frame holds the last "
                            "frame before the cut instead of morphing across "
                            "it. 0 disables cut detection."
                        ),
                    },
                ),
                "batch_size": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "In-between frames computed per batch: higher is "
                            "faster but uses more VRAM."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "FLOAT")
    RETURN_NAMES = ("frames", "fps")
    OUTPUT_TOOLTIPS = (
        "The resampled BHWC frame batch at the target rate.",
        "The actual output fps; wire this into Save Video so rounding to a "
        "whole frame count never drifts the timing.",
    )
    FUNCTION = "interpolate"

    def interpolate(
        self, frames, source_fps, target_fps, method, scene_cut_threshold, batch_size
    ):
        output, fps = interpolate_frames(
            frames,
            float(source_fps),
            float(target_fps),
            method,
            float(scene_cut_threshold),
            int(batch_size),
        )
        return (output, fps)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_FrameInterpolate": AusBossFrameInterpolate}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_FrameInterpolate": "Frame Interpolate (AusBoss)"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
