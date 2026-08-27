"""Load Video 🆎."""

from __future__ import annotations

import asyncio

from ._media_helpers import list_input_videos, resolve_input_path
from ._video_load_helpers import (
    core_trimmed_video,
    decode_video_range,
    effective_load_args,
    lazy_audio_range,
)


class AusBossLoadVideo:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Loads a video as a BHWC frame batch plus its audio, trimmed to an "
        "optional start/end window selected on the preview timeline, with frame count, "
        "fps, size, and duration outputs ready for downstream wiring, plus a lazy "
        "core VIDEO output for nodes that consume whole videos. every_nth thins "
        "the batch and max_frames caps it, so long clips load without filling "
        "memory. single_frame flips the loader into a frame picker that "
        "returns just the frame at the IN time as a one-image batch."
    )
    SEARCH_ALIASES = [
        "load video",
        "video loader",
        "trim video",
        "video frames",
        "frame picker",
        "ausboss",
    ]

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
            },
            "optional": {
                "every_nth": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 512,
                        "step": 1,
                        "tooltip": (
                            "Keep one frame in this many — 2 halves the frame "
                            "count. The fps output divides to match, so the "
                            "clip still plays at real speed downstream."
                        ),
                    },
                ),
                "max_frames": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 100000,
                        "step": 1,
                        "tooltip": (
                            "Stop after this many kept frames; 0 loads the "
                            "whole trim window. Caps memory on long clips — "
                            "the decode ends early instead of loading and "
                            "discarding."
                        ),
                    },
                ),
                "single_frame": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Load only the frame at the IN time as a "
                            "one-image batch. The preview's trim strip "
                            "becomes a frame picker (the FRAME button "
                            "toggles this), and end_seconds, every_nth, "
                            "and max_frames are ignored."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT", "VIDEO")
    RETURN_NAMES = ("frames", "audio", "frame_count", "fps", "width", "height", "duration", "video")
    OUTPUT_TOOLTIPS = (
        "Trimmed BHWC frame batch.",
        "Audio for the same trim window; silent when the video has no audio track.",
        "Number of frames returned.",
        "Frames per second of the returned batch: the source rate divided "
        "by every_nth.",
        "Frame width after any custom sizing.",
        "Frame height after any custom sizing.",
        "Duration in seconds of the returned frames.",
        "Core VIDEO for the same trim window at the source size; frames decode "
        "only when a consumer asks for them. None on ComfyUI cores without the "
        "comfy_api VIDEO type (present on every version this pack supports).",
    )
    FUNCTION = "load_video"

    async def load_video(
        self,
        video,
        start_seconds,
        end_seconds,
        custom_width,
        custom_height,
        every_nth=1,
        max_frames=0,
        single_frame=False,
    ):
        path = resolve_input_path(video)
        # Single-frame mode collapses the trim to a one-frame cap; the rest
        # of the pipeline then describes that frame's window on its own.
        end, nth, cap = effective_load_args(
            bool(single_frame), end_seconds, every_nth, max_frames
        )
        # PyAV decoding blocks for as long as the trim is; to_thread keeps the
        # executor's event loop answering while it runs, and carries the
        # context ComfyUI needs to attribute progress and interrupts here.
        frames, source_fps = await asyncio.to_thread(
            decode_video_range,
            path,
            start_seconds,
            end,
            int(custom_width),
            int(custom_height),
            nth,
            cap,
        )
        # Thinned frames report a divided fps so real time survives the trip
        # through Save Video and interpolators.
        fps = source_fps / nth
        frame_count = int(frames.shape[0])
        duration = frame_count / fps if fps > 0 else 0.0
        # Deferred: the audio track is only decoded if a downstream node
        # actually reads the AUDIO output. The window ends where the kept
        # frames end, so a max_frames cap keeps picture and sound aligned.
        audio = lazy_audio_range(path, float(start_seconds), float(start_seconds) + duration)
        # Lazy core VIDEO for the same window; None on cores without the API.
        # Building it probes the container for a duration, so it goes off the
        # loop as well. every_nth does not apply to it — the VIDEO wire
        # carries the source as-is — but a max_frames cap shortens it.
        core_end = float(end)
        if cap > 0 and duration > 0.0:
            core_end = float(start_seconds) + duration
        core_video = await asyncio.to_thread(
            core_trimmed_video, path, float(start_seconds), core_end
        )
        return (
            frames,
            audio,
            frame_count,
            float(fps),
            int(frames.shape[2]),
            int(frames.shape[1]),
            float(duration),
            core_video,
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
        # A single-frame load ignores end_seconds, so a stale trim window left
        # over from trim mode must not block the graph.
        if not _values.get("single_frame"):
            if float(end_seconds) > 0.0 and float(start_seconds) >= float(end_seconds):
                return "Load Video: start_seconds must be smaller than end_seconds."
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadVideo": AusBossLoadVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadVideo": "Load Video 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
