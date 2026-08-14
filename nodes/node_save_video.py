"""Save Video (AusBoss)."""

from __future__ import annotations

from pathlib import Path

from ._video_save_helpers import (
    encode_video,
    resolve_encode_fps,
    video_components,
    workflow_metadata,
)

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


NODE_ID = "AUSBOSS_NODES_SaveVideo"


class AusBossSaveVideo:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Saves a frame batch as an H.264 mp4 with optional muxed audio and the "
        "workflow embedded, so the file drags back into ComfyUI. Wire fps "
        "straight from Load Video (AusBoss) to keep the source timing, or "
        "connect a core VIDEO to encode that whole video instead."
    )
    SEARCH_ALIASES = ["save video", "export video", "video combine", "mp4", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "BHWC frame batch to encode."},
                ),
                "fps": (
                    "FLOAT",
                    {
                        "default": 16.0,
                        "min": 0.01,
                        "max": 240.0,
                        "step": 0.01,
                        "tooltip": (
                            "Playback frame rate; wire Load Video's fps output to match "
                            "the source. A connected video input brings its own rate and "
                            "overrides this widget."
                        ),
                    },
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "AusBoss/video",
                        "tooltip": "Saved under the output folder; subfolders are created automatically.",
                    },
                ),
                "crf": (
                    "INT",
                    {
                        "default": 19,
                        "min": 0,
                        "max": 51,
                        "step": 1,
                        "tooltip": "H.264 quality: lower is better and larger. 19 is visually lossless for most content.",
                    },
                ),
            },
            "optional": {
                "audio": (
                    "AUDIO",
                    {"tooltip": "Optional track muxed into the file, e.g. Load Video's audio output."},
                ),
                "video": (
                    "VIDEO",
                    {
                        "tooltip": (
                            "Optional core VIDEO. When connected, its frames and audio "
                            "supersede the frames and audio inputs, and its own frame "
                            "rate wins over the fps widget; a differing widget rate is "
                            "logged once to the console."
                        ),
                    },
                ),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save"

    def save(
        self, frames, fps, filename_prefix, crf, audio=None, video=None, prompt=None, extra_pnginfo=None
    ):
        if folder_paths is None:
            raise RuntimeError("Save Video requires ComfyUI's folder_paths at runtime.")
        source = video_components(video)
        if source is not None:
            # A connected VIDEO supersedes the frames/audio inputs and keeps
            # its own timing; everything below is the unchanged encode path,
            # so bt709 tagging, metadata and the result player still apply.
            frames, audio, video_fps = source
            fps, notice = resolve_encode_fps(float(fps), video_fps)
            if notice:
                print(notice)
        full_output_folder, filename, counter, subfolder, filename_prefix = (
            folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                int(frames.shape[2]),
                int(frames.shape[1]),
            )
        )
        file = f"{filename}_{counter:05}_.mp4"
        width, height, frame_count = encode_video(
            Path(full_output_folder) / file,
            frames,
            float(fps),
            audio,
            int(crf),
            workflow_metadata(prompt, extra_pnginfo),
        )
        return {
            "ui": {
                "images": [{
                    "filename": file,
                    "subfolder": subfolder,
                    "type": "output",
                    "width": width,
                    "height": height,
                    "frame_count": frame_count,
                    "fps": float(fps),
                    "duration": frame_count / float(fps),
                }],
                "animated": (True,),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, fps=None, **_values):
        # fps arrives as None when wired from another node; the encoder
        # re-checks the resolved value at execution time.
        if fps is not None and float(fps) <= 0:
            return "Save Video: fps must be greater than zero."
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_SaveVideo": AusBossSaveVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_SaveVideo": "Save Video (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
