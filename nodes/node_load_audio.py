"""Load Audio 🆎."""

from __future__ import annotations

import asyncio

from ._audio_trim_helpers import decode_audio_window, list_input_audio
from ._execution_helpers import ignore_extra_inputs
from ._media_helpers import resolve_input_path


class AusBossLoadAudio:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Loads a sound file and hands on only the part you pick. The node shows the "
        "sound as a wave, so you can see where the loud parts are. Drag the two "
        "handles to set where it starts and stops, and press play to hear just that "
        "part. Set Max length to the longest sound the next step takes: anything "
        "longer shows in red as cut off, so you see exactly what comes out before "
        "you run anything."
    )
    SEARCH_ALIASES = [
        "load audio",
        "audio loader",
        "trim audio",
        "cut audio",
        "song",
        "voice",
        "music",
        "waveform",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": (
                    list_input_audio(),
                    {
                        "audio_upload": True,
                        "tooltip": "A sound file in ComfyUI's input folder. Use Upload to add one.",
                    },
                ),
                "start_seconds": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "tooltip": "Where the sound starts. Drag the wave's IN handle or type a time.",
                    },
                ),
                "end_seconds": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "tooltip": "Where the sound stops. 0 plays to the end. Drag the OUT handle or type a time.",
                    },
                ),
            },
            "optional": {
                "max_seconds": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.1,
                        "tooltip": (
                            "The longest the sound may be. Anything past it is cut off and shows "
                            "in red. 0 means no limit."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("AUDIO", "FLOAT")
    RETURN_NAMES = ("audio", "seconds")
    OUTPUT_TOOLTIPS = (
        "The part of the sound you picked, ready for any node that takes audio.",
        "How long that sound is, in seconds.",
    )
    FUNCTION = "load_audio"

    async def load_audio(self, audio, start_seconds, end_seconds, max_seconds=0.0):
        path = resolve_input_path(audio)
        # Decoding blocks for as long as the pick is; a worker thread keeps
        # ComfyUI's event loop answering, and carries the context ComfyUI
        # reads to attribute an interrupt to this node.
        sound = await asyncio.to_thread(
            decode_audio_window, path, start_seconds, end_seconds, max_seconds
        )
        seconds = sound["waveform"].shape[-1] / float(sound["sample_rate"])
        return (sound, float(seconds))

    @classmethod
    def IS_CHANGED(cls, audio, **_values):
        try:
            stat = resolve_input_path(audio).stat()
        except Exception:
            return float("nan")
        return f"{audio}:{stat.st_mtime_ns}:{stat.st_size}"

    @classmethod
    @ignore_extra_inputs
    def VALIDATE_INPUTS(cls, audio):
        # Only the source is named: ComfyUI skips its own range checks for
        # every input named here. resolve_input_path takes a file inside the
        # input folder, or one named "[output]" or "[temp]", and nothing else.
        try:
            resolve_input_path(audio)
        except Exception as exc:
            return f"Load Audio: {exc}"
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadAudio": AusBossLoadAudio}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadAudio": "Load Audio 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
