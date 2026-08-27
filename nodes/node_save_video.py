"""Save Video 🆎."""

from __future__ import annotations

import asyncio
from pathlib import Path

from ._video_save_helpers import (
    VIDEO_FORMATS,
    encode_video,
    pingpong_frames,
    resolve_encode_fps,
    video_components,
    workflow_metadata,
)

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


class AusBossSaveVideo:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Saves a frame batch as mp4 (h264/h265, CPU or NVENC), webm (vp9/av1), "
        "ProRes mov, lossless ffv1 mkv, gif or webp - with optional muxed audio "
        "and the workflow embedded, so the file drags back into ComfyUI. "
        "pingpong bounces the clip for a seamless loop. Wire fps straight from "
        "Load Video 🆎 to keep the source timing, or connect a core VIDEO to "
        "encode that whole video instead."
    )
    SEARCH_ALIASES = [
        "save video",
        "export video",
        "video combine",
        "mp4",
        "webm",
        "h265",
        "gif",
        "webp",
        "prores",
        "nvenc",
        "pingpong",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # FLOAT, not INT, however whole the number usually looks: the
                # real broadcast rates are 23.976, 29.97 and 59.94, and Load
                # Video's fps output is a FLOAT that would no longer connect
                # here. step 1 is what makes it read and nudge like an integer.
                "fps": (
                    "FLOAT",
                    {
                        "default": 16.0,
                        "min": 0.01,
                        "max": 240.0,
                        "step": 1.0,
                        "tooltip": (
                            "Playback frame rate; wire Load Video's fps output to match "
                            "the source. A connected video input brings its own rate and "
                            "overrides this widget. Fractional rates like 23.976 and "
                            "29.97 can be typed in."
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
                        "tooltip": (
                            "Encode quality: lower is better and larger. 19 is "
                            "visually lossless for h264; h265 and vp9 read the "
                            "same scale (vp9 tolerates a few points higher)."
                        ),
                    },
                ),
            },
            # frames leads the optional group so the socket order the frontend
            # draws — frames, audio, video — is the order saved workflows
            # already link against. It is optional only because a connected
            # video carries its own frames; one of the two must be present.
            "optional": {
                "frames": (
                    "IMAGE",
                    {"tooltip": "BHWC frame batch to encode. Not needed when a video is connected."},
                ),
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
                            "logged once to the console. ComfyUI core decodes the whole "
                            "file into memory before this node sees a frame: that phase "
                            "reports no progress and does not stop on Cancel, which "
                            "takes effect once the encode starts. Wiring frames instead "
                            "keeps the whole run interruptible."
                        ),
                    },
                ),
                "format": (
                    list(VIDEO_FORMATS),
                    {
                        "default": "mp4 h264",
                        "tooltip": (
                            "Container and codec. mp4 h264 plays everywhere; mp4 h265 "
                            "halves the size at the same quality where supported; the "
                            "nvenc pair encodes on an NVIDIA GPU instead of the CPU "
                            "(much faster, slightly larger); webm vp9 and webm av1 suit "
                            "the web and mux Opus; mov prores is a ProRes HQ editing "
                            "master; mkv ffv1 is bit-exact lossless and very large. "
                            "gif and webp are silent, loop forever, and hold every "
                            "frame in memory - keep those to short clips."
                        ),
                    },
                ),
                # Appended after format on purpose: widgets_values is positional,
                # so anything inserted earlier would shift the values a saved
                # workflow already stores against fps, filename_prefix and crf.
                "pingpong": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Play the clip forward then backward so it loops seamlessly. "
                            "Roughly doubles the frame count and the encode time; the "
                            "first and last frames are not repeated at the turnaround."
                        ),
                    },
                ),
                "save_metadata": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Embed the prompt and workflow in the file, so an mp4 "
                            "dragged back onto the canvas restores its graph. Turn off "
                            "to share a file without your prompts and node graph inside "
                            "it. gif and webp never carry metadata."
                        ),
                    },
                ),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_path",)
    OUTPUT_TOOLTIPS = (
        "Absolute path of the file this run saved, for downstream nodes "
        "that want the file itself.",
    )
    OUTPUT_NODE = True
    FUNCTION = "save"

    async def save(
        self,
        fps,
        filename_prefix,
        crf,
        frames=None,
        audio=None,
        video=None,
        format="mp4 h264",
        pingpong=False,
        save_metadata=True,
        prompt=None,
        extra_pnginfo=None,
    ):
        if folder_paths is None:
            raise RuntimeError("Save Video requires ComfyUI's folder_paths at runtime.")
        # Pulling a VIDEO's components decodes the whole file, so it joins the
        # encode on a worker thread rather than stalling the event loop. It is
        # the one phase here that cannot be instrumented: core declares
        # VideoInput.get_components() with no arguments (comfy_api/latest/
        # _input/video_types.py) and its VideoFromFile implementation runs a
        # bare demux loop, so there is no progress or interrupt seam to pass.
        # A Cancel raised during it is only noticed by the first frame check
        # inside encode_video, once control comes back.
        source = await asyncio.to_thread(video_components, video)
        if source is not None:
            # A connected VIDEO supersedes the frames/audio inputs and keeps
            # its own timing; everything below is the unchanged encode path,
            # so bt709 tagging, metadata and the result player still apply.
            frames, audio, video_fps = source
            fps, notice = resolve_encode_fps(float(fps), video_fps)
            if notice:
                print(notice)
        elif frames is None:
            raise ValueError(
                "Save Video: connect either a frames batch or a video to encode."
            )
        # Before get_save_image_path, which reads the batch's dimensions, and
        # before the duration the preview reports: the bounce is part of the
        # clip, not a playback trick, so every frame count downstream counts it.
        if pingpong:
            frames = pingpong_frames(frames)
        full_output_folder, filename, counter, subfolder, filename_prefix = (
            folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                int(frames.shape[2]),
                int(frames.shape[1]),
            )
        )
        extension = VIDEO_FORMATS[format][0] if format in VIDEO_FORMATS else "mp4"
        file = f"{filename}_{counter:05}_.{extension}"
        output_path = Path(full_output_folder) / file
        width, height, frame_count = await asyncio.to_thread(
            encode_video,
            output_path,
            frames,
            float(fps),
            audio,
            int(crf),
            workflow_metadata(prompt, extra_pnginfo) if save_metadata else None,
            str(format),
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
            },
            "result": (str(output_path),),
        }

    @classmethod
    def VALIDATE_INPUTS(cls, fps=None, **_values):
        # fps arrives as None when wired from another node; the encoder
        # re-checks the resolved value at execution time.
        if fps is not None and float(fps) <= 0:
            return "Save Video: fps must be greater than zero."
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_SaveVideo": AusBossSaveVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_SaveVideo": "Save Video 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
