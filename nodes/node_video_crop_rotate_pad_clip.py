"""Video Crop + Rotate + Pad -> Clip 🆎."""

from __future__ import annotations

import asyncio
import math

from ._inpaint_crop_helpers import build_transform_stitcher as clip_stitcher
from ._media_helpers import list_input_videos, register_video_routes, resolve_video_path, video_metadata
from ._transform_engine import (
    resize_batch_to_megapixels,
    stable_file_fingerprint,
    transform_tensor_batch_chunked,
)
from ._transform_inputs import resize_inputs, spec_from_values, transform_inputs
from ._video_load_helpers import clip_load_window, decode_video_range, fixed_clip_window, lazy_audio_range


FRAME_SNAP_RULES = ("free", "8n+1", "4n+1")


def snap_frame_count(count: int, rule: str) -> int:
    """The largest ``step*n + 1`` count not above ``count`` for a rule like
    ``"8n+1"``; ``"free"`` (or anything unparseable) keeps ``count``.

    Video models keep only such counts - LTX 8n+1, Wan 4n+1 - and drop the
    tail, so trimming here keeps frames, audio, and duration honest and the
    stitcher the same length as the clip that comes back.
    """
    count = max(0, int(count))
    text = str(rule or "free").strip().lower()
    if not text.endswith("n+1"):
        return count
    try:
        step = int(text[: -len("n+1")])
    except ValueError:
        return count
    if step <= 0 or count <= 1:
        return count
    return ((count - 1) // step) * step + 1


class AusBossVideoCropRotatePadClip:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Loads a trimmed video and applies one rotate, crop, and pad transform "
        "to every frame: cut a border or a corner off, straighten a tilt, or "
        "grow fill-color bands for a video outpaint. Outputs the frames, the "
        "mask of the generated area (rotation corners and padding), the audio "
        "for the same window, the frame count, fps, size, and duration, and a "
        "stitcher so Stitch Inpaint can paste the source frames back over the "
        "generated clip. Fixed frames makes a movable window with an exact "
        "output count; 0 restores free IN/OUT trimming."
    )
    SEARCH_ALIASES = [
        "video crop",
        "crop video",
        "rotate video",
        "pad video",
        "video outpaint",
        "trim video",
        "straighten video",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "video": (
                list_input_videos(),
                {"tooltip": "Choose a video in ComfyUI's input folder or use the upload button."},
            ),
            "source_mode": (
                ["input folder", "local path"],
                {"default": "input folder", "tooltip": "Local path mode reads a video already inside ComfyUI's input, output or temp folder in place, without an upload copy."},
            ),
            "local_path": (
                "STRING",
                {
                    "default": "",
                    "tooltip": (
                        "Absolute path to a video inside ComfyUI's input, output or temp "
                        "folder, used only in local path mode and read in place without a "
                        "copy. Paths anywhere else are refused."
                    ),
                },
            ),
            "start_seconds": (
                "FLOAT",
                {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 86400.0,
                    "step": 0.01,
                    "tooltip": "Skip everything before this time.",
                },
            ),
            "end_seconds": (
                "FLOAT",
                {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 86400.0,
                    "step": 0.01,
                    "tooltip": "Stop at this time; 0 runs to the end of the video.",
                },
            ),
            "seek_mode": (
                ["frame index", "time seconds"],
                {
                    "default": "frame index",
                    "tooltip": (
                        "Playhead position only: frame_index or frame_time picks the frame "
                        "the node and editor show. The output covers the whole trim window."
                    ),
                },
            ),
            "frame_index": (
                "INT",
                {
                    "default": 0,
                    "min": 0,
                    "max": 100000000,
                    "step": 1,
                    "tooltip": "Zero-based playhead frame shown on the node and in the editor; does not affect the output.",
                },
            ),
            "frame_time": (
                "FLOAT",
                {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 86400.0,
                    "step": 0.001,
                    "tooltip": "Playhead position in seconds for time mode; does not affect the output.",
                },
            ),
        }
        # A fresh clip starts outpaint-ready: the in-context video models
        # this feeds (LTX IC-LoRA) paint pure black behind a hard edge and
        # leave a grey or feathered band untouched, so those are the defaults
        # here and what the editor's Reset returns to.
        required.update(transform_inputs(feather=0, fill_color="#000000"))
        required.update(resize_inputs())
        optional = {
            "every_nth": (
                "INT",
                {
                    "default": 1,
                    "min": 1,
                    "max": 512,
                    "step": 1,
                    "tooltip": (
                        "Keep one frame in this many; 2 halves the frame count and the "
                        "fps output divides to match, so the clip still plays at real speed."
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
                        "Stop after this many kept frames; 0 processes the whole trim "
                        "window. Video models want 8n+1 counts: 49, 97, 121."
                    ),
                },
            ),
            "frame_snap": (
                list(FRAME_SNAP_RULES),
                {
                    "default": "free",
                    "tooltip": (
                        "Drop trailing frames so the count is one a video model "
                        "keeps: 8n+1 for LTX (49, 97, 121), 4n+1 for Wan. Free keeps "
                        "every frame in the window."
                    ),
                },
            ),
            "stitch_blend": (
                "INT",
                {
                    "default": 32,
                    "min": 0,
                    "max": 512,
                    "step": 1,
                    "tooltip": (
                        "Ramp of the stitcher's paste, in pixels, into the kept "
                        "frames: where generated pixels fade over the source. "
                        "Separate from feather, which shapes the mask itself."
                    ),
                },
            ),
            "stitch_grow": (
                "INT",
                {
                    "default": 0,
                    "min": -256,
                    "max": 256,
                    "step": 1,
                    "tooltip": (
                        "Moves the paste boundary before the ramp: positive lets "
                        "the generation replace a strip of the source next to "
                        "the seam, negative keeps more of the source."
                    ),
                },
            ),
        }
        # Append timing controls: saved positional widget values stay intact.
        optional.update({
            "force_rate": ("FLOAT,INT", {
                "forceInput": True,
                "tooltip": "Output sampling rate before Every nth; 0 keeps the source rate. "
                           "Frames are dropped or repeated to preserve playback speed.",
            }),
            "start_frame": ("INT", {
                "forceInput": True, "min": 0,
                "tooltip": "Zero-based source start frame; overrides and locks timeline IN. "
                           "Uses the source frame-rate grid.",
            }),
            "end_frame": ("INT", {
                "forceInput": True, "min": 0,
                "tooltip": "Exclusive source end frame; 0 means source end. Overrides and "
                           "locks timeline OUT. Uses the source frame-rate grid.",
            }),
            "frame_load_cap": ("INT", {
                "forceInput": True, "min": 0,
                "tooltip": "Maximum returned frames after rate conversion and Every nth, "
                           "before Snap. Overrides and locks Limit; 0 means unlimited.",
            }),
            "fixed_frames": ("INT", {
                "default": 0, "min": 0, "max": 100000,
                "tooltip": "Exact output frames after rate conversion and Every nth; 0 = free trim. "
                           "Drag either handle to move the whole window. Overrides OUT/end_frame, Limit, "
                           "frame_load_cap and Snap. Duration = frames / output fps; 120 frames at 24 fps = 5 seconds. "
                           "The source must be long enough. A linked IN anchors the window.",
            }),
        })
        return {"required": required, "optional": optional}

    # Appended outputs only: saved workflows address these by index.
    RETURN_TYPES = ("IMAGE", "MASK", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT", "AUSBOSS_STITCHER", "IMAGE")
    RETURN_NAMES = ("frames", "mask", "audio", "frame_count", "fps", "width", "height", "duration", "stitcher", "original")
    OUTPUT_TOOLTIPS = (
        "Every frame of the trim window, transformed, as a BHWC batch.",
        "BHW generated-area mask per frame: rotation corners and padding, feathered.",
        "Audio for the same window; silent when the video has no audio track.",
        "Number of frames returned.",
        "Frames per second of the returned batch: the forced rate (or source rate) divided by every_nth.",
        "Frame width after the transform and any resize.",
        "Frame height after the transform and any resize.",
        "Duration in seconds of the returned frames.",
        "For Stitch Inpaint: pastes the source frames back over a generated clip "
        "of this size, blending only across the padded and rotated-in area.",
        "The selected source frames before rotation, crop, padding, or resize; same timing as frames.",
    )
    FUNCTION = "load_transform"

    async def load_transform(
        self,
        video: str,
        source_mode: str,
        local_path: str,
        start_seconds: float,
        end_seconds: float,
        seek_mode: str = "frame index",
        frame_index: int = 0,
        frame_time: float = 0.0,
        resize_to_megapixels=False,
        megapixels=1.0,
        resize_method="lanczos",
        resolution_steps=1,
        every_nth=1,
        max_frames=0,
        frame_snap="free",
        stitch_blend=32,
        stitch_grow=0,
        force_rate=0.0,
        start_frame=None,
        end_frame=None,
        frame_load_cap=None,
        fixed_frames=0,
        **values,
    ):
        path = resolve_video_path(source_mode, video, local_path)
        nth = max(1, int(every_nth))
        start_seconds, end_seconds, cap = clip_load_window(
            path, start_seconds, end_seconds, max_frames, start_frame, end_frame, frame_load_cap
        )
        fixed_frames = int(fixed_frames)
        if not 0 <= fixed_frames <= 100000:
            raise ValueError("Fixed frames must be between 0 and 100000.")
        if fixed_frames:
            start_seconds, end_seconds, cap = fixed_clip_window(
                video_metadata(path), start_seconds, fixed_frames, force_rate, nth
            )
        # The decode blocks for as long as the trim is; off the loop so the
        # executor keeps answering, with the context ComfyUI's progress and
        # interrupt hooks need carried along. Its errors name this node and
        # suggest only inputs it has - there is no custom size here.
        frames, source_fps = await asyncio.to_thread(
            decode_video_range, path, float(start_seconds), float(end_seconds), 0, 0, nth, cap, force_rate,
            source="Video Crop + Rotate + Pad -> Clip",
            memory_advice=(
                "Trim a shorter start/end window, raise every_nth, or load fewer "
                "frames with max_frames or fixed_frames."
            ),
        )
        if fixed_frames and int(frames.shape[0]) != fixed_frames:
            raise ValueError("The source did not decode enough frames for Fixed frames. Reduce the requested length.")
        keep = fixed_frames or snap_frame_count(int(frames.shape[0]), frame_snap)
        if keep < frames.shape[0]:
            frames = frames[:keep]
        spec = spec_from_values(**values)
        output, mask, geometry = await asyncio.to_thread(transform_tensor_batch_chunked, frames, spec)
        if resize_to_megapixels:
            output, mask = resize_batch_to_megapixels(
                output, mask, float(megapixels), str(resize_method), int(resolution_steps)
            )
        stitcher = clip_stitcher(output, mask, geometry, int(stitch_blend), int(stitch_grow))
        fps = source_fps / nth
        frame_count = int(output.shape[0])
        duration = frame_count / fps if fps > 0 else 0.0
        # Deferred: the track is decoded only if something reads the AUDIO
        # output, and the window ends where the kept frames end.
        audio = lazy_audio_range(path, float(start_seconds), float(start_seconds) + duration)
        return (
            output,
            mask,
            audio,
            frame_count,
            float(fps),
            int(output.shape[2]),
            int(output.shape[1]),
            float(duration),
            stitcher,
            frames,
        )

    @classmethod
    def VALIDATE_INPUTS(
        cls, video, source_mode, local_path, start_seconds, end_seconds,
        start_frame=None, end_frame=None, force_rate=0.0, fixed_frames=0, every_nth=1, input_types=None, **_values,
    ):
        try:
            path = resolve_video_path(source_mode, video, local_path)
            if force_rate is not None and (
                not math.isfinite(float(force_rate)) or not 0 <= float(force_rate) <= 1000
            ):
                return "Video Crop + Rotate + Pad: force_rate must be between 0 and 1000 fps."
            # Linked values are evaluated at execution; stale widget values must
            # not reject a valid override before those values are available.
            schema = cls.INPUT_TYPES()
            definitions = schema["required"] | schema["optional"]
            for name, actual in (input_types or {}).items():
                expected = definitions.get(name, (None,))[0]
                received = {part.strip() for part in str(actual).split(",")}
                if isinstance(expected, str) and "*" not in received and not received.intersection(expected.split(",")):
                    return f"Video Crop + Rotate + Pad: incompatible input type for {name}."
            if any(name in (input_types or {}) for name in ("start_frame", "end_frame", "start_seconds", "end_seconds", "fixed_frames", "force_rate", "every_nth")):
                return True
            start_seconds, end_seconds, _ = clip_load_window(
                path, start_seconds, end_seconds, start_frame=start_frame, end_frame=end_frame
            )
            if not 0 <= int(fixed_frames or 0) <= 100000:
                return "Fixed frames must be between 0 and 100000."
            if fixed_frames:
                fixed_clip_window(video_metadata(path), start_seconds, fixed_frames, force_rate, every_nth)
                return True
        except Exception as exc:
            return f"Video Crop + Rotate + Pad: {exc}"
        if float(end_seconds) > 0.0 and float(start_seconds) >= float(end_seconds):
            return "Video Crop + Rotate + Pad: start_seconds must be smaller than end_seconds."
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        video,
        source_mode,
        local_path,
        start_seconds,
        end_seconds,
        seek_mode="frame index",
        frame_index=0,
        frame_time=0.0,
        every_nth=1,
        max_frames=0,
        frame_snap="free",
        stitch_blend=32,
        stitch_grow=0,
        **values,
    ):
        # The preview position (seek_mode, frame_index, frame_time) is left
        # out on purpose: scrubbing the editor must not re-run a whole clip.
        try:
            path = resolve_video_path(source_mode, video, local_path)
        except Exception:
            path = local_path if source_mode == "local path" else video
        spec = spec_from_values(**values)
        resize = {name: values.get(name) for name in resize_inputs()}
        return stable_file_fingerprint(
            path,
            {
                "video": video,
                "source_mode": source_mode,
                "start_seconds": round(float(start_seconds), 6),
                "end_seconds": round(float(end_seconds), 6),
                "every_nth": max(1, int(every_nth)),
                "max_frames": max(0, int(max_frames)),
                "frame_snap": str(frame_snap),
                **{name: values.get(name) for name in ("force_rate", "start_frame", "end_frame", "frame_load_cap", "fixed_frames")},
                "stitch_blend": int(stitch_blend),
                "stitch_grow": int(stitch_grow),
                **spec.__dict__,
                **resize,
            },
        )


register_video_routes()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_VideoCropRotatePadClip": AusBossVideoCropRotatePadClip}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_VideoCropRotatePadClip": "Video Crop + Rotate + Pad → Clip 🆎"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
