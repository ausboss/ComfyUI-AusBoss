"""Image Crop + Rotate + Pad (AusBoss)."""

from __future__ import annotations

from ._media_helpers import list_input_images, load_image_frames, resolve_input_path
from ._transform_engine import stable_file_fingerprint, transform_pil_batch
from ._transform_inputs import spec_from_values, transform_inputs


NODE_ID = "AUSBOSS_NODES_ImageCropRotatePad"


class AusBossImageCropRotatePad:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Loads an image and applies one visual rotate, crop, and pad transform. "
        "The mask marks source transparency, rotation voids, and new padding."
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
        return {"required": required}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    OUTPUT_TOOLTIPS = (
        "The transformed image batch in BHWC format.",
        "BHW generated-area mask: transparency, rotation corners, and padding.",
    )
    FUNCTION = "load_transform"

    def load_transform(self, image: str, **values):
        path = resolve_input_path(image)
        frames = load_image_frames(path)
        output, mask, _ = transform_pil_batch(frames, spec_from_values(**values))
        return output, mask

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
        return stable_file_fingerprint(path, {"image": image, **spec.__dict__})


NODE_CLASS_MAPPINGS = {NODE_ID: AusBossImageCropRotatePad}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "Image Crop + Rotate + Pad (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

