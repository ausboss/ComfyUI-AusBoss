"""ComfyUI-AusBoss entry point.

Every node lives in its own file under nodes/ and exports its own
NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS. This file merges them
and hands the result to ComfyUI. To register a new node, add its module
name to NODE_MODULES below — nothing else to wire up.

A module that fails to import is skipped with a console warning instead
of taking the whole pack down, so one broken node never hides the rest.

Only one copy of the pack loads. People install it from ComfyUI-Manager
(custom_nodes/ausboss-nodes) and from GitHub (custom_nodes/ComfyUI-AusBoss),
and two copies used to register the same server routes, which stopped
ComfyUI at startup. A second copy now loads nothing and says which folder
to delete.
"""

import importlib
import os
import sys
import tomllib
import traceback
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
_FIRST_COPY = sys.modules.setdefault(
    "_ausboss_nodes_first_copy", types.SimpleNamespace(folder=_HERE)
)
_IS_SECOND_COPY = _FIRST_COPY.folder != _HERE

# One entry per file in nodes/, kept alphabetical. The order has no
# functional effect.
NODE_MODULES = [
    "node_align_image",
    "node_batch_utils",
    "node_callout",
    "node_color_match",
    "node_compare",
    "node_frame_interpolate",
    "node_free_memory",
    "node_h3_prompt_writer",
    "node_image_crop_rotate_pad",
    "node_image_folder",
    "node_image_resize",
    "node_image_size",
    "node_inpaint_crop_stitch",
    "node_krea2_encode",
    "node_krea2_model_patch",
    "node_lama_inpaint",
    "node_layout_boxes",
    "node_literals",
    "node_load_image_pad",
    "node_load_audio",
    "node_load_video",
    "node_lora_loader",
    "node_mask_by_name",
    "node_mask_by_touch",
    "node_math",
    "node_realign_to_source",
    "node_refine_mask",
    "node_resolution",
    "node_run_timer",
    "node_save_image",
    "node_save_video",
    "node_seed",
    "node_select_frame",
    "node_show_text",
    "node_step_preview",
    "node_tiled_upscale",
    "node_video_crop_rotate_pad",
    "node_video_crop_rotate_pad_clip",
    "node_workflow_note",
    "node_workflow_switches",
]

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
_failed_modules = []

for _module_name in NODE_MODULES:
    if _IS_SECOND_COPY:
        break
    try:
        _module = importlib.import_module(f".nodes.{_module_name}", __name__)
        NODE_CLASS_MAPPINGS.update(getattr(_module, "NODE_CLASS_MAPPINGS", {}))
        NODE_DISPLAY_NAME_MAPPINGS.update(
            getattr(_module, "NODE_DISPLAY_NAME_MAPPINGS", {})
        )
    except Exception:
        _failed_modules.append(_module_name)
        traceback.print_exc()

# Folder ComfyUI serves to the browser; every .js file in it is loaded as a
# frontend extension. Shared modules use .mjs so they are import-only.
WEB_DIRECTORY = None if _IS_SECOND_COPY else "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def _read_version(folder=None):
    """Version straight from pyproject.toml so it is never duplicated."""
    try:
        pyproject = os.path.join(folder or os.path.dirname(__file__), "pyproject.toml")
        with open(pyproject, "rb") as f:
            version = tomllib.load(f).get("project", {}).get("version")
        return version if isinstance(version, str) and version.strip() else "unknown"
    except Exception:
        return "unknown"


def _print_banner():
    # ASCII only in here: ComfyUI on Windows often runs with a cp1252
    # console, and a UnicodeEncodeError at import time kills the whole pack.
    teal = "\033[38;2;0;180;170m"
    grey = "\033[0;37m"
    red = "\033[0;31m"
    reset = "\033[0m"
    bar = f"{teal}{'-' * 70}{reset}"

    print(bar)
    if _IS_SECOND_COPY:
        def where(folder):
            text = f"{os.path.basename(folder)} (v{_read_version(folder)})"
            return text.encode("ascii", "replace").decode("ascii")

        print(f"  {red}AusBoss is installed twice, so this copy is not loaded.{reset}")
        print(f"  In use:  custom_nodes/{where(_FIRST_COPY.folder)}")
        print(f"  Skipped: custom_nodes/{where(_HERE)}")
        print("  Delete one of the two folders and restart ComfyUI.")
        print(bar)
        return
    print(
        f"  {teal}AusBoss{reset} v{_read_version()}  |  "
        f"{len(NODE_CLASS_MAPPINGS)} nodes loaded"
    )
    if _failed_modules:
        print(f"  {red}Failed to load: {', '.join(_failed_modules)}{reset}")
    print(f"  {grey}https://github.com/ausboss/ComfyUI-AusBoss{reset}")
    print(bar)


try:
    if not _IS_SECOND_COPY:
        from .nodes._frontend_cache import register_frontend_cache_guard

        register_frontend_cache_guard()
except Exception:
    traceback.print_exc()

_print_banner()
