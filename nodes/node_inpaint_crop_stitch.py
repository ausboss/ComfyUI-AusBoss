"""Crop For Inpaint / Stitch Inpaint 🆎 — a tight node family."""

from __future__ import annotations

from ._inpaint_crop_helpers import apply_stitch, build_crop


CROP_NODE_ID = "AUSBOSS_NODES_CropForInpaint"
STITCH_NODE_ID = "AUSBOSS_NODES_StitchInpaint"


class AusBossCropForInpaint:
    CATEGORY = "🆎 AusBoss/Inpaint"
    DESCRIPTION = (
        "Cuts the masked region plus surrounding context out of an image so "
        "an inpainter works at native resolution, and emits a stitcher that "
        "Stitch Inpaint 🆎 uses to paste the result back seamlessly. "
        "The selection can be inverted, grown or shrunk, and edge-softened "
        "before cropping; context comes from a growth factor plus optional "
        "flat pixels. By default the sampling mask stays hard-edged; "
        "feathering lives in a separate blend mask used only while pasting. "
        "An empty mask selects the full image and stitches back unchanged."
    )
    SEARCH_ALIASES = [
        "inpaint crop",
        "crop and stitch",
        "context crop",
        "masked region",
        "zoom inpaint",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "BHWC image or video frames to crop around the mask."},
                ),
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "White marks the area to inpaint. A multi-frame mask "
                            "is unioned into one crop window; an empty mask "
                            "selects the whole image."
                        )
                    },
                ),
                "context_factor": (
                    "FLOAT",
                    {
                        "default": 1.2,
                        "min": 1.0,
                        "max": 10.0,
                        "step": 0.05,
                        "tooltip": (
                            "Grows the mask bounding box symmetrically by this "
                            "factor so the inpainter sees surrounding context."
                        ),
                    },
                ),
                "blend_pixels": (
                    "INT",
                    {
                        "default": 16,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "Feather width for pasting the result back: the paste "
                            "mask is widened by this many pixels and blurred. "
                            "The sampling mask is never feathered. 0 pastes hard."
                        ),
                    },
                ),
                "output_multiple": (
                    "INT",
                    {
                        "default": 8,
                        "min": 1,
                        "max": 128,
                        "step": 1,
                        "tooltip": (
                            "Crop and target dimensions are rounded up to a "
                            "multiple of this so samplers accept them."
                        ),
                    },
                ),
            },
            "optional": {
                "target_width": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 8,
                        "tooltip": (
                            "Rescale the crop to this width for the sampler; 0 "
                            "keeps the native crop width (or follows "
                            "target_height at the crop's aspect ratio)."
                        ),
                    },
                ),
                "target_height": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 16384,
                        "step": 8,
                        "tooltip": (
                            "Rescale the crop to this height for the sampler; 0 "
                            "keeps the native crop height (or follows "
                            "target_width at the crop's aspect ratio)."
                        ),
                    },
                ),
                "mask_grow": (
                    "INT",
                    {
                        "default": 0,
                        "min": -256,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "Dilate the sampling mask by this many pixels "
                            "(negative shrinks) so the inpainter repaints "
                            "past the drawn edge. Reshapes what gets "
                            "painted, unlike blend_pixels which only "
                            "feathers the paste-back."
                        ),
                    },
                ),
                "mask_blur": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.5,
                        "tooltip": (
                            "Gaussian sigma softening the sampling mask's "
                            "edge for models that honor soft masks. 0 keeps "
                            "the hard edge."
                        ),
                    },
                ),
                "invert_mask": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Inpaint the black area instead of the white "
                            "area — everything outside the drawn region."
                        ),
                    },
                ),
                "context_pixels": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 4096,
                        "step": 8,
                        "tooltip": (
                            "Flat extra context in pixels added around the "
                            "mask box after context_factor's growth."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER")
    RETURN_NAMES = ("image", "mask", "stitcher")
    OUTPUT_TOOLTIPS = (
        "Cropped BHWC region around the mask, sized for the sampler.",
        "Hard-edged sampling mask matching the crop; never feathered.",
        "Stitch data for Stitch Inpaint 🆎: canvas, rects, blend mask, scale.",
    )
    FUNCTION = "crop"

    def crop(
        self,
        image,
        mask,
        context_factor,
        blend_pixels,
        output_multiple,
        target_width=0,
        target_height=0,
        mask_grow=0,
        mask_blur=0.0,
        invert_mask=False,
        context_pixels=0,
    ):
        return build_crop(
            image,
            mask,
            float(context_factor),
            int(blend_pixels),
            int(output_multiple),
            int(target_width),
            int(target_height),
            int(mask_grow),
            float(mask_blur),
            bool(invert_mask),
            int(context_pixels),
        )


class AusBossStitchInpaint:
    CATEGORY = "🆎 AusBoss/Inpaint"
    DESCRIPTION = (
        "Pastes an inpainted crop from Crop For Inpaint 🆎 back into "
        "the original image, blending with the feathered mask recorded in "
        "the stitcher. Pixels outside the blend region are bit-identical to "
        "the original — they never pass through a resize. A stitcher built "
        "from one image broadcasts across an inpainted frame batch. Turn on "
        "fix_edge_halo when the seam shows a dark or light rim."
    )
    SEARCH_ALIASES = [
        "stitch inpaint",
        "paste back",
        "crop and stitch",
        "recompose",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "stitcher": (
                    "AUSBOSS_STITCHER",
                    {"tooltip": "The stitcher output of Crop For Inpaint 🆎."},
                ),
                "inpainted": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Inpainted crop to paste back. It is resized to the "
                            "crop window if the sampler changed its size."
                        )
                    },
                ),
            },
            "optional": {
                "fix_edge_halo": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Recover the true color under the feathered seam "
                            "before pasting, so half-transparent edge pixels "
                            "stop blending their background in twice and "
                            "leaving a dark or light rim. Needs the optional "
                            "pymatting package; without it the paste is "
                            "unchanged and the console notes it once."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = (
        "Original-size image with the inpainted crop blended in; pixels "
        "outside the blend region are untouched.",
    )
    FUNCTION = "stitch"

    def stitch(self, stitcher, inpainted, fix_edge_halo=False):
        return (apply_stitch(stitcher, inpainted, bool(fix_edge_halo)),)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_CropForInpaint": AusBossCropForInpaint,
    "AUSBOSS_NODES_StitchInpaint": AusBossStitchInpaint,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_CropForInpaint": "Crop For Inpaint 🆎",
    "AUSBOSS_NODES_StitchInpaint": "Stitch Inpaint 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
