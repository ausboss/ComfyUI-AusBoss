"""Tiled Upscale 🆎 and Tiled Upscale Stitch 🆎."""

from __future__ import annotations

import sys

import torch

from ._color_helpers import lab_to_rgb, rgb_to_lab
from ._resize_helpers import resample_batch
from ._tile_helpers import describe_plan, plan_tiles

STITCHER_KIND = "ausboss_tile_stitcher"
NEEDS_UPSCALE_NODE = (
    "Tiled Upscale could not find ComfyUI's Upscale Image (using Model) node. "
    "Update ComfyUI, or unplug the upscale model: the picture is then enlarged the plain way."
)


def _core_nodes() -> dict:
    """ComfyUI's own node classes, by key. Empty outside ComfyUI."""
    mappings = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", None)
    return mappings if isinstance(mappings, dict) else {}


def _rgb(image: torch.Tensor, who: str) -> torch.Tensor:
    """A BHWC float batch with exactly three channels."""
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError(f"{who} expected a BHWC IMAGE batch.")
    image = image.float()
    if image.shape[-1] == 1:
        return image.expand(-1, -1, -1, 3)
    return image[..., :3]


def _model_enlarge(upscale_model, image: torch.Tensor, width: int, height: int) -> torch.Tensor:
    """Enlarge with an upscale model until the picture covers the target.

    ComfyUI's own Upscale Image (using Model) node does each pass; nothing
    of it is copied here. The result is larger than or equal to the target
    and is brought to the exact size by the caller.
    """
    runner = _core_nodes().get("ImageUpscaleWithModel")
    if runner is None or not hasattr(runner, "execute"):
        raise RuntimeError(NEEDS_UPSCALE_NODE)
    for _ in range(4):
        if image.shape[2] >= width and image.shape[1] >= height:
            break
        before = image.shape[1:3]
        image = runner.execute(upscale_model=upscale_model, image=image).result[0]
        image = _rgb(image, "Tiled Upscale")
        if image.shape[1] <= before[0] or image.shape[2] <= before[1]:
            break  # a 1x model: nothing more to gain
    return image


class AusBossTiledUpscale:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Sets the size of the finished picture in megapixels and cuts your "
        "picture into tiles a model can redraw one at a time. A picture "
        "that fits in one tile stays whole. Send the tiles through your "
        "sampler, then into Tiled Upscale Stitch 🆎 with the stitcher. A small "
        "picture is not redrawn far past the detail it has: it is redrawn "
        "at most max_growth times its own megapixels and enlarged the plain "
        "way from there. The report says what was done with your picture."
    )
    SEARCH_ALIASES = [
        "tiled upscale",
        "tile upscale",
        "tiles",
        "split into tiles",
        "megapixels",
        "upscale",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": (
                    "IMAGE",
                    {"tooltip": "The picture to enlarge and cut into tiles."},
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": 4.0,
                        "min": 0.0,
                        "max": 64.0,
                        "step": 0.05,
                        "tooltip": (
                            "Size of the finished picture, in megapixels. 0 "
                            "keeps the picture's own size."
                        ),
                    },
                ),
            },
            "optional": {
                "upscale_model": (
                    "UPSCALE_MODEL",
                    {
                        "tooltip": (
                            "Optional. Enlarges the picture with an upscale "
                            "model before it is cut into tiles. Unplugged, "
                            "it is enlarged the plain way (lanczos)."
                        )
                    },
                ),
                "tile_megapixels": (
                    "FLOAT",
                    {
                        "default": 2.0,
                        "min": 0.25,
                        "max": 16.0,
                        "step": 0.05,
                        "tooltip": (
                            "The most your model redraws at once. A picture "
                            "up to about this size stays in one tile. 2 "
                            "suits Qwen Image 2.1 and Krea 2; use 1 for SDXL."
                        ),
                    },
                ),
                "overlap": (
                    "INT",
                    {
                        "default": 128,
                        "min": 0,
                        "max": 1024,
                        "step": 8,
                        "tooltip": (
                            "How many pixels neighbouring tiles share. The "
                            "join is blended across this strip."
                        ),
                    },
                ),
                "multiple": (
                    "INT",
                    {
                        "default": 32,
                        "min": 1,
                        "max": 256,
                        "step": 1,
                        "tooltip": (
                            "Every tile's width and height is a multiple of "
                            "this. 32 works with every model tried; Qwen "
                            "Image 2.1 needs it."
                        ),
                    },
                ),
                "max_growth": (
                    "FLOAT",
                    {
                        "default": 8.0,
                        "min": 1.0,
                        "max": 64.0,
                        "step": 0.5,
                        "tooltip": (
                            "A small picture is redrawn at no more than this "
                            "many times its own megapixels, and enlarged the "
                            "plain way from there. Raise it to redraw a tiny "
                            "picture at a big size anyway."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "AUSBOSS_TILE_STITCHER", "IMAGE", "INT", "INT", "STRING")
    RETURN_NAMES = ("tiles", "stitcher", "before", "width", "height", "report")
    OUTPUT_IS_LIST = (True, False, False, False, False, False)
    OUTPUT_TOOLTIPS = (
        "The tiles, one after another. Nodes after this run once per tile.",
        "What Tiled Upscale Stitch 🆎 needs to put the tiles back together.",
        "Your picture enlarged the plain way to the finished size: the before picture.",
        "Width of the finished picture in pixels.",
        "Height of the finished picture in pixels.",
        "What was done with your picture, in one or two sentences.",
    )
    FUNCTION = "split"

    def split(
        self,
        image,
        megapixels,
        upscale_model=None,
        tile_megapixels=2.0,
        overlap=128,
        multiple=32,
        max_growth=8.0,
    ):
        source = _rgb(image, "Tiled Upscale")
        height, width = int(source.shape[1]), int(source.shape[2])
        plan = plan_tiles(
            width, height, megapixels, tile_megapixels, overlap, multiple, max_growth
        )
        redraw_width, redraw_height = plan["redraw"]
        result_width, result_height = plan["result"]

        enlarged = source
        # A redraw within a grid step of the picture's own size is not worth a model pass.
        if upscale_model is not None and redraw_width * redraw_height > width * height * 1.05:
            enlarged = _model_enlarge(upscale_model, source, redraw_width, redraw_height)
        base = resample_batch(enlarged, redraw_width, redraw_height, "lanczos")
        before = resample_batch(source, result_width, result_height, "lanczos")
        tiles = [
            base[:, top:bottom, left:right, :].contiguous()
            for left, top, right, bottom in plan["boxes"]
        ]
        stitcher = {"kind": STITCHER_KIND, "version": 1, "plan": plan, "tiles": tiles}
        report = describe_plan(plan)
        return (tiles, stitcher, before, result_width, result_height, report)


# Colors are compared on a copy this many cells long on its long side, each
# cell the average of the pixels under it.
COLOR_CELLS = 32
# LAB units. Keeps a channel that is nearly flat in both pictures (the color
# of a black and white photo) at a gain near 1.
COLOR_FLOOR = 0.5
COLOR_GAIN_MAX = 3.0


def _averaged_lab(rgb: torch.Tensor) -> torch.Tensor:
    """LAB of a small averaged copy: fine detail gone, the colors kept."""
    height, width = int(rgb.shape[1]), int(rgb.shape[2])
    scale = COLOR_CELLS / max(height, width)
    size = (max(2, min(height, round(height * scale))), max(2, min(width, round(width * scale))))
    small = torch.nn.functional.interpolate(rgb.movedim(-1, 1), size=size, mode="area")
    return rgb_to_lab(small.movedim(1, -1))


def _keep_colors(tile: torch.Tensor, source: torch.Tensor, strength: float) -> torch.Tensor:
    """Bring a redrawn tile to the colors of the tile it came from.

    A redrawn tile shows the same thing in the same place as its source, so
    each LAB channel gets a straight-line fit, source = gain x redraw +
    offset, taken on small averaged copies of both. A fit follows what the
    two pictures share: noise in an old photo does not tilt it. Matching
    each channel's spread instead (what Color Match's lab method does, and
    what an unrelated reference needs) counts that noise as color, and a
    clean redraw of a pale, noisy photo came back up to twice as saturated.
    """
    mine, wanted = _averaged_lab(tile), _averaged_lab(source)
    mean = mine.mean(dim=(1, 2), keepdim=True)
    wanted_mean = wanted.mean(dim=(1, 2), keepdim=True)
    variance = ((mine - mean) ** 2).mean(dim=(1, 2), keepdim=True)
    shared = ((mine - mean) * (wanted - wanted_mean)).mean(dim=(1, 2), keepdim=True)
    gain = ((shared + COLOR_FLOOR**2) / (variance + COLOR_FLOOR**2)).clamp(0.0, COLOR_GAIN_MAX)
    matched = lab_to_rgb((rgb_to_lab(tile) - mean) * gain + wanted_mean)
    return tile + (matched - tile) * strength


def _ramp(length: int, rise: int, fall: int) -> torch.Tensor:
    """Blend weights along one side of a tile: up over ``rise`` pixels at the
    start, down over ``fall`` at the end, 1 between. A rise and the
    neighbour's fall over the same strip add up to 1."""
    weights = torch.ones(length, dtype=torch.float32)
    rise = max(0, min(int(rise), length))
    fall = max(0, min(int(fall), length))
    if rise:
        weights[:rise] = torch.arange(1, rise + 1, dtype=torch.float32) / (rise + 1)
    if fall:
        weights[length - fall :] *= torch.arange(fall, 0, -1, dtype=torch.float32) / (fall + 1)
    return weights


def _shared(starts: list[int], size: int, start: int) -> tuple[int, int]:
    """Pixels this tile shares with the tile before and the tile after."""
    index = starts.index(start)
    before = starts[index - 1] + size - start if index > 0 else 0
    after = start + size - starts[index + 1] if index + 1 < len(starts) else 0
    return max(0, before), max(0, after)


class AusBossTiledUpscaleStitch:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Puts the tiles from Tiled Upscale 🆎 back together after your "
        "model has redrawn them, blends the joins and brings the picture to "
        "the size you asked for. Keep colors matches each tile to the same "
        "tile of your picture first, so the tiles agree with each other and "
        "the picture keeps its own colors."
    )
    SEARCH_ALIASES = [
        "tiled upscale stitch",
        "join tiles",
        "merge tiles",
        "tiled upscale",
        "ausboss",
    ]
    INPUT_IS_LIST = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "tiles": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "The redrawn tiles, in the order Tile For "
                            "Upscale 🆎 gave them. A tile that came back at "
                            "another size is fitted to its place."
                        )
                    },
                ),
                "stitcher": (
                    "AUSBOSS_TILE_STITCHER",
                    {"tooltip": "The stitcher from Tiled Upscale 🆎."},
                ),
            },
            "optional": {
                "keep_colors": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.05,
                        "tooltip": (
                            "1 keeps your picture's colors: each tile is "
                            "matched to the same tile of your picture. Lower "
                            "lets the model's colors through; 0 is off."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The finished picture at the size you asked for.",)
    FUNCTION = "stitch"

    def stitch(self, tiles, stitcher, keep_colors=None):
        stitcher = stitcher[0] if isinstance(stitcher, (list, tuple)) else stitcher
        if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
            raise ValueError(
                "Tiled Upscale Stitch needs the stitcher from Tiled Upscale 🆎."
            )
        strength = keep_colors[0] if isinstance(keep_colors, (list, tuple)) and keep_colors else keep_colors
        strength = 1.0 if strength is None else max(0.0, min(1.0, float(strength)))
        plan = stitcher["plan"]
        boxes = plan["boxes"]
        sources = stitcher["tiles"]

        redrawn = [_rgb(tile, "Tiled Upscale Stitch") for tile in (tiles if isinstance(tiles, (list, tuple)) else [tiles])]
        if len(redrawn) == 1 and len(boxes) > 1 and redrawn[0].shape[0] % len(boxes) == 0:
            # the tiles came back as one batch: split it the way it was made
            per_tile = redrawn[0].shape[0] // len(boxes)
            redrawn = list(redrawn[0].split(per_tile, dim=0))
        if len(redrawn) != len(boxes):
            raise ValueError(
                f"Tiled Upscale Stitch got {len(redrawn)} tiles and the stitcher has {len(boxes)}. "
                "Send every tile from Tiled Upscale 🆎 through the same nodes, in order."
            )

        redraw_width, redraw_height = plan["redraw"]
        result_width, result_height = plan["result"]
        tile_width, tile_height = plan["tile"]
        lefts = sorted({box[0] for box in boxes})
        tops = sorted({box[1] for box in boxes})
        batch = max(tile.shape[0] for tile in redrawn)
        total = torch.zeros((batch, redraw_height, redraw_width, 3), dtype=torch.float32)
        weight = torch.zeros((redraw_height, redraw_width), dtype=torch.float32)

        for tile, source, (left, top, right, bottom) in zip(redrawn, sources, boxes):
            tile = resample_batch(tile.cpu(), tile_width, tile_height, "lanczos")
            if strength > 0.0:
                reference = source.cpu()
                if reference.shape[0] not in (1, tile.shape[0]):
                    reference = reference[:1]
                tile = _keep_colors(tile, reference, strength)
            share_left, share_right = _shared(lefts, tile_width, left)
            share_top, share_bottom = _shared(tops, tile_height, top)
            mask = _ramp(tile_height, share_top, share_bottom)[:, None] * _ramp(tile_width, share_left, share_right)[None, :]
            total[:, top:bottom, left:right, :] += tile * mask[None, :, :, None]
            weight[top:bottom, left:right] += mask

        merged = total / weight.clamp_min(1e-6)[None, :, :, None]
        merged = resample_batch(merged.clamp_(0.0, 1.0), result_width, result_height, "lanczos")
        return (merged,)


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_TiledUpscale": AusBossTiledUpscale,
    "AUSBOSS_NODES_TiledUpscaleStitch": AusBossTiledUpscaleStitch,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_TiledUpscale": "Tiled Upscale 🆎",
    "AUSBOSS_NODES_TiledUpscaleStitch": "Tiled Upscale Stitch 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
