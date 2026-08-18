"""Krea 2 Outpaint Model Patch 🆎."""

from __future__ import annotations

import math

from ._krea2_helpers import extract_bbox_norm

# comfy and _krea2_core (which reaches into comfy's flux layers) are imported
# inside patch(), not here. A core update that moves one of those internals
# then surfaces as a clear error on the node that needs it, instead of
# deleting the node from the menu at import time and leaving a saved workflow
# reporting it as missing.


class AusBossKrea2OutpaintModelPatch:
    CATEGORY = "🆎 AusBoss/Krea2"
    DESCRIPTION = (
        "Teaches Krea 2 where a reference image belongs on the canvas. "
        "Reference latents normally arrive with no position, so the model "
        "treats them as a loose style hint; this registers them into the "
        "target grid at the rectangle the stitcher reports, which is what "
        "makes an outpaint continue the source instead of reinventing it. "
        "Place it after any LoRA loader and before the sampler."
    )
    SEARCH_ALIASES = [
        "krea2 outpaint patch",
        "krea2 model patch",
        "registered reference",
        "reference placement",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {"tooltip": "A Krea 2 model. Patch last, after any LoRAs."},
                ),
                "stitcher": (
                    "AUSBOSS_STITCHER",
                    {
                        "tooltip": (
                            "From Load Image + Pad 🆎 — supplies the rectangle "
                            "the source occupies on the canvas. A stitcher "
                            "without one places the reference over the full "
                            "frame."
                        )
                    },
                ),
                "kv_cache": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Compute the reference's keys and values once per "
                            "run instead of every step. The reference does not "
                            "change while sampling, so this is free speed; turn "
                            "it off only to rule the cache out when debugging."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("MODEL",)
    OUTPUT_TOOLTIPS = (
        "The model with reference tokens registered into the canvas grid.",
    )
    FUNCTION = "patch"

    def patch(self, model, stitcher, kv_cache=True):
        import comfy.conds

        from . import _krea2_core as core

        bbox_norm = extract_bbox_norm(stitcher)

        patched = model.clone()
        base_model = patched.model
        dit = patched.get_model_object("diffusion_model")

        orig_extra_conds = base_model.extra_conds
        orig_extra_conds_shapes = base_model.extra_conds_shapes
        orig_forward = dit.forward

        def extra_conds(**kwargs):
            out = orig_extra_conds(**kwargs)
            ref_latents = kwargs.get("reference_latents", None)
            if ref_latents is not None:
                out["ref_latents"] = comfy.conds.CONDList(
                    [base_model.process_latent_in(lat) for lat in ref_latents]
                )
            return out

        def extra_conds_shapes(**kwargs):
            out = orig_extra_conds_shapes(**kwargs)
            ref_latents = kwargs.get("reference_latents", None)
            if ref_latents is not None:
                out["ref_latents"] = list(
                    [1, 16, sum(math.prod(a.size()) for a in ref_latents) // 16]
                )
            return out

        state = {"last_sigma": None, "caches": {}}

        def forward(
            x,
            timesteps,
            context,
            attention_mask=None,
            transformer_options={},
            ref_latents=None,
            **kwargs,
        ):
            # Nothing to place: leave the model exactly as it was.
            if ref_latents is None or len(ref_latents) == 0:
                return orig_forward(
                    x,
                    timesteps,
                    context,
                    attention_mask=attention_mask,
                    transformer_options=transformer_options,
                    **kwargs,
                )

            sigma = float(timesteps.max())
            sample_sigmas = transformer_options.get("sample_sigmas", None)
            # Sigma climbing back up means a new run started, so the cached
            # reference belongs to the previous one.
            new_run = state["last_sigma"] is None or sigma > state["last_sigma"]
            if (
                sample_sigmas is not None
                and sigma == float(sample_sigmas[0])
                and sigma != state["last_sigma"]
            ):
                new_run = True
            if new_run:
                state["caches"].clear()
            state["last_sigma"] = sigma

            batch = x.shape[0] * (x.shape[2] if x.ndim == 5 else 1)
            ref_kv = None
            key = None
            if kv_cache:
                key = core._ref_fingerprint(ref_latents, batch, bbox_norm)
                ref_kv = state["caches"].get(key)
            if ref_kv is None:
                ref_kv = core._precompute_ref_kv(
                    dit,
                    x,
                    timesteps,
                    ref_latents,
                    transformer_options,
                    bbox_norm=bbox_norm,
                )
                if kv_cache:
                    state["caches"][key] = ref_kv
            return core._forward_with_cached_refs(
                dit, x, timesteps, context, ref_kv, transformer_options
            )

        patched.add_object_patch("extra_conds", extra_conds)
        patched.add_object_patch("extra_conds_shapes", extra_conds_shapes)
        patched.add_object_patch("diffusion_model.forward", forward)
        return (patched,)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_Krea2OutpaintModelPatch": AusBossKrea2OutpaintModelPatch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_Krea2OutpaintModelPatch": "Krea 2 Outpaint Model Patch 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
