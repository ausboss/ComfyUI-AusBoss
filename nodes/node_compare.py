"""Image Compare A/B 🆎."""

from __future__ import annotations

import asyncio
import functools
import logging
from pathlib import Path

from PIL import Image

from ._compare_helpers import CompareSaveError, pair_pictures, remember_pair, save_mix
from ._preview_helpers import save_temp_preview, temp_prefix
from ._preview_helpers import first_frame_to_pil as _first_frame_to_pil
from ._route_errors import safe_route_error

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None


def first_frame_to_pil(image) -> Image.Image:
    """First frame of a BHWC float batch as a PIL image, ready to save."""
    return _first_frame_to_pil(image, "Compare")


def _register_save_route() -> None:
    """POST /ausboss/compare/save writes the Erase mix of a run's two previews.

    The body holds the key of a run (see compare() below), the brush
    strokes and two choices. It names no file: the two previews are the ones
    this node wrote and remembered, and the mix goes to ComfyUI's output
    folder under a fixed name. The strokes are checked and held to fixed
    limits (nodes/_compare_helpers.py)."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None or getattr(instance, "_ausboss_compare_save", False):
        return
    instance._ausboss_compare_save = True

    @instance.routes.post("/ausboss/compare/save")
    async def save(request):
        try:
            body = await request.json()
        except Exception:
            body = None
        if not isinstance(body, dict):
            return web.json_response({"error": "Image Compare: the request could not be read."}, status=400)
        try:
            picture_a, picture_b = pair_pictures(body.get("pair"))
            work = functools.partial(
                save_mix,
                picture_a=picture_a,
                picture_b=picture_b,
                output_dir=folder_paths.get_output_directory(),
                top=body.get("top", "A"),
                strokes=body.get("strokes"),
                layers=body.get("layers") is True,
            )
            # Off the server's own thread: a large mix takes a moment.
            result = await asyncio.get_running_loop().run_in_executor(None, work)
        except CompareSaveError as error:
            return web.json_response({"error": safe_route_error(error)}, status=error.status)
        except Exception:
            logging.exception("[AusBoss] Image Compare: the mix could not be saved.")
            return web.json_response(
                {"error": "The mix could not be saved. The ComfyUI console has the reason."}, status=500
            )
        return web.json_response(result)


class AusBossCompare:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Shows A and B on one panel: slide across it to reveal B up to the "
        "pointer, or use the A/B toggle to flip the whole panel with a click. "
        "ERASE rubs parts of one picture away with a brush so the other shows "
        "through, and saves that mix as a PNG, with a layered PSD and the mask "
        "if you want them. "
        "image_a passes through unchanged so the node can sit mid-graph."
    )
    SEARCH_ALIASES = [
        "image compare", "compare", "a/b", "before after", "slider", "diff",
        "erase", "blend", "mix", "psd", "layers", "ausboss",
    ]

    def __init__(self):
        # A distinct temp prefix per node instance, so two Compare nodes in
        # one workflow never overwrite each other's previews.
        self._prefix = temp_prefix("compare")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_a": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Baseline batch. Its first frame is preview A, and the whole "
                            "batch passes through the output unchanged."
                        ),
                    },
                ),
                "image_b": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Comparison batch. Its first frame is preview B, revealed by "
                            "sliding across the panel or flipping the A/B toggle."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image_a",)
    OUTPUT_TOOLTIPS = (
        "image_a passed through unchanged, so downstream nodes keep working while you compare.",
    )
    OUTPUT_NODE = True
    FUNCTION = "compare"

    def compare(self, image_a, image_b):
        preview_a = self._save_temp_preview(image_a)
        preview_b = self._save_temp_preview(image_b)
        return {
            "ui": {
                "a_images": [preview_a],
                "b_images": [preview_b],
                # The key Erase's Save sends back, so it never names a file.
                "pair": [remember_pair(self._preview_file(preview_a), self._preview_file(preview_b))],
            },
            "result": (image_a,),
        }

    @staticmethod
    def _preview_file(preview: dict) -> Path:
        """Where a preview this node just wrote lies in the temp folder."""
        return Path(folder_paths.get_temp_directory()) / preview.get("subfolder", "") / preview["filename"]

    def _save_temp_preview(self, image):
        return save_temp_preview(image, self._prefix, "Compare")


_register_save_route()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Compare": AusBossCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Compare": "Image Compare A/B 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
