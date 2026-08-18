"""ComfyUI-AusBoss entry point.

Every node lives in its own file under nodes/ and exports its own
NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS. This file merges them
and hands the result to ComfyUI. To register a new node, add its module
name to NODE_MODULES below — nothing else to wire up.

A module that fails to import is skipped with a console warning instead
of taking the whole pack down, so one broken node never hides the rest.
"""

import importlib
import os
import re
import traceback

# One entry per file in nodes/. Keep alphabetical-ish; order only affects
# nothing functional.
NODE_MODULES = [
    "node_align_image",
    "node_color_match",
    "node_compare",
    "node_frame_interpolate",
    "node_image_crop_rotate_pad",
    "node_image_size",
    "node_inpaint_crop_stitch",
    "node_krea2_encode",
    "node_krea2_model_patch",
    "node_lama_inpaint",
    "node_lmstudio_chat",
    "node_load_image_pad",
    "node_load_video",
    "node_lora_loader",
    "node_refine_mask",
    "node_save_video",
    "node_select_frame",
    "node_video_crop_rotate_pad",
]

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
_failed_modules = []

for _module_name in NODE_MODULES:
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
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def _read_version():
    """Version straight from pyproject.toml so it is never duplicated."""
    try:
        pyproject = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(pyproject, "r", encoding="utf-8") as f:
            match = re.search(r'^version\s*=\s*"([^"]+)"', f.read(), re.MULTILINE)
        return match.group(1) if match else "unknown"
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
    print(
        f"  {teal}AusBoss{reset} v{_read_version()}  |  "
        f"{len(NODE_CLASS_MAPPINGS)} nodes loaded"
    )
    if _failed_modules:
        print(f"  {red}Failed to load: {', '.join(_failed_modules)}{reset}")
    print(f"  {grey}https://github.com/ausboss/ComfyUI-AusBoss{reset}")
    print(bar)


_print_banner()
