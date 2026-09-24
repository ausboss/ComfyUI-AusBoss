"""Image Crop + Rotate + Pad 🆎."""

from __future__ import annotations

from ._media_helpers import list_input_images, load_image_frames, resolve_input_path
from ._inpaint_crop_helpers import build_transform_stitcher
from ._transform_engine import (
    original_image_batch,
    resize_batch_to_megapixels,
    stable_file_fingerprint,
    transform_pil_batch,
)
from ._transform_inputs import resize_inputs, spec_from_values, transform_inputs


class AusBossImageCropRotatePad:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Loads an image and applies one visual rotate, crop, and pad transform. "
        "The mask marks source transparency, rotation voids, and new padding. "
        "Optionally resizes the result to a megapixel budget (core Scale Image "
        "to Total Pixels semantics: aspect preserved, dimensions rounded to "
        "resolution_steps)."
    )
    SEARCH_ALIASES = ["image crop", "rotate image", "pad image", "outpaint canvas", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "image": (
                list_input_images(),
                {"image_upload": True, "tooltip": "Choose or upload an image from ComfyUI's input folder."},
            )
        }
        required.update(transform_inputs())
        # Appended AFTER the stable V1 widgets, so saved workflows' positional
        # widgets_values keep loading; missing values fall back to defaults.
        required.update(resize_inputs())
        return {"required": required}

    # Appended outputs only: saved links ride slot indices.
    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER", "IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "stitcher", "original", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The transformed image batch in BHWC format.",
        "BHW generated-area mask: transparency, rotation corners, and padding.",
        "Full-canvas stitcher: restores kept source pixels over an outpaint result; wire to Stitch Inpaint.",
        "The source image before rotation, crop, padding, or resize, as a BHWC RGB batch.",
        "Output width after the transform and any resize.",
        "Output height after the transform and any resize.",
    )
    FUNCTION = "load_transform"

    def load_transform(
        self,
        image: str,
        resize_to_megapixels=False,
        megapixels=1.0,
        resize_method="lanczos",
        resolution_steps=1,
        **values,
    ):
        path = resolve_input_path(image)
        frames = load_image_frames(path)
        output, mask, geometry = transform_pil_batch(frames, spec_from_values(**values))
        if resize_to_megapixels:
            output, mask = resize_batch_to_megapixels(
                output, mask, float(megapixels), str(resize_method), int(resolution_steps)
            )
        stitcher = build_transform_stitcher(output, mask, geometry, 32, source="Image Crop + Rotate + Pad")
        return (
            output, mask, stitcher, original_image_batch(frames),
            int(output.shape[2]), int(output.shape[1]),
        )

    @classmethod
    def VALIDATE_INPUTS(cls, image, **_values):
        try:
            resolve_input_path(image)
        except Exception as exc:
            return f"Image Crop + Rotate + Pad: {exc}"
        return True

    @classmethod
    def IS_CHANGED(cls, image, **values):
        try:
            path = resolve_input_path(image)
        except Exception:
            path = image or ""
        spec = spec_from_values(**values)
        # Every widget value is already part of ComfyUI's cache key, so a
        # changed transform or budget re-runs the node without this; the
        # fingerprint's job is noticing the image file change on disk. The
        # resize values live outside TransformSpec and ride along beside it.
        resize = {name: values.get(name) for name in resize_inputs()}
        return stable_file_fingerprint(path, {"image": image, **spec.__dict__, **resize})


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageCropRotatePad": AusBossImageCropRotatePad}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageCropRotatePad": "Image Crop + Rotate + Pad 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

