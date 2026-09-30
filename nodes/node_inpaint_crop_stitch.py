"""Crop For Inpaint / Stitch Inpaint 🆎 — a tight node family."""

from __future__ import annotations

from ._inpaint_crop_helpers import (
    RESIZE_ALGORITHMS,
    SEAM_CLASSIC,
    SEAM_MODES,
    apply_stitch,
    build_crop,
    stitch_blend_mask,
)
from ._unpainted_helpers import unpainted_notice, unpainted_share

# A workflow saved before Seam existed can hold the card's empty value in
# the slot Seam now takes; it loads, and stitches, as classic.
_UNSET_SEAM = ("", None)


class AusBossCropForInpaint:
    CATEGORY = "🆎 AusBoss/Inpaint"
    DESCRIPTION = (
        "Cuts the masked region plus surrounding context out of an image so "
        "an inpainter works at native resolution, and emits a stitcher that "
        "Stitch Inpaint 🆎 uses to paste the result back seamlessly. "
        "The selection can be inverted, grown or shrunk, and edge-softened "
        "before cropping; context comes from a growth factor plus optional "
        "flat pixels, and stops at the picture's edges unless keep_inside "
        "is off. target_megapixels rescales the crop to a sampler-"
        "friendly area, and the extend inputs grow the frame itself for "
        "outpainting. By default the sampling mask stays hard-edged; "
        "feathering lives in a separate blend mask used only while pasting. "
        "An empty mask selects the full image and stitches back unchanged."
    )
    SEARCH_ALIASES = [
        "inpaint crop",
        "crop and stitch",
        "context crop",
        "masked region",
        "zoom inpaint",
        "outpaint",
        "extend image",
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
                            "It never touches the sampling mask (mask_blur "
                            "softens that). 0 pastes hard."
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
                "target_megapixels": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.05,
                        "tooltip": (
                            "Rescale the crop for the sampler so its area is "
                            "about this many megapixels — 1.0 suits SDXL-class "
                            "models, 0 keeps the native crop size. Explicit "
                            "target_width/height overrides this."
                        ),
                    },
                ),
                "rescale_algorithm": (
                    list(RESIZE_ALGORITHMS),
                    {
                        "default": "bilinear",
                        "tooltip": (
                            "Resize filter for the sampler round trip. "
                            "bilinear is the safe default, bicubic keeps "
                            "upscales a touch crisper, area suits heavy "
                            "downscales, nearest never invents pixels."
                        ),
                    },
                ),
                "extend_left": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 8192,
                        "step": 8,
                        "tooltip": (
                            "Outpainting: grow the frame this many pixels "
                            "leftward. The new band is added to the mask and "
                            "becomes part of the stitched output."
                        ),
                    },
                ),
                "extend_right": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 8192,
                        "step": 8,
                        "tooltip": (
                            "Outpainting: grow the frame this many pixels "
                            "rightward. The new band is added to the mask and "
                            "becomes part of the stitched output."
                        ),
                    },
                ),
                "extend_up": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 8192,
                        "step": 8,
                        "tooltip": (
                            "Outpainting: grow the frame this many pixels "
                            "upward. The new band is added to the mask and "
                            "becomes part of the stitched output."
                        ),
                    },
                ),
                "extend_down": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 8192,
                        "step": 8,
                        "tooltip": (
                            "Outpainting: grow the frame this many pixels "
                            "downward. The new band is added to the mask and "
                            "becomes part of the stitched output."
                        ),
                    },
                ),
                "keep_inside": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Keep the crop inside the picture. On: the "
                            "context stops at the picture's edges, so the "
                            "model sees only real picture. Off: the crop can "
                            "run past the edges, filled with stretched copies "
                            "of the edge pixels (the old behavior)."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "AUSBOSS_STITCHER")
    RETURN_NAMES = ("image", "mask", "stitcher")
    OUTPUT_TOOLTIPS = (
        "Cropped BHWC region around the mask, sized for the sampler.",
        "The sampling mask, cropped like the image: the input mask after "
        "invert, grow and blur. blend_pixels never feathers it.",
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
        target_megapixels=0.0,
        rescale_algorithm="bilinear",
        extend_left=0,
        extend_right=0,
        extend_up=0,
        extend_down=0,
        keep_inside=True,
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
            float(target_megapixels),
            str(rescale_algorithm),
            int(extend_left),
            int(extend_right),
            int(extend_up),
            int(extend_down),
            bool(keep_inside),
        )


class AusBossStitchInpaint:
    CATEGORY = "🆎 AusBoss/Inpaint"
    DESCRIPTION = (
        "Pastes an inpainted crop from Crop For Inpaint 🆎, or an "
        "outpainted canvas from Load Image + Pad 🆎 or a Crop + Rotate + "
        "Pad 🆎 node, back into the original image. Seam picks how the new "
        "area joins your picture: classic, the default, blends with the "
        "feathered mask recorded in the stitcher, as every earlier "
        "workflow did; blend in fades the model's picture into yours with "
        "no tone shift, which suits turned pictures and outpaints run "
        "without Tone match. "
        "Pixels the stitch does not reach are bit-identical to the "
        "original — they never pass through a resize. A stitcher built "
        "from one image broadcasts across an inpainted frame batch. With "
        "classic, turn on fix_edge_halo when the seam shows a dark or light "
        "rim, and raise color_match when the new region reads lighter or "
        "warmer than the picture — it measures the drift in the feathered "
        "overlap and shifts the paste onto the original's tone. The "
        "blend_mask output marks what the stitch changed, in the stitched "
        "image's own coordinates, ready for a downstream color match."
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
                    {
                        "tooltip": (
                            "The stitcher from Crop For Inpaint 🆎, Load Image "
                            "+ Pad 🆎 or a Crop + Rotate + Pad 🆎 node."
                        )
                    },
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
                "color_match": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.05,
                        "tooltip": (
                            "Pull the inpainted region's tone onto the "
                            "original's before pasting. The shift is measured "
                            "in the feathered band, where the sampler's "
                            "version and the true pixels overlap, so it "
                            "reads the model's own drift - the lighter or "
                            "warmer bands an outpaint often comes back "
                            "with. 1 applies the full measured shift, 0 is "
                            "off. Needs a feather (an overlap) to measure; "
                            "with none it does nothing."
                        ),
                    },
                ),
                "seam": (
                    list(SEAM_MODES),
                    {
                        "default": SEAM_CLASSIC,
                        "tooltip": (
                            "How the new area joins your picture. Pick blend "
                            "in for turned pictures and outpaints with Tone "
                            "match off; classic keeps older workflows exactly "
                            "as they were (Crop For Inpaint always stitches "
                            "classic for now)."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "blend_mask")
    OUTPUT_TOOLTIPS = (
        "Original-size image with the inpainted crop blended in; pixels "
        "outside the blend region are untouched.",
        "The feathered paste mask in the stitched image's coordinates - "
        "white where the inpaint blended in, zero where the original "
        "survived. Wire it to a color-match or compositing node to treat "
        "exactly the pasted region without rebuilding the mask. With Seam "
        "on blend in it shows the blend instead: white on the new area, "
        "fading to zero where your picture is untouched.",
    )
    FUNCTION = "stitch"

    def stitch(self, stitcher, inpainted, fix_edge_halo=False, color_match=0.0, seam=SEAM_CLASSIC):
        if seam in _UNSET_SEAM:
            seam = SEAM_CLASSIC
        if seam not in SEAM_MODES:
            raise ValueError(f"Stitch Inpaint: seam must be 'classic' or 'blend in', not {seam!r}.")
        image = apply_stitch(stitcher, inpainted, bool(fix_edge_halo), float(color_match), seam)
        result = (image, stitch_blend_mask(stitcher, image.shape[0], seam))
        # An outpaint whose new area came back as the plain fill looks like a
        # finished picture with bars; say so instead of handing it back quietly.
        notice = unpainted_notice(unpainted_share(stitcher, inpainted))
        if notice is None:
            return result
        print(f"[AusBoss] Stitch Inpaint: {notice}")
        return {"ui": {"ausboss_notice": [{"source": "Stitch Inpaint", "text": notice}]}, "result": result}

    @classmethod
    def VALIDATE_INPUTS(cls, seam=SEAM_CLASSIC):
        # Naming seam here takes it out of ComfyUI's own list check, so the
        # empty value an older workflow carries in its place still queues.
        if seam in _UNSET_SEAM or seam in SEAM_MODES:
            return True
        return f"Stitch Inpaint: seam must be 'classic' or 'blend in', not {seam!r}."


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_CropForInpaint": AusBossCropForInpaint,
    "AUSBOSS_NODES_StitchInpaint": AusBossStitchInpaint,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_CropForInpaint": "Crop For Inpaint 🆎",
    "AUSBOSS_NODES_StitchInpaint": "Stitch Inpaint 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
