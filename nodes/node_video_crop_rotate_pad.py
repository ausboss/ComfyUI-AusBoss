"""Video Crop + Rotate + Pad 🆎."""

from __future__ import annotations

from ._media_helpers import (
    decode_video_frame,
    list_input_videos,
    register_video_routes,
    resolve_video_path,
)
from ._transform_engine import stable_file_fingerprint, transform_pil_batch
from ._transform_inputs import spec_from_values, transform_inputs


NODE_ID = "AUSBOSS_NODES_VideoCropRotatePad"


class AusBossVideoCropRotatePad:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Targets one exact video frame and applies the same visual rotate, crop, and pad "
        "transform used by the image loader."
    )
    SEARCH_ALIASES = ["video crop", "video frame", "rotate video", "pad video", "ausboss"]

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
            "seek_mode": (["frame index", "time seconds"], {"default": "frame index"}),
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

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    OUTPUT_TOOLTIPS = (
        "The selected and transformed frame as a one-image BHWC batch.",
        "BHW generated-area mask: rotation corners and padding.",
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
        output, mask, _ = transform_pil_batch([frame], spec_from_values(**values))
        return output, mask

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
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_VideoCropRotatePad": "Video Crop + Rotate + Pad 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

