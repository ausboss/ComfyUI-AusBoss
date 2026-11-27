"""Photo Camera 🆎: the camera your photo was taken with, for a 3D model
built to line up with the photo (Pixal3D).

Give it the photo, the subject's mask and the photo's field of view (MoGe's
Get FoV measures it). It hands on the crop's field of view for Pixal3D
Conditioning, the photo's camera for the 3D viewer (so the viewer opens on
your photo's own view), and where the photo goes on the 360 canvas so the
360 lines up with the camera. The maths is in _photo_camera_helpers.
"""

from __future__ import annotations

import logging

from ._photo_camera_helpers import photo_camera, subject_box


def _crop_box(image, mask, pad_factor: float, max_side: int):
    """The square Crop to Mask cuts. Core's own helper when it is there, so
    the two agree to the pixel; the same rule of ours otherwise."""
    try:
        from comfy_extras.nodes_images import _crop_image_with_mask

        _, box, size = _crop_image_with_mask(image[0, :, :, :3], mask[0], max_image_size=max_side,
                                             pad_factor=pad_factor, aspect_ratio=1.0)
        return tuple(float(v) for v in box), (int(size[0]), int(size[1]))
    except Exception as error:  # an older or newer ComfyUI: fall back to ours
        logging.info("Photo Camera: using its own crop box (%s)", type(error).__name__)
        return subject_box(mask[0].float().cpu().numpy(), pad_factor, max_side)


class AusBossPhotoCamera:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Works out the camera your photo was taken with, so a 3D model of the "
        "person lines up with the photo. Wire in the photo, the person's mask "
        "and the photo's field of view (Get FoV from MoGe measures it). Send "
        "crop_fov to Pixal3D Conditioning, camera_info to the 3D viewer, and "
        "the strip numbers to where the photo is laid on the 360. The viewer "
        "then opens on your photo's own view, with the 360 behind it lined up."
    )
    SEARCH_ALIASES = ["photo camera", "camera", "match camera", "pixal3d", "line up", "3d", "fov", "360", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Your photo, the same one Crop to Mask cuts the person from."}),
                "mask": ("MASK", {"tooltip": "The person, white on black: the same mask Crop to Mask uses."}),
                "fov": ("FLOAT", {"default": 55.0, "min": 1.0, "max": 170.0, "step": 0.1,
                                  "tooltip": "How wide the photo is, in degrees across. Wire Get FoV from MoGe here; 55 suits most phone photos."}),
                "pad_factor": ("FLOAT", {"default": 1.1, "min": 1.0, "max": 2.0, "step": 0.01,
                                         "tooltip": "The margin Crop to Mask adds around the person. Keep the two the same."}),
                "canvas_width": ("INT", {"default": 2048, "min": 8, "max": 16384, "step": 8,
                                         "tooltip": "Width of the 360 canvas the photo is laid on."}),
            },
        }

    RETURN_TYPES = ("FLOAT", "LOAD3D_CAMERA", "INT", "INT", "INT")
    RETURN_NAMES = ("crop_fov", "camera_info", "strip_width", "strip_x", "strip_y")
    OUTPUT_TOOLTIPS = (
        "The crop's field of view, for Pixal3D Conditioning.",
        "Your photo's camera, for the 3D viewer's camera_info: it opens on the photo's own view.",
        "How wide the photo is on the 360 canvas, in pixels.",
        "Where the photo's left edge goes on the 360 canvas.",
        "Where the photo's top edge goes on the 360 canvas.",
    )
    FUNCTION = "solve"

    def solve(self, image, mask, fov, pad_factor, canvas_width):
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        if tuple(mask.shape[-2:]) != tuple(image.shape[1:3]):
            import comfy.utils

            mask = comfy.utils.common_upscale(mask.unsqueeze(1).float(), image.shape[2], image.shape[1],
                                              "bilinear", "disabled").squeeze(1)
        box, size = _crop_box(image, mask, float(pad_factor), 1024)
        out = photo_camera(box, size, float(fov), int(canvas_width))
        shown = [round(float(fov), 1), round(out["crop_fov"], 1), out["strip_width"], out["strip_x"], out["strip_y"]]
        return {"ui": {"ausboss_photo_camera": shown},
                "result": (out["crop_fov"], out["camera_info"], out["strip_width"], out["strip_x"], out["strip_y"])}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_PhotoCamera": AusBossPhotoCamera}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_PhotoCamera": "Photo Camera 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
