"""Load Image 🆎."""

from __future__ import annotations

from ._execution_helpers import ignore_extra_inputs
from ._load_image_helpers import (
    CROP_SIDES,
    RATIOS,
    SIZE_MODES,
    apply_load_size,
    frames_to_image_and_mask,
    plan_load_size,
)
from ._media_helpers import list_input_images, load_image_frames, resolve_input_path
from ._resize_helpers import INTERPOLATION_MODES
from ._transform_engine import stable_file_fingerprint


class AusBossLoadImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Loads a picture and sets its size in the same node. Pick a file, "
        "upload one, or step through the input folder with the arrows. "
        "Size can stay off, or bring the picture to a megapixel count, a "
        "longest side, a scale, a box it must fit inside, or a box it fills "
        "by cropping. It can also cut a piece or a shape out of the picture "
        "without resizing, keeping the side you choose. The node shows the "
        "picture going in and coming out, with both sizes, before you run."
    )
    SEARCH_ALIASES = [
        "load image",
        "load picture",
        "image loader",
        "resize on load",
        "megapixels",
        "longest side",
        "crop",
        "aspect ratio",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    list_input_images(),
                    {
                        "image_upload": True,
                        "tooltip": "The picture to load. Pick one from ComfyUI's input folder or upload a new one.",
                    },
                ),
                "size": (
                    list(SIZE_MODES),
                    {
                        "default": "off",
                        "tooltip": (
                            "How the picture is resized. off keeps it as it "
                            "is. megapixels, longest side and scale keep its "
                            "shape. fit inside shrinks or grows it to sit in "
                            "a box. crop to fill covers the box and cuts off "
                            "what sticks out. crop cuts a piece out without "
                            "resizing. crop to ratio cuts the largest piece "
                            "of a shape."
                        ),
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.01,
                        "max": 64.0,
                        "step": 0.01,
                        "tooltip": "For megapixels: the picture's total size. 1.0 is about 1024 x 1024.",
                    },
                ),
                "longest_side": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 16,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "For longest side: the length of the longer edge, in pixels. The other edge follows.",
                    },
                ),
                "scale": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.05,
                        "max": 8.0,
                        "step": 0.01,
                        "tooltip": "For scale: 0.5 is half the size, 2 is double.",
                    },
                ),
                "width": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 16,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "For fit inside, crop to fill and crop: the box's width in pixels.",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 16,
                        "max": 16384,
                        "step": 1,
                        "tooltip": "For fit inside, crop to fill and crop: the box's height in pixels.",
                    },
                ),
                "multiple": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "Rounds the new width and height to a multiple of "
                            "this. Most models want 8 or 16. 1 leaves the "
                            "numbers as they are. Not used while size is off."
                        ),
                    },
                ),
                "method": (
                    list(INTERPOLATION_MODES),
                    {
                        "default": "lanczos",
                        "tooltip": "How pixels are resampled. lanczos is the sharpest for photos; nearest keeps pixel art crisp.",
                    },
                ),
                "enlarge": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "On: a small picture is made bigger to reach the "
                            "size you asked for. Off: a picture is only ever "
                            "made smaller, and a small one comes out at its "
                            "own size."
                        ),
                    },
                ),
                "crop_from": (
                    list(CROP_SIDES),
                    {
                        "default": "center",
                        "tooltip": (
                            "For the three crop choices: the part of the "
                            "picture that is kept. top keeps the top and cuts "
                            "from the bottom."
                        ),
                    },
                ),
                "ratio": (
                    list(RATIOS),
                    {
                        "default": "1:1",
                        "tooltip": (
                            "For crop to ratio: the shape to cut, width to "
                            "height. width : height uses the numbers in the "
                            "width and height boxes."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING", "INT", "INT")
    RETURN_NAMES = (
        "image",
        "mask",
        "width",
        "height",
        "filename",
        "original_width",
        "original_height",
    )
    OUTPUT_TOOLTIPS = (
        "The picture, at its new size.",
        "White where the picture is see-through, black where it is solid. "
        "All black for a picture with no transparency. Same size as the picture.",
        "Width of the picture that comes out, in pixels.",
        "Height of the picture that comes out, in pixels.",
        "The file's name without its folder or its ending, ready for a save "
        "node's prefix.",
        "Width of the file before any resize.",
        "Height of the file before any resize.",
    )
    FUNCTION = "load"

    def load(
        self,
        image,
        size="off",
        megapixels=1.0,
        longest_side=1024,
        scale=1.0,
        width=1024,
        height=1024,
        multiple=8,
        method="lanczos",
        enlarge=True,
        crop_from="center",
        ratio="1:1",
    ):
        path = resolve_input_path(image)
        picture, mask = frames_to_image_and_mask(load_image_frames(path))
        source_w, source_h = int(picture.shape[2]), int(picture.shape[1])
        plan = plan_load_size(
            source_w,
            source_h,
            str(size),
            float(megapixels),
            int(longest_side),
            float(scale),
            int(width),
            int(height),
            int(multiple),
            bool(enlarge),
            str(crop_from),
            str(ratio),
        )
        picture, mask = apply_load_size(picture, mask, plan, str(method))
        return (
            picture,
            mask,
            int(plan["width"]),
            int(plan["height"]),
            path.stem,
            source_w,
            source_h,
        )

    @classmethod
    @ignore_extra_inputs
    def VALIDATE_INPUTS(cls, image):
        try:
            resolve_input_path(image)
        except Exception as exc:
            return f"Load Image: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, image, **values):
        try:
            path = resolve_input_path(image)
        except Exception:
            path = image or ""
        return stable_file_fingerprint(path, {"image": image, **values})


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LoadImage": AusBossLoadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LoadImage": "Load Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
