"""Video Bundle / Unbundle / Bundle Edit (AusBoss) — one AUSBOSS_VIDEO wire."""

from __future__ import annotations

from ._video_bundle_helpers import (
    BUNDLE_TYPE,
    build_video_bundle,
    edit_video_bundle,
    unbundle_video,
)

BUNDLE_ID = "AUSBOSS_NODES_VideoBundle"
UNBUNDLE_ID = "AUSBOSS_NODES_VideoUnbundle"
EDIT_ID = "AUSBOSS_NODES_VideoBundleEdit"

_FPS_LIMITS = {"min": 0.01, "max": 240.0, "step": 0.01}


class AusBossVideoBundle:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Packs frames, fps, and optional audio into one AUSBOSS_VIDEO wire so a "
        "whole video travels the graph as a single connection. Frame count, "
        "size, and duration are derived at bundle time and stay in sync."
    )
    SEARCH_ALIASES = ["video bundle", "pack video", "combine wires", "video pipe", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "BHWC frame batch, e.g. Load Video's frames output."},
                ),
                "fps": (
                    "FLOAT",
                    {
                        "default": 16.0,
                        **_FPS_LIMITS,
                        "tooltip": "Playback frame rate stored in the bundle; wire Load Video's fps to keep the source timing.",
                    },
                ),
            },
            "optional": {
                "audio": (
                    "AUDIO",
                    {"tooltip": "Optional track carried alongside the frames; leave unconnected for a silent bundle."},
                ),
            },
        }

    RETURN_TYPES = (BUNDLE_TYPE,)
    RETURN_NAMES = ("video",)
    OUTPUT_TOOLTIPS = (
        "The bundled video: frames, audio, fps, and derived frame count, size, and duration on one wire.",
    )
    FUNCTION = "bundle"

    def bundle(self, frames, fps, audio=None):
        return (build_video_bundle(frames, float(fps), audio),)

    @classmethod
    def VALIDATE_INPUTS(cls, fps=None, **_values):
        # fps arrives as None when wired from another node; the helper
        # re-checks the resolved value at execution time.
        if fps is not None and float(fps) <= 0:
            return "Video Bundle: fps must be greater than zero."
        return True


class AusBossVideoUnbundle:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Unpacks an AUSBOSS_VIDEO wire back into frames, audio, fps, and the "
        "derived frame count, size, and duration. The audio output is empty "
        "(None) when the bundle was built without an audio track."
    )
    SEARCH_ALIASES = ["video unbundle", "unpack video", "split wires", "video pipe", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (
                    BUNDLE_TYPE,
                    {"tooltip": "A bundle from Video Bundle (AusBoss) or Video Bundle Edit (AusBoss)."},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "INT", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("frames", "audio", "fps", "frame_count", "width", "height", "duration")
    OUTPUT_TOOLTIPS = (
        "The bundled BHWC frame batch.",
        "The bundled audio; None when the bundle carries no audio track.",
        "Playback frame rate stored in the bundle.",
        "Number of frames in the batch.",
        "Frame width in pixels.",
        "Frame height in pixels.",
        "Duration in seconds (frame_count / fps).",
    )
    FUNCTION = "unbundle"

    def unbundle(self, video):
        return unbundle_video(video)


class AusBossVideoBundleEdit:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Copies an AUSBOSS_VIDEO bundle, overriding only the inputs that are "
        "connected — unconnected inputs keep the original values. Frame count, "
        "size, and duration are re-derived when frames or fps change."
    )
    SEARCH_ALIASES = ["video bundle edit", "replace audio", "swap frames", "video pipe", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (
                    BUNDLE_TYPE,
                    {"tooltip": "The bundle to copy; it is never modified in place."},
                ),
            },
            "optional": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "Connect to replace the bundled frames; frame count, size, and duration follow."},
                ),
                "audio": (
                    "AUDIO",
                    {"tooltip": "Connect to replace the bundled audio; leave unconnected to keep the original track."},
                ),
                "fps": (
                    "FLOAT",
                    {
                        "default": 16.0,
                        **_FPS_LIMITS,
                        "forceInput": True,
                        "tooltip": "Connect to replace the bundled fps; duration is recomputed from the new rate.",
                    },
                ),
            },
        }

    RETURN_TYPES = (BUNDLE_TYPE,)
    RETURN_NAMES = ("video",)
    OUTPUT_TOOLTIPS = (
        "A new bundle with the connected overrides applied and derived fields recomputed.",
    )
    FUNCTION = "edit"

    def edit(self, video, frames=None, audio=None, fps=None):
        return (edit_video_bundle(video, frames, audio, fps),)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_VideoBundle": AusBossVideoBundle,
    "AUSBOSS_NODES_VideoUnbundle": AusBossVideoUnbundle,
    "AUSBOSS_NODES_VideoBundleEdit": AusBossVideoBundleEdit,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_VideoBundle": "Video Bundle (AusBoss)",
    "AUSBOSS_NODES_VideoUnbundle": "Video Unbundle (AusBoss)",
    "AUSBOSS_NODES_VideoBundleEdit": "Video Bundle Edit (AusBoss)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
