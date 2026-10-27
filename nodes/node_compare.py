"""Image Compare A/B 🆎."""

from __future__ import annotations

import asyncio
import functools
import logging
from pathlib import Path

from PIL import Image

from ._compare_helpers import (
    ALIGN_GONE,
    CompareSaveError,
    align_pair,
    clean_save_name,
    pair_pictures,
    remember_pair,
    save_mix,
    tidy_save_name,
)
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
    strokes, two choices and a name for the new files. It names no file to
    read: the two previews are the ones this node wrote and remembered. The
    name is plain text with no folder in it (clean_save_name refuses
    anything else), and the mix goes straight into ComfyUI's output folder.
    The strokes are checked and held to fixed limits
    (nodes/_compare_helpers.py).

    POST /ausboss/compare/align lines up B of a run with its A. It takes
    the same key and nothing else, reads the same two previews, and writes
    the lined-up B beside B's preview in ComfyUI's temp folder. It answers
    with that preview's name, as a run names its previews."""
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
            picture_a, picture_b, wired = pair_pictures(body.get("pair"))
            work = functools.partial(
                save_mix,
                picture_a=picture_a,
                picture_b=picture_b,
                output_dir=folder_paths.get_output_directory(),
                top=body.get("top", "A"),
                strokes=body.get("strokes"),
                layers=body.get("layers") is True,
                # A name wired into the node wins over the one typed on it.
                name=wired or clean_save_name(body.get("name")),
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

    @instance.routes.post("/ausboss/compare/align")
    async def align(request):
        try:
            body = await request.json()
        except Exception:
            body = None
        if not isinstance(body, dict):
            return web.json_response({"error": "Image Compare: the request could not be read."}, status=400)
        try:
            try:
                picture_a, picture_b, wired = pair_pictures(body.get("pair"))
            except CompareSaveError as error:
                raise CompareSaveError(ALIGN_GONE, status=error.status) from error
            temp_root = Path(folder_paths.get_temp_directory())
            work = functools.partial(
                align_pair, picture_a=picture_a, picture_b=picture_b, temp_root=temp_root, name=wired
            )
            # Off the server's own thread: measuring takes a moment.
            result = await asyncio.get_running_loop().run_in_executor(None, work)
        except CompareSaveError as error:
            return web.json_response({"error": safe_route_error(error)}, status=error.status)
        except Exception:
            logging.exception("[AusBoss] Image Compare: Align did not work.")
            return web.json_response(
                {"error": "Align did not work. The ComfyUI console has the reason."}, status=500
            )
        answer = {"aligned": result["aligned"], "message": result["message"]}
        if result["aligned"]:
            file = result["file"]
            folder = file.parent.resolve().relative_to(temp_root.resolve()).as_posix()
            answer["b"] = {
                "filename": file.name,
                "subfolder": "" if folder == "." else folder,
                "type": "temp",
                "width": result["width"],
                "height": result["height"],
            }
            if result.get("alpha"):
                answer["b"]["alpha"] = True
            answer["pair"] = result["pair"]
        return web.json_response(answer)


class AusBossCompare:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Shows A and B on one panel: slide across it to reveal B up to the "
        "pointer, or hold A or B with the switch under the picture. "
        "Erase rubs parts of one picture away with a brush so the other shows "
        "through, and saves that mix as a PNG, with a layered PSD and the mask "
        "if you want them. "
        "image_a and image_b pass through unchanged so the node can sit mid-graph."
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
                            "batch passes through the image_a output unchanged."
                        ),
                    },
                ),
                "image_b": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Comparison batch. Its first frame is preview B, revealed by "
                            "sliding across the panel or flipping the A/B toggle. The whole "
                            "batch passes through the image_b output unchanged."
                        ),
                    },
                ),
            },
            "optional": {
                "filename": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "Optional. A name for the files that Erase saves, such as the source "
                            "picture's file name. Its folder and extension are dropped. Not wired: "
                            "the name typed on the node is used."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image_a", "image_b")
    OUTPUT_TOOLTIPS = (
        "image_a passed through unchanged, so downstream nodes keep working while you compare.",
        "The image_b batch, untouched: the picture you compared against, often the edited one.",
    )
    OUTPUT_NODE = True
    FUNCTION = "compare"

    def compare(self, image_a, image_b, filename=None):
        preview_a = self._save_temp_preview(image_a)
        preview_b = self._save_temp_preview(image_b)
        wired = tidy_save_name(filename)
        return {
            "ui": {
                "a_images": [preview_a],
                "b_images": [preview_b],
                # The key Erase's Save sends back, so it never names a file to read.
                "pair": [remember_pair(self._preview_file(preview_a), self._preview_file(preview_b), wired)],
                # The name the files will get, when one is wired in.
                "save_name": [wired],
            },
            "result": (image_a, image_b),
        }

    @staticmethod
    def _preview_file(preview: dict) -> Path:
        """Where a preview this node just wrote lies in the temp folder."""
        return Path(folder_paths.get_temp_directory()) / preview.get("subfolder", "") / preview["filename"]

    def _save_temp_preview(self, image):
        # See-through parts are kept: the panel shows them over a checkerboard,
        # and Erase can bring them back into a mix.
        return save_temp_preview(image, self._prefix, "Compare", keep_alpha=True)


_register_save_route()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Compare": AusBossCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Compare": "Image Compare A/B 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
