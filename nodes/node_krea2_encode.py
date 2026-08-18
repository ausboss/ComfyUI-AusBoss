"""Krea 2 Encode 🆎."""

from __future__ import annotations

from ._krea2_helpers import REFERENCE_MAX_EDGE, build_reference_image

try:  # Offline tests import this module without ComfyUI.
    import node_helpers
except ImportError:
    node_helpers = None

try:  # Older cores have no Krea 2 template; the encode still works without it.
    from comfy.text_encoders.krea2 import KREA2_TEMPLATE
except ImportError:
    KREA2_TEMPLATE = None


class AusBossKrea2Encode:
    CATEGORY = "🆎 AusBoss/Krea2"
    DESCRIPTION = (
        "Encodes a Krea 2 prompt pair and attaches reference latents in one "
        "node. Wire a VAE and a reference image and the reference is encoded "
        "and appended to the positive conditioning; leave them unwired and "
        "this is a plain two-prompt encoder. The negative comes out of the "
        "same node so a turbo graph at CFG 1.0 still has something to plug in "
        "without a second text encode sitting there doing nothing."
    )
    SEARCH_ALIASES = [
        "krea2 encode",
        "krea 2 encode",
        "krea2 outpaint encode",
        "reference conditioning",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": (
                    "CLIP",
                    {"tooltip": "The Krea 2 text encoder."},
                ),
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "default": "",
                        "tooltip": (
                            "Describe the whole finished canvas, not just the "
                            "new area — the model is generating all of it and "
                            "matching the reference where it must."
                        ),
                    },
                ),
            },
            "optional": {
                "negative_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "default": "",
                        "tooltip": (
                            "Ignored at CFG 1.0, which is where turbo runs — "
                            "an empty negative is the normal case there."
                        ),
                    },
                ),
                "vae": (
                    "VAE",
                    {
                        "tooltip": (
                            "Needed to turn the reference images into latents. "
                            "Without it the references are skipped."
                        )
                    },
                ),
                "reference": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The `reference` output of Load Image + Pad 🆎 — "
                            "the unpadded source. Any image works; it is "
                            "fitted to a multiple of 16 first."
                        )
                    },
                ),
                "extra_image": (
                    "IMAGE",
                    {"tooltip": "A second reference, e.g. a style or character plate."},
                ),
                "vlm_reference": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Also show the references to the vision tower, so "
                            "the text encoder describes them. Off for outpaint "
                            "— the latents already carry the picture, and the "
                            "description tends to pull the result toward a "
                            "paraphrase of the source."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING")
    RETURN_NAMES = ("positive", "negative")
    OUTPUT_TOOLTIPS = (
        "Prompt conditioning with the reference latents attached.",
        "Negative prompt conditioning.",
    )
    FUNCTION = "encode"

    def encode(
        self,
        clip,
        prompt,
        negative_prompt="",
        vae=None,
        reference=None,
        extra_image=None,
        vlm_reference=False,
    ):
        references = [image for image in (reference, extra_image) if image is not None]

        images_vl = []
        image_prompt = ""
        if vlm_reference and references:
            for index, image in enumerate(references):
                images_vl.append(image)
                image_prompt += (
                    f"Picture {index + 1}: <|vision_start|><|image_pad|><|vision_end|>"
                )

        if images_vl:
            if KREA2_TEMPLATE is not None:
                tokens = clip.tokenize(
                    image_prompt + prompt,
                    images=images_vl,
                    llama_template=KREA2_TEMPLATE,
                )
            else:
                tokens = clip.tokenize(image_prompt + prompt, images=images_vl)
        else:
            tokens = clip.tokenize(prompt)
        positive = clip.encode_from_tokens_scheduled(tokens)

        if vae is not None and references and node_helpers is not None:
            latents = [
                vae.encode(build_reference_image(image, REFERENCE_MAX_EDGE)[:, :, :, :3])
                for image in references
            ]
            positive = node_helpers.conditioning_set_values(
                positive, {"reference_latents": latents}, append=True
            )

        negative = clip.encode_from_tokens_scheduled(clip.tokenize(negative_prompt or ""))
        return (positive, negative)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Krea2Encode": AusBossKrea2Encode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Krea2Encode": "Krea 2 Encode 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
