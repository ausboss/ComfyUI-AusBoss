"""Load Video (AusBoss)."""

from __future__ import annotations

from ._media_helpers import list_input_videos, resolve_input_path
from ._video_load_helpers import decode_video_range, lazy_audio_range


NODE_ID = "AUSBOSS_NODES_LoadVideo"


class AusBossLoadVideo:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Loads a video as a BHWC frame batch plus its audio, trimmed to an "
        "optional start/end window selected on the preview timeline, with frame count, "
        "fps, size, and duration outputs ready for downstream wiring."
    )
    SEARCH_ALIASES = ["load video", "video loader", "trim video", "video frames", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (
                    list_input_videos(),
                    {
                        "video_upload": True,
                        "tooltip": "Video in ComfyUI's input folder; use the upload button to add one.",
                    },
                ),
                "start_seconds": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "tooltip": (
                            "Skip everything before this time. Drag the preview's IN "
                            "handle or type an exact value below the player."
                        ),
                    },
                ),
                "end_seconds": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "tooltip": (
                            "Stop at this time; 0 plays to the end. Drag the preview's "
                            "OUT handle or type an exact value below the player."
                        ),
                    },
                ),
                "custom_width": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 2,
                        "tooltip": "0 keeps the source width; set one side only to preserve aspect.",
                    },
                ),
                "custom_height": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 2,
                        "tooltip": "0 keeps the source height; set one side only to preserve aspect.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("frames", "audio", "frame_count", "fps", "width", "height", "duration")
    OUTPUT_TOOLTIPS = (
        "Trimmed BHWC frame batch.",
        "Audio for the same trim window; silent when the video has no audio track.",
        "Number of frames returned.",
        "Source frames per second.",
        "Frame width after any custom sizing.",
        "Frame height after any custom sizing.",
        "Duration in seconds of the returned frames.",
    )
    FUNCTION = "load_video"

    def load_video(self, video, start_seconds, end_seconds, custom_width, custom_height):
        path = resolve_input_path(video)
        frames, fps = decode_video_range(
            path, start_seconds, end_seconds, int(custom_width), int(custom_height)
        )
        frame_count = int(frames.shape[0])
        duration = frame_count / fps if fps > 0 else 0.0
        # Deferred: the audio track is only decoded if a downstream node
        # actually reads the AUDIO output.
        audio = lazy_audio_range(path, float(start_seconds), float(start_seconds) + duration)
        return (
            frames,
            audio,
            frame_count,
            float(fps),
            int(frames.shape[2]),
            int(frames.shape[1]),
            float(duration),
        )

    @classmethod
    def IS_CHANGED(cls, video, **_values):
        try:
            stat = resolve_input_path(video).stat()
        except Exception:
            return float("nan")
        return f"{video}:{stat.st_mtime_ns}:{stat.st_size}"

    @classmethod
    def VALIDATE_INPUTS(cls, video, start_seconds, end_seconds, **_values):
        try:
            resolve_input_path(video)
        except Exception as exc:
            return f"Load Video: {exc}"
        if float(end_seconds) > 0.0 and float(start_seconds) >= float(end_seconds):
            return "Load Video: start_seconds must be smaller than end_seconds."
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadVideo": AusBossLoadVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadVideo": "Load Video (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
