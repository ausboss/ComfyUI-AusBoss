"""Video Crop + Rotate + Pad -> Clip 🆎."""

from __future__ import annotations

import asyncio

from ._inpaint_crop_helpers import build_canvas_stitcher, stitch_blend_from_mask
from ._media_helpers import list_input_videos, register_video_routes, resolve_video_path
from ._transform_engine import (
    resize_batch_to_megapixels,
    stable_file_fingerprint,
    transform_tensor_batch_chunked,
)
from ._transform_inputs import resize_inputs, spec_from_values, transform_inputs
from ._video_load_helpers import decode_video_range, lazy_audio_range


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


def clip_stitcher(frames, mask, geometry, blend_pixels: int, grow_pixels: int = 0) -> dict:
    """A full-frame stitcher for the finished clip.

    The generated clip is the whole canvas, so the crop is the identity
    rectangle and the paste mask is the transform's generated-area mask -
    padding and rotation voids - ramped by the stitch settings. It is built
    from the final frames, after any resize, so the paste lines up with what
    the sampler actually returns; the source bbox rides along scaled the
    same way.
    """
    blend = stitch_blend_from_mask(mask, blend_pixels, grow_pixels)
    scale_x = frames.shape[2] / float(geometry.output_width)
    scale_y = frames.shape[1] / float(geometry.output_height)
    bbox = (
        int(round(geometry.pad_left * scale_x)),
        int(round(geometry.pad_top * scale_y)),
        int(round((geometry.pad_left + geometry.crop_width) * scale_x)),
        int(round((geometry.pad_top + geometry.crop_height) * scale_y)),
    )
    return build_canvas_stitcher(frames, blend, bbox=bbox)


class AusBossVideoCropRotatePadClip:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Loads a trimmed video and applies one rotate, crop, and pad transform "
        "to every frame: cut a border or a corner off, straighten a tilt, or "
        "grow fill-color bands for a video outpaint. Outputs the frames, the "
        "mask of the generated area (rotation corners and padding), the audio "
        "for the same window, the frame count, fps, size, and duration, and a "
        "stitcher so Stitch Inpaint can paste the source frames back over the "
        "generated clip. The editor's timeline only chooses the preview "
        "frame; the whole start/end window is processed."
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
                {"default": "input folder", "tooltip": "Local path mode avoids copying large videos."},
            ),
            "local_path": (
                "STRING",
                {
                    "default": "",
                    "tooltip": (
                        "Absolute local video path used only in local path mode. Queued runs "
                        "always read it; editor previews need AUSBOSS_TRANSFORM_LOCAL_PREVIEW=1."
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
                        "Editor preview position only: frame_index or frame_time picks the "
                        "frame the editor shows. The output covers the whole trim window."
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
                    "tooltip": "Zero-based preview frame for the editor; does not affect the output.",
                },
            ),
            "frame_time": (
                "FLOAT",
                {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 86400.0,
                    "step": 0.001,
                    "tooltip": "Preview seconds for the editor in time mode; does not affect the output.",
                },
            ),
        }
        required.update(transform_inputs())
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
        return {"required": required, "optional": optional}

    # Appended outputs only: saved workflows address these by index.
    RETURN_TYPES = ("IMAGE", "MASK", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT", "AUSBOSS_STITCHER")
    RETURN_NAMES = ("frames", "mask", "audio", "frame_count", "fps", "width", "height", "duration", "stitcher")
    OUTPUT_TOOLTIPS = (
        "Every frame of the trim window, transformed, as a BHWC batch.",
        "BHW generated-area mask per frame: rotation corners and padding, feathered.",
        "Audio for the same window; silent when the video has no audio track.",
        "Number of frames returned.",
        "Frames per second of the returned batch: the source rate divided by every_nth.",
        "Frame width after the transform and any resize.",
        "Frame height after the transform and any resize.",
        "Duration in seconds of the returned frames.",
        "For Stitch Inpaint: pastes the source frames back over a generated clip "
        "of this size, blending only across the padded and rotated-in area.",
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
        **values,
    ):
        path = resolve_video_path(source_mode, video, local_path)
        nth = max(1, int(every_nth))
        cap = max(0, int(max_frames))
        # The decode blocks for as long as the trim is; off the loop so the
        # executor keeps answering, with the context ComfyUI's progress and
        # interrupt hooks need carried along.
        frames, source_fps = await asyncio.to_thread(
            decode_video_range, path, float(start_seconds), float(end_seconds), 0, 0, nth, cap
        )
        keep = snap_frame_count(int(frames.shape[0]), frame_snap)
        if keep < frames.shape[0]:
            frames = frames[:keep]
        spec = spec_from_values(**values)
        output, mask, geometry = await asyncio.to_thread(transform_tensor_batch_chunked, frames, spec)
        del frames
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
        )

    @classmethod
    def VALIDATE_INPUTS(cls, video, source_mode, local_path, start_seconds, end_seconds, **_values):
        try:
            resolve_video_path(source_mode, video, local_path)
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
