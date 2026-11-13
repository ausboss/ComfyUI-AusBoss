"""Edit Lock 🆎 and Edit Lock Restore 🆎: an edit leaves the rest of the picture alone.

An edit model redraws the whole picture, so the parts nobody asked to change
come back a little moved and a little tinted. Edit Lock watches the model's
own prediction at every step, reads where it differs from the original, and
puts the original back everywhere else, so the model finishes the edit on
top of the real picture. Edit Lock Restore then swaps the original's own
pixels in for those parts after the decode. The deciding and blending live
in _edit_lock_helpers.py.
"""

from __future__ import annotations

import torch

from ._edit_lock_helpers import (
    LOCK_MODES,
    EditLock,
    describe,
    restore_pixels,
)
from ._edit_tint_helpers import take_out_tint


class AusBossEditLock:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Keeps every part of your picture that an edit did not change "
        "exactly where it was, with the colors it had. Edit models redraw "
        "the whole picture, so untouched parts often come back slightly "
        "zoomed, shifted or tinted. Put this between the model and the "
        "sampler and give it the picture you are editing. It needs no "
        "mask: it sees what the edit changes while the picture is made. "
        "When the edit changes the whole picture (a new style, new light, "
        "new weather) it steps aside. Add Edit Lock Restore 🆎 after the "
        "decode to get your own pixels back in the untouched parts."
    )
    SEARCH_ALIASES = [
        "edit lock",
        "pixel drift",
        "pixel shift",
        "color shift",
        "consistency",
        "keep unchanged",
        "preserve original",
        "tail steer",
        "no drift edit",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {"tooltip": "The edit model. Patch last, after any LoRAs."},
                ),
                "vae": (
                    "VAE",
                    {"tooltip": "The same VAE the workflow decodes with."},
                ),
                "image": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The picture you are editing, at the size of the "
                            "result. Use the same picture the edit model gets."
                        ),
                    },
                ),
                "lock": (
                    list(LOCK_MODES),
                    {
                        "default": LOCK_MODES[0],
                        "tooltip": (
                            "auto locks the untouched parts and steps aside "
                            "when the whole picture changes. always locks "
                            "even then. off does nothing."
                        ),
                    },
                ),
                "tolerance": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.25,
                        "max": 4.0,
                        "step": 0.05,
                        "tooltip": (
                            "How big a change must be to count as part of the "
                            "edit. Raise it if the lock lets small unwanted "
                            "changes through; lower it if it holds back part "
                            "of your edit."
                        ),
                    },
                ),
            },
            "optional": {
                "mask": (
                    "MASK",
                    {
                        "tooltip": (
                            "Optional. White marks where the edit may happen; "
                            "everything else is locked. With a mask the node "
                            "does not look for the change itself."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("MODEL", "AUSBOSS_EDIT_LOCK")
    RETURN_NAMES = ("model", "edit_lock")
    OUTPUT_TOOLTIPS = (
        "The model with the lock on. Plug it into the sampler.",
        "What the lock kept. Plug it into Edit Lock Restore 🆎 after the decode.",
    )
    FUNCTION = "patch"

    def patch(self, model, vae, image, lock, tolerance, mask=None):
        if image.ndim != 4:
            raise ValueError("Edit Lock: image must be an IMAGE batch.")
        state = EditLock(mode=str(lock), tolerance=float(tolerance))
        source = image[:1, ..., :3]
        state.source = source.detach().float().cpu()
        if mask is not None:
            state.user_mask = mask.detach().float().cpu()
        if state.mode == "off":
            state.status = "off"
            return (model, state)
        latent = vae.encode(source)
        patched = model.clone()
        state.latent = patched.model.process_latent_in(latent).detach().float().cpu()
        patched.set_model_sampler_post_cfg_function(state.step)
        return (patched, state)


class AusBossEditLockRestore:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Puts your picture's own pixels back in every part the edit did not "
        "change. Use it right after the VAE decode, with the edit_lock "
        "output of Edit Lock 🆎. The untouched parts then match your "
        "original pixel for pixel; only the edit is new. It also takes out "
        "the faint pink tint some edit models add to the whole picture, "
        "which matters most when the lock stepped aside (a new hair color, "
        "background or weather)."
    )
    SEARCH_ALIASES = [
        "edit lock restore",
        "restore original pixels",
        "paste back",
        "keep unchanged",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "The edited picture, straight from the VAE decode."},
                ),
                "edit_lock": (
                    "AUSBOSS_EDIT_LOCK",
                    {"tooltip": "From Edit Lock 🆎."},
                ),
                "feather": (
                    "INT",
                    {
                        "default": 16,
                        "min": 0,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "How softly your original fades into the edit, in "
                            "pixels. The fade stays outside the edit."
                        ),
                    },
                ),
            },
            "optional": {
                "remove_tint": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Takes out the faint pink tint the edit model adds "
                            "to the whole picture. Edits meant to recolor "
                            "everything, like golden hour, are left alone."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "edit_mask", "report")
    OUTPUT_TOOLTIPS = (
        "The edit with your original pixels in the untouched parts.",
        "White where the edit changed the picture.",
        "How much of the picture was kept. Plug it into Show Text 🆎 to read it.",
    )
    FUNCTION = "restore"

    def restore(self, image, edit_lock, feather, remove_tint=True):
        if image.ndim != 4:
            raise ValueError("Edit Lock Restore: image must be an IMAGE batch.")
        if not isinstance(edit_lock, EditLock):
            raise ValueError("Edit Lock Restore: edit_lock needs the output of Edit Lock.")
        height, width = int(image.shape[1]), int(image.shape[2])
        report = describe(edit_lock)
        if remove_tint and edit_lock.source is not None:
            # before the paste, so the edit itself loses the tint too and meets the original evenly
            image, taken = take_out_tint(image, edit_lock.source)
            if taken is not None:
                report += " " + tint_report(taken)
        mask = edit_lock.pixel_mask(height, width)
        if mask is None or edit_lock.source is None:
            return (image, torch.ones((int(image.shape[0]), height, width)), report)
        result, edit_mask = restore_pixels(image, edit_lock.source, mask, int(feather))
        return (result, edit_mask, report)


def tint_report(shift):
    """One plain sentence; the numbers are Lab units, for anyone who wants them."""
    light, a, b = shift
    return (f"It also took out the faint pink tint the model added to the whole picture "
            f"(L {light:+.1f}, a {a:+.1f}, b {b:+.1f}).")


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_EditLock": AusBossEditLock,
    "AUSBOSS_NODES_EditLockRestore": AusBossEditLockRestore,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_EditLock": "Edit Lock 🆎",
    "AUSBOSS_NODES_EditLockRestore": "Edit Lock Restore 🆎",
}
