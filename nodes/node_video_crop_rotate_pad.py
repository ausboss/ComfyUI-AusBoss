"""Video Crop + Rotate + Pad -> Frame 🆎."""

from __future__ import annotations

from ._media_helpers import (
    decode_video_frame,
    list_input_videos,
    register_video_routes,
    resolve_video_path,
)
from ._inpaint_crop_helpers import build_transform_stitcher
from ._transform_engine import original_image_batch, stable_file_fingerprint, transform_pil_batch
from ._transform_inputs import spec_from_values, transform_inputs


class AusBossVideoCropRotatePad:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Picks ONE frame out of a video and applies the same visual rotate, "
        "crop, and pad transform as the image node. The output is a single "
        "image, not a clip — the editor's timeline is there to find the frame, "
        "not to trim a range."
    )
    SEARCH_ALIASES = [
        "video crop",
        "video frame",
        "grab frame",
        "extract frame",
        "frame from video",
        "rotate video",
        "pad video",
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
            "seek_mode": (
                ["frame index", "time seconds"],
                {
                    "default": "frame index",
                    "tooltip": "Picks the frame by frame_index or by frame_time seconds; the other widget is ignored.",
                },
            ),
            "frame_index": (
                "INT",
                {"default": 0, "min": 0, "max": 100000000, "step": 1, "tooltip": "Zero-based target frame."},
            ),
            "frame_time": (
                "FLOAT",
                {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.001, "tooltip": "Target seconds in time mode."},
            ),
        }
        required.update(transform_inputs())
        return {"required": required}

    # Appended outputs only: saved links ride slot indices.
    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER", "IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "stitcher", "original", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The selected and transformed frame as a one-image BHWC batch.",
        "BHW generated-area mask: rotation corners and padding.",
        "Full-canvas stitcher: restores kept source pixels over an outpaint result; wire to Stitch Inpaint.",
        "The picked source frame before rotation, crop, or padding, as a BHWC RGB batch.",
        "Output width after the transform.",
        "Output height after the transform.",
    )
    FUNCTION = "load_transform"

    def load_transform(
        self,
        video: str,
        source_mode: str,
        local_path: str,
        seek_mode: str,
        frame_index: int,
        frame_time: float,
        **values,
    ):
        path = resolve_video_path(source_mode, video, local_path)
        frame, _, _ = decode_video_frame(path, seek_mode, frame_index, frame_time)
        output, mask, geometry = transform_pil_batch([frame], spec_from_values(**values))
        stitcher = build_transform_stitcher(
            output, mask, geometry, 32, source="Video Crop + Rotate + Pad -> Frame"
        )
        return (
            output, mask, stitcher, original_image_batch([frame]),
            int(output.shape[2]), int(output.shape[1]),
        )

    @classmethod
    def VALIDATE_INPUTS(cls, video, source_mode, local_path, **_values):
        try:
            resolve_video_path(source_mode, video, local_path)
        except Exception as exc:
            return f"Video Crop + Rotate + Pad: {exc}"
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        video,
        source_mode,
        local_path,
        seek_mode,
        frame_index,
        frame_time,
        **values,
    ):
        try:
            path = resolve_video_path(source_mode, video, local_path)
        except Exception:
            path = local_path if source_mode == "local path" else video
        spec = spec_from_values(**values)
        return stable_file_fingerprint(
            path,
            {
                "video": video,
                "source_mode": source_mode,
                "seek_mode": seek_mode,
                "frame_index": int(frame_index),
                "frame_time": round(float(frame_time), 6),
                **spec.__dict__,
            },
        )


register_video_routes()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_VideoCropRotatePad": AusBossVideoCropRotatePad}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_VideoCropRotatePad": "Video Crop + Rotate + Pad → Frame 🆎"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

