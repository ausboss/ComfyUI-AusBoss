"""Crop-for-inpaint geometry and stitching shared by AusBoss nodes.

The contract is a two-rect canvas:

* ``canvas`` is the original image, edge-replicate padded only when the
  grown context rect truly cannot fit inside the frame.
* ``canvas_to_original`` locates the untouched original inside the canvas.
* ``crop_to_canvas`` locates the crop handed to the sampler inside the
  canvas.

Stitching blends the (possibly resized) inpainted crop into the canvas
with a feathered blend mask, then slices ``canvas_to_original`` back out.
Because the original pixels sit verbatim in the canvas and the blend is
applied as ``canvas + blend * (inpainted - canvas)`` with a hard zero
guard, every pixel outside the blend region is bit-identical to the
input image — nothing outside the crop ever round-trips a resize. The
optional edge-halo spread only swaps the color that gets blended in, so
that guarantee holds with the toggle on as well.
"""

from __future__ import annotations

import torch
import torch.nn.functional as functional

from ._mask_helpers import blur_mask, grow_shrink_mask

STITCHER_KIND = "ausboss_inpaint_stitcher"
STITCHER_VERSION = 1

Rect = tuple[int, int, int, int]  # (x, y, w, h)


# --- pure geometry -----------------------------------------------------------


def round_up_to_multiple(value: int, multiple: int) -> int:
    """Smallest multiple of ``multiple`` that is >= ``value``."""
    multiple = max(1, int(multiple))
    value = max(1, int(value))
    return ((value + multiple - 1) // multiple) * multiple


def mask_bbox(mask: torch.Tensor) -> Rect | None:
    """Tight bounding box of all nonzero pixels, unioned across the batch.

    Returns ``None`` for an empty mask.
    """
    covered = mask > 0
    if not bool(covered.any()):
        return None
    rows = covered.any(dim=2).any(dim=0)
    cols = covered.any(dim=1).any(dim=0)
    row_idx = torch.nonzero(rows).flatten()
    col_idx = torch.nonzero(cols).flatten()
    y0, y1 = int(row_idx[0]), int(row_idx[-1]) + 1
    x0, x1 = int(col_idx[0]), int(col_idx[-1]) + 1
    return (x0, y0, x1 - x0, y1 - y0)


def grow_rect(rect: Rect, factor: float) -> Rect:
    """Grow a rect symmetrically so each side scales by ``factor``."""
    x, y, w, h = rect
    new_w = max(1, round(w * float(factor)))
    new_h = max(1, round(h * float(factor)))
    return (x - (new_w - w) // 2, y - (new_h - h) // 2, new_w, new_h)


def expand_rect_to_multiple(rect: Rect, multiple: int) -> Rect:
    """Grow a rect symmetrically until both sides are multiples."""
    x, y, w, h = rect
    new_w = round_up_to_multiple(w, multiple)
    new_h = round_up_to_multiple(h, multiple)
    return (x - (new_w - w) // 2, y - (new_h - h) // 2, new_w, new_h)


def fit_rect(rect: Rect, bounds_w: int, bounds_h: int) -> Rect:
    """Shift a rect fully into bounds; center it when it cannot fit.

    The size is never changed: a rect wider or taller than the bounds is
    centered so its overflow splits evenly — that overflow becomes the
    replicate-padded canvas margin.
    """
    x, y, w, h = rect
    if w <= bounds_w:
        x = min(max(x, 0), bounds_w - w)
    else:
        x = -((w - bounds_w) // 2)
    if h <= bounds_h:
        y = min(max(y, 0), bounds_h - h)
    else:
        y = -((h - bounds_h) // 2)
    return (x, y, w, h)


def rect_margins(rect: Rect, bounds_w: int, bounds_h: int) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) overflow of a rect past the bounds."""
    x, y, w, h = rect
    return (max(0, -x), max(0, -y), max(0, x + w - bounds_w), max(0, y + h - bounds_h))


# --- tensor plumbing ---------------------------------------------------------


def _as_image(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("Crop For Inpaint expected a BHWC IMAGE batch.")
    return image.float()


def _as_mask(mask: torch.Tensor, image: torch.Tensor) -> torch.Tensor:
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError("Crop For Inpaint expected a BHW MASK.")
    if mask.shape[1:] != image.shape[1:3]:
        raise ValueError(
            f"Mask size {tuple(mask.shape[1:])} does not match "
            f"image size {tuple(image.shape[1:3])}."
        )
    if mask.shape[0] not in (1, image.shape[0]):
        raise ValueError(
            f"Mask batch {mask.shape[0]} cannot broadcast across "
            f"image batch {image.shape[0]}."
        )
    return mask.float().clamp(0.0, 1.0)


RESIZE_ALGORITHMS = ("bilinear", "bicubic", "area", "nearest")


def _resize_image(
    image: torch.Tensor, width: int, height: int, algorithm: str = "bilinear"
) -> torch.Tensor:
    if algorithm not in RESIZE_ALGORITHMS:
        raise ValueError(
            f"Crop For Inpaint rescale_algorithm must be one of "
            f"{RESIZE_ALGORITHMS}, not '{algorithm}'."
        )
    moved = image.movedim(-1, 1).contiguous()
    if algorithm == "nearest":
        resized = functional.interpolate(moved, size=(height, width), mode="nearest-exact")
    elif algorithm == "area":
        resized = functional.interpolate(moved, size=(height, width), mode="area")
    else:
        antialias = width < moved.shape[-1] or height < moved.shape[-2]
        resized = functional.interpolate(
            moved,
            size=(height, width),
            mode=algorithm,
            align_corners=False,
            antialias=antialias,
        )
    return resized.movedim(1, -1).contiguous()


def _resize_mask(mask: torch.Tensor, width: int, height: int) -> torch.Tensor:
    resized = functional.interpolate(
        mask.unsqueeze(1), size=(height, width), mode="nearest-exact"
    )
    return resized.squeeze(1)


def _replicate_pad_image(
    image: torch.Tensor, left: int, top: int, right: int, bottom: int
) -> torch.Tensor:
    moved = image.movedim(-1, 1).contiguous()
    padded = functional.pad(moved, (left, right, top, bottom), mode="replicate")
    return padded.movedim(1, -1).contiguous()


# --- optional edge-halo spread -----------------------------------------------

# The spread estimates against the exact mask the composite uses - never a
# dilated one. Measured on flat, gradient, noisy and hard-edged backgrounds:
# each pixel of dilation throws away roughly half of the remaining correction
# (1px leaves ~45% of the halo, 2px leaves ~75%), and the opposite-sign rim
# dilation would guard against never showed up above the noise floor.

_PYMATTING_HINT = (
    "Stitch Inpaint: fix_edge_halo needs the optional 'pymatting' package "
    "(add the pymatting package); pasting the edge pixels unchanged."
)

_warned: set[str] = set()


def _warn_once(message: str) -> None:
    """Print an ASCII console note at most once per process."""
    if message in _warned:
        return
    _warned.add(message)
    print(f"[AusBoss] {message}")


def _foreground_estimator():
    """pymatting's multi-level foreground estimator, or None when absent."""
    try:
        from pymatting import estimate_foreground_ml
    except Exception:
        return None
    return estimate_foreground_ml


def _raise_if_interrupted() -> None:
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
    except ImportError:  # Offline tests run without ComfyUI.
        return
    throw_exception_if_processing_interrupted()


def _progress_bar(total: int):
    try:
        from comfy.utils import ProgressBar
    except ImportError:  # Offline tests run without ComfyUI.
        return None
    return ProgressBar(total)


def spread_edge_colors(patch: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    """True foreground color of ``patch``, spread across the blend band.

    A semi-transparent seam pixel carries a mix of the inpainted color and
    the background it was generated against. Blending that mix in a second
    time multiplies the background contribution twice and reads as a dark
    or light halo along the seam. Estimating the unmixed color first and
    compositing *that* keeps the seam neutral.

    Returns ``patch`` untouched when pymatting is missing (one warning), when
    the estimate fails, or when the mask has no semi-transparent pixels to
    fix. Only the pasted color changes: the caller still weights with the
    ungrown mask, so zero-weight pixels stay bit-identical.

    The solve runs on the CPU, one frame at a time, and reports progress and
    honors a cancel between frames.
    """
    if not bool(((alpha > 0.0) & (alpha < 1.0)).any()):
        return patch
    estimate = _foreground_estimator()
    if estimate is None:
        _warn_once(_PYMATTING_HINT)
        return patch

    matte_alpha = alpha
    if matte_alpha.shape[0] == 1 and patch.shape[0] > 1:
        matte_alpha = matte_alpha.expand(patch.shape[0], -1, -1)

    # Cost, measured on a 16-thread desktop CPU with pymatting 1.1.15: about
    # 90 ms per megapixel of paste window, per frame - 48 ms for the 768x768
    # window a 1024x1024 frame produces, 106 ms for the 1440x816 window from
    # 1080p. That is why the toggle ships off: it is meant for finishing a
    # chosen take, not for a long exploratory batch, where 300 frames of 1080p
    # is over half a minute of solving. The per-frame cancel check and progress
    # update keep such a batch stoppable at the next frame boundary.
    total = patch.shape[0]
    progress = _progress_bar(total) if total > 1 else None
    spread = torch.empty_like(patch)
    for index in range(total):
        _raise_if_interrupted()
        # pymatting solves in float32 and casts whatever it is handed, so
        # feeding float32 drops a float64 temporary of twice the size for a
        # bit-identical estimate.
        image = patch[index].detach().to(torch.float32).cpu().contiguous().numpy()
        matte = (
            matte_alpha[index].detach().to(torch.float32).clamp(0.0, 1.0).cpu().contiguous().numpy()
        )
        try:
            foreground = estimate(image, matte)
        except Exception as exc:  # A failed estimate must never fail the paste.
            detail = str(exc).encode("ascii", "replace").decode("ascii")
            _warn_once(f"Stitch Inpaint: edge-halo spread failed ({detail}).")
            return patch
        spread[index] = torch.as_tensor(foreground)  # copy_ handles dtype/device
        if progress is not None:
            progress.update_absolute(index + 1, total)

    torch.nan_to_num_(spread, nan=0.0, posinf=1.0, neginf=0.0)
    # The spread redistributes colors the patch already holds; clamping to its
    # own range keeps the fix from inventing a brighter ring than it removes.
    low = float(torch.nan_to_num(patch.min(), nan=0.0))
    high = float(torch.nan_to_num(patch.max(), nan=1.0))
    return spread.clamp_(low, high)


# --- the crop / stitch pair --------------------------------------------------


def build_crop(
    image: torch.Tensor,
    mask: torch.Tensor,
    context_factor: float,
    blend_pixels: int,
    output_multiple: int,
    target_width: int = 0,
    target_height: int = 0,
    mask_grow: int = 0,
    mask_blur: float = 0.0,
    invert_mask: bool = False,
    context_pixels: int = 0,
    target_megapixels: float = 0.0,
    rescale_algorithm: str = "bilinear",
    extend_left: int = 0,
    extend_right: int = 0,
    extend_up: int = 0,
    extend_down: int = 0,
) -> tuple[torch.Tensor, torch.Tensor, dict]:
    """Crop the masked region plus context; return (image, mask, stitcher).

    ``invert_mask`` flips the selection before anything else; ``mask_grow``
    dilates (or erodes, negative) the sampling mask and ``mask_blur``
    softens its edge — both reshape the region the inpainter paints, unlike
    ``blend_pixels`` which only feathers the paste-back. ``context_pixels``
    adds flat pixels of context on top of the ``context_factor`` growth.
    An empty mask selects the full image without context growth, so the
    graph keeps running; its blend mask is empty, so stitching returns
    the original untouched.

    ``target_megapixels`` rescales the crop for the sampler so its area is
    about that many megapixels (0 = off); explicit ``target_width``/
    ``target_height`` win over it. ``rescale_algorithm`` picks the resize
    filter for both directions of the round trip. The ``extend_*`` pixel
    counts grow the frame itself before anything else — the new bands are
    replicate-filled, added to the mask, and become part of the stitched
    output, which is how the pair outpaints.
    """
    image = _as_image(image)
    mask = _as_mask(mask, image)
    if invert_mask:
        mask = 1.0 - mask

    ext_l, ext_r = max(0, int(extend_left)), max(0, int(extend_right))
    ext_u, ext_d = max(0, int(extend_up)), max(0, int(extend_down))
    if ext_l or ext_r or ext_u or ext_d:
        src_h, src_w = image.shape[1], image.shape[2]
        image = _replicate_pad_image(image, ext_l, ext_u, ext_r, ext_d)
        extended = torch.ones(
            (mask.shape[0], src_h + ext_u + ext_d, src_w + ext_l + ext_r),
            dtype=mask.dtype,
            device=mask.device,
        )
        extended[:, ext_u : ext_u + src_h, ext_l : ext_l + src_w] = mask
        mask = extended
    grow_px = int(mask_grow)
    if grow_px:
        mask = grow_shrink_mask(mask, grow_px)
    blur_sigma = max(0.0, float(mask_blur))
    if blur_sigma > 0.0:
        mask = blur_mask(mask, blur_sigma).clamp(0.0, 1.0)
    height, width = image.shape[1], image.shape[2]
    multiple = max(1, int(output_multiple))
    blend_px = max(0, int(blend_pixels))
    context_px = max(0, int(context_pixels))
    target_w = max(0, int(target_width))
    target_h = max(0, int(target_height))
    use_target = target_w > 0 or target_h > 0
    megapixels = max(0.0, float(target_megapixels))
    if rescale_algorithm not in RESIZE_ALGORITHMS:
        raise ValueError(
            f"Crop For Inpaint rescale_algorithm must be one of "
            f"{RESIZE_ALGORITHMS}, not '{rescale_algorithm}'."
        )

    bbox = mask_bbox(mask)
    if bbox is None:
        rect = (0, 0, width, height)
    else:
        rect = grow_rect(bbox, max(1.0, float(context_factor)))
        if context_px:
            rect = (
                rect[0] - context_px,
                rect[1] - context_px,
                rect[2] + 2 * context_px,
                rect[3] + 2 * context_px,
            )
        rect = fit_rect(rect, width, height)
    if not use_target and megapixels > 0.0:
        # Megapixel sizing: scale the crop so its area lands on the target;
        # explicit target_width/height always wins over this.
        area_scale = (megapixels * 1_000_000.0 / (rect[2] * rect[3])) ** 0.5
        target_w = max(1, round(rect[2] * area_scale))
        target_h = max(1, round(rect[3] * area_scale))
        use_target = True
    if not use_target:
        # Native sizing: the crop itself must satisfy the sampler multiple.
        rect = expand_rect_to_multiple(rect, multiple)
        rect = fit_rect(rect, width, height)

    left, top, right, bottom = rect_margins(rect, width, height)
    if left or top or right or bottom:
        canvas = _replicate_pad_image(image, left, top, right, bottom)
    else:
        canvas = image
    canvas_h = height + top + bottom
    canvas_w = width + left + right
    canvas_to_original: Rect = (left, top, width, height)
    crop_to_canvas: Rect = (rect[0] + left, rect[1] + top, rect[2], rect[3])

    canvas_mask = torch.zeros(
        (mask.shape[0], canvas_h, canvas_w), dtype=torch.float32, device=mask.device
    )
    canvas_mask[:, top : top + height, left : left + width] = mask

    blend = stitch_blend_from_mask(canvas_mask, blend_px)

    cx, cy, cw, ch = crop_to_canvas
    cropped = canvas[:, cy : cy + ch, cx : cx + cw, :].clone()
    sampling = canvas_mask[:, cy : cy + ch, cx : cx + cw].clone()

    scale = None
    if use_target:
        if target_w <= 0:
            target_w = max(1, round(cw * target_h / ch))
        if target_h <= 0:
            target_h = max(1, round(ch * target_w / cw))
        target_w = round_up_to_multiple(target_w, multiple)
        target_h = round_up_to_multiple(target_h, multiple)
        if (target_w, target_h) != (cw, ch):
            cropped = _resize_image(cropped, target_w, target_h, rescale_algorithm)
            sampling = _resize_mask(sampling, target_w, target_h)
        scale = (target_w / cw, target_h / ch)

    stitcher = {
        "kind": STITCHER_KIND,
        "version": STITCHER_VERSION,
        "canvas": canvas,
        "canvas_to_original": canvas_to_original,
        "crop_to_canvas": crop_to_canvas,
        "blend": blend,
        "scale": scale,
        "algorithm": rescale_algorithm,
    }
    return cropped, sampling, stitcher


def stitch_blend_from_mask(
    mask: torch.Tensor, blend_pixels: int, grow_pixels: int = 0
) -> torch.Tensor:
    """The paste mask :func:`apply_stitch` blends with, from a generated-area mask.

    ``grow_pixels`` first moves the paste boundary: positive lets the
    generation replace a strip of the source next to the seam, negative keeps
    a strip of the generated area out. ``blend_pixels`` then ramps the mask
    into the kept pixels - grown by that many pixels and blurred - so the
    paste fades in instead of ending at a hard cut. Crop For Inpaint and the
    padding producers all feather through here, so a stitch looks the same
    whichever node built it.
    """
    blend = mask
    grow = int(grow_pixels)
    if grow:
        blend = grow_shrink_mask(blend, grow)
    ramp = max(0, int(blend_pixels))
    if ramp > 0:
        blend = grow_shrink_mask(blend, ramp)
        blend = blur_mask(blend, ramp / 3.0)
    return blend.clamp(0.0, 1.0) if (grow or ramp) else blend.clone()


def build_canvas_stitcher(
    canvas: torch.Tensor,
    blend: torch.Tensor,
    bbox: tuple[int, int, int, int] | None = None,
) -> dict:
    """A stitcher that pastes a full-frame result back over ``canvas``.

    The crop/stitch pair sends a *region* to the sampler. Padding sends the
    whole canvas instead, so the crop is the identity rectangle and ``blend``
    marks the padded band. :func:`apply_stitch` then keeps every pixel where
    the blend is zero bit-identical to ``canvas`` - the original photo - and
    takes the sampler's version only inside the band, which is what makes an
    outpaint leave the source untouched.

    Sharing one stitcher shape means Stitch Inpaint 🆎 accepts either
    producer; no second stitch node has to exist.

    ``bbox`` is where the *source* sits inside the canvas, as
    ``(x0, y0, x1, y1)`` pixels. Padding knows it exactly, and a model that
    places reference tokens on the canvas grid needs it, so it rides along
    here rather than on a parallel wire that can be left unplugged. It is
    stored twice - ``source_bbox`` in pixels and ``bbox_normalized`` in 0..1 -
    because a consumer reading normalized coordinates should not have to know
    the canvas size. Omitted when unknown; :func:`apply_stitch` never reads
    either key, so an older stitcher still stitches.
    """
    canvas = _as_image(canvas)
    blend = _as_mask(blend, canvas)
    height, width = canvas.shape[1], canvas.shape[2]
    stitcher = {
        "kind": STITCHER_KIND,
        "version": STITCHER_VERSION,
        "canvas": canvas,
        "canvas_to_original": (0, 0, width, height),
        "crop_to_canvas": (0, 0, width, height),
        "blend": blend,
        "scale": (1.0, 1.0),
        "algorithm": "bilinear",
    }
    if bbox is not None:
        x0, y0, x1, y1 = (int(value) for value in bbox)
        stitcher["source_bbox"] = (x0, y0, x1, y1)
        stitcher["bbox_normalized"] = [
            x0 / float(width),
            y0 / float(height),
            x1 / float(width),
            y1 / float(height),
        ]
    return stitcher


def apply_stitch(
    stitcher: dict,
    inpainted: torch.Tensor,
    fix_edge_halo: bool = False,
    color_match: float = 0.0,
) -> torch.Tensor:
    """Blend the inpainted crop back and return the original-size image.

    Guarantees: pixels where the blend mask is zero are bit-identical to
    the original image, and passing the crop back unchanged reproduces
    the original exactly. A stitcher built from a single image legally
    broadcasts across an N-frame inpainted batch, and a stitcher built
    from more frames than came back is trimmed to the leading ``N``
    (video models return 8n+1 or 4n+1 frames and drop the tail).

    ``fix_edge_halo`` swaps the blended-in color for the spread foreground
    color from :func:`spread_edge_colors`; it never widens the blend, so
    the zero-weight guarantee is unaffected. Identity round trips are only
    exact with the toggle off, since the spread deliberately rewrites the
    feathered band.

    ``color_match`` (0..1) shifts the patch's tone by the offset measured
    in the feathered band (:func:`estimate_tone_offset`) before blending,
    so an outpaint whose new bands came out a touch lighter or warmer than
    the picture lands on the picture's own tone. 0 leaves the patch alone.
    """
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        raise ValueError(
            "Stitch Inpaint needs the stitcher output of Crop For Inpaint."
        )
    inpainted = _as_image(inpainted)
    canvas = stitcher["canvas"]
    blend = stitcher["blend"]
    cx, cy, cw, ch = stitcher["crop_to_canvas"]
    ox, oy, ow, oh = stitcher["canvas_to_original"]

    frames = inpainted.shape[0]
    batch = canvas.shape[0]
    if batch == frames:
        out = canvas.clone()
    elif batch == 1:
        out = canvas.expand(frames, -1, -1, -1).clone()
    elif frames < batch:
        # Video models hand back fewer frames than they were given (LTX
        # keeps 8n+1, Wan 4n+1) and drop the tail. Paste what came back
        # over the matching leading source frames and say so, rather than
        # throw away a long run over the count.
        print(
            f"[AusBoss] Stitch Inpaint: {frames} inpainted frame(s) for a "
            f"stitcher built from {batch}; stitching the first {frames} and "
            f"dropping the last {batch - frames} source frame(s)."
        )
        out = canvas[:frames].clone()
        if blend.shape[0] == batch:
            blend = blend[:frames]
    else:
        raise ValueError(
            f"Cannot stitch {frames} inpainted frame(s) into a stitcher "
            f"built from {batch} image(s); a stitcher built from one image "
            "broadcasts, and a longer stitcher is trimmed to the frames "
            "that came back, but it cannot invent frames it never had."
        )
    if inpainted.shape[3] != canvas.shape[3]:
        raise ValueError(
            f"Inpainted channels ({inpainted.shape[3]}) do not match the "
            f"cropped image ({canvas.shape[3]})."
        )
    if blend.shape[0] not in (1, frames):
        raise ValueError(
            f"Blend mask batch {blend.shape[0]} cannot broadcast across "
            f"{frames} inpainted frame(s)."
        )

    patch = inpainted.to(dtype=out.dtype, device=out.device)
    if (patch.shape[1], patch.shape[2]) != (ch, cw):
        patch = _resize_image(patch, cw, ch, stitcher.get("algorithm", "bilinear"))

    alpha = blend[:, cy : cy + ch, cx : cx + cw].to(out.device)
    if color_match > 0:
        # Measured against the canvas region the patch lands on; the shift
        # reaches every patch pixel but only the blended ones survive, so
        # the zero-blend guarantee below is untouched.
        bbox = stitcher.get("source_bbox")
        if bbox is not None:
            # The bbox is in canvas pixels; the crop window is the identity
            # for a padded canvas, so it maps straight onto the patch.
            bbox = (bbox[0] - cx, bbox[1] - cy, bbox[2] - cx, bbox[3] - cy)
        field = tone_offset_field(patch, out[:, cy : cy + ch, cx : cx + cw, :], alpha, bbox)
        # Weighted by the blend: a fully generated pixel drifted by the whole
        # field, a band pixel the sampler mixed at alpha drifted by alpha of
        # it, and the blend below scales the correction by alpha once more.
        # Shifting the band by the full field would land it alpha*(1-alpha)
        # of the drift below the picture - a faint dark line along the seam.
        patch = shift_tone(patch, field * alpha.unsqueeze(-1), min(1.0, float(color_match)))
    if fix_edge_halo:
        patch = spread_edge_colors(patch, alpha)
    weights = alpha.unsqueeze(-1)
    region = out[:, cy : cy + ch, cx : cx + cw, :]
    # canvas + blend * (inpainted - canvas): identical input reproduces the
    # canvas bitwise; the where-guard pins the zero-blend region regardless
    # of what the sampler returned.
    mixed = region + weights * (patch - region)
    mixed = torch.where(weights > 0, mixed, region)
    out[:, cy : cy + ch, cx : cx + cw, :] = mixed
    return out[:, oy : oy + oh, ox : ox + ow, :].contiguous()


def estimate_tone_offset(
    inpainted: torch.Tensor, canvas: torch.Tensor, blend: torch.Tensor
) -> torch.Tensor:
    """Per-frame LAB mean offset of the inpainted patch against the canvas,
    measured where both hold real content: the feathered band (0 < blend
    < 1), inside the original picture but partly regenerated.

    The sampler mixes original and generated latent by the mask, so a band
    pixel comes out roughly ``blend * generated + (1 - blend) * original``.
    Dividing that difference back out is the weighted least-squares
    estimate ``sum(blend * (patch - canvas)) / sum(blend**2)`` per channel -
    the tone the model drifted by, read off pixels whose true color is
    known. Returns [B, 3] in LAB; zeros when there is no band to measure.
    """
    from ._color_helpers import rgb_to_lab

    diff = rgb_to_lab(inpainted[..., :3]) - rgb_to_lab(canvas[..., :3])
    band = _band_weights(blend)
    weights = band.unsqueeze(-1)
    numerator = (weights * diff).sum(dim=(1, 2))
    denominator = (weights * weights).sum(dim=(1, 2)).clamp_min(1e-6)
    offset = numerator / denominator
    measured = (band.sum(dim=(1, 2)) > 0).unsqueeze(-1)
    return torch.where(measured, offset, torch.zeros_like(offset))


def _band_weights(blend: torch.Tensor) -> torch.Tensor:
    return torch.where((blend > 0.001) & (blend < 0.999), blend, torch.zeros_like(blend))


def _fill_nearest(values: torch.Tensor, valid: torch.Tensor) -> torch.Tensor:
    """values [N, C], valid [N] bool: copy each invalid entry from the
    nearest valid one. All-invalid input comes back unchanged."""
    index = torch.nonzero(valid).flatten()
    if index.numel() == 0 or index.numel() == valid.numel():
        return values
    positions = torch.arange(values.shape[0], device=values.device)
    # For every position, the nearest valid index by absolute distance.
    distance = (positions.unsqueeze(1) - index.unsqueeze(0)).abs()
    nearest = index[distance.argmin(dim=1)]
    return values[nearest]


def _smooth_lines(curve: torch.Tensor, sigma: float) -> torch.Tensor:
    """Gaussian-smooth [B, N, C] along N with reflect padding."""
    length = curve.shape[1]
    if sigma <= 0 or length < 3:
        return curve
    radius = max(1, min(int(3 * sigma), length - 1))
    taps = torch.arange(-radius, radius + 1, dtype=curve.dtype, device=curve.device)
    kernel = torch.exp(-(taps * taps) / (2 * sigma * sigma))
    kernel = kernel / kernel.sum()
    channels = curve.shape[2]
    x = curve.permute(0, 2, 1)  # [B, C, N]
    x = torch.nn.functional.pad(x, (radius, radius), mode="reflect")
    weight = kernel.view(1, 1, -1).expand(channels, 1, -1)
    return torch.nn.functional.conv1d(x, weight, groups=channels).permute(0, 2, 1)


# How far one line's drift may stray from its side's average, in LAB
# units. A line whose seam holds different content on its two sides (a
# pier post leaving the frame, a boat's reflection under open water)
# would otherwise print its content difference onto the band as a tone
# shift.
LINE_DRIFT_CLAMP = 6.0

# The drift is read across the seam: this many generated pixels just
# outside the source against this many original pixels just inside it.
# Inside the feathered band the sampler mixed generated and original
# tone, so the band itself is the one place a clean reading cannot come
# from; the pixels either side of it can.
SEAM_BAND_PX = 24

# Softening of the inverse-square distance blend between sides, in
# pixels: at a corner the two nearest sides' curves mix smoothly instead
# of switching on a diagonal.
SEAM_BLEND_SOFT_PX = 8.0


def _finish_lines(lines: torch.Tensor, cover: torch.Tensor) -> torch.Tensor:
    """Turn raw per-line drifts [B, N, 3] into a curve fit to print: the
    side's own average, plus each line's deviation from it clamped to
    LINE_DRIFT_CLAMP, uncovered lines (cover [B, N] <= 0) filled from
    their nearest covered neighbour, and the curve smoothed so a single
    line cannot print a stripe."""
    weight = (cover > 0).to(lines.dtype).unsqueeze(-1)
    side_average = (lines * weight).sum(dim=1, keepdim=True) / weight.sum(dim=1, keepdim=True).clamp_min(1e-6)
    lines = side_average + (lines - side_average).clamp(-LINE_DRIFT_CLAMP, LINE_DRIFT_CLAMP)
    out = torch.zeros_like(lines)
    for b in range(lines.shape[0]):
        valid = cover[b] > 0
        filled = torch.where(valid.unsqueeze(-1), lines[b], side_average[b].expand_as(lines[b]))
        out[b] = _fill_nearest(filled, valid) if valid.any() else filled
    sigma = max(6.0, 0.03 * lines.shape[1])
    return _smooth_lines(out, sigma)


def _seam_lines(
    outside: torch.Tensor, inside: torch.Tensor, along_rows: bool
) -> tuple[torch.Tensor, torch.Tensor]:
    """Per-line drift across one seam: the mean LAB of the generated strip
    just outside it minus the mean of the original strip just inside it,
    per row (along_rows) or per column. ``outside`` and ``inside`` are the
    two strips as [B, H, w, 3] / [B, h, W, 3] slices. Returns the finished
    curve [B, N, 3] and its cover [B, N]."""
    reduce_dim = 2 if along_rows else 1
    lines = outside.mean(dim=reduce_dim) - inside.mean(dim=reduce_dim)
    cover = torch.ones(lines.shape[:2], dtype=lines.dtype, device=lines.device)
    return _finish_lines(lines, cover), cover


def tone_offset_field(
    inpainted: torch.Tensor,
    canvas: torch.Tensor,
    blend: torch.Tensor,
    source_bbox: tuple[int, int, int, int] | None,
) -> torch.Tensor:
    """A per-pixel LAB drift field [B, H, W, 3] for the patch.

    With a source rectangle (an outpaint), each padded side's drift is read
    ACROSS its seam, line by line - per row for a left or right side, per
    column for a top or bottom one: the generated pixels just outside the
    source against the original pixels just inside it (SEAM_BAND_PX each).
    Sky and water on the same seam drift by different amounts, and one
    number for the whole picture leaves one of them showing. Every pixel
    then takes an inverse-square-distance blend of the sides' curves, so
    where two padded sides meet the correction turns the corner without
    a crease. Without a rectangle, or with nothing to measure, the field is
    the single global offset.
    """
    from ._color_helpers import rgb_to_lab

    lab_patch = rgb_to_lab(inpainted[..., :3])
    lab_canvas = rgb_to_lab(canvas[..., :3])
    batch, height, width = lab_patch.shape[:3]
    global_offset = estimate_tone_offset(inpainted, canvas, blend)
    field = global_offset.view(batch, 1, 1, 3).expand(batch, height, width, 3).clone()
    if source_bbox is None:
        return field
    x0, y0, x1, y1 = (int(v) for v in source_bbox)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return field
    device = lab_patch.device
    cols = torch.arange(width, device=device, dtype=lab_patch.dtype).view(1, 1, width)
    rows = torch.arange(height, device=device, dtype=lab_patch.dtype).view(1, height, 1)
    row_index = torch.arange(height, device=device).clamp(y0, y1 - 1) - y0
    col_index = torch.arange(width, device=device).clamp(x0, x1 - 1) - x0
    sides = []  # (distance to the seam [1,H,W], drift field [B,H,W,3])

    def expand_rows(curve: torch.Tensor) -> torch.Tensor:
        # curve [B, y1-y0, 3] -> every row of the canvas, padding rows
        # taking the nearest source row's value.
        return curve[:, row_index].unsqueeze(2).expand(batch, height, width, 3)

    def expand_cols(curve: torch.Tensor) -> torch.Tensor:
        return curve[:, col_index].unsqueeze(1).expand(batch, height, width, 3)

    if x0 > 0:
        wo, wi = min(SEAM_BAND_PX, x0), min(SEAM_BAND_PX, x1 - x0)
        curve, _ = _seam_lines(lab_patch[:, y0:y1, x0 - wo : x0], lab_canvas[:, y0:y1, x0 : x0 + wi], along_rows=True)
        sides.append(((cols - x0).abs().expand(1, height, width), expand_rows(curve)))
    if x1 < width:
        wo, wi = min(SEAM_BAND_PX, width - x1), min(SEAM_BAND_PX, x1 - x0)
        curve, _ = _seam_lines(lab_patch[:, y0:y1, x1 : x1 + wo], lab_canvas[:, y0:y1, x1 - wi : x1], along_rows=True)
        sides.append(((cols - (x1 - 1)).abs().expand(1, height, width), expand_rows(curve)))
    if y0 > 0:
        wo, wi = min(SEAM_BAND_PX, y0), min(SEAM_BAND_PX, y1 - y0)
        curve, _ = _seam_lines(lab_patch[:, y0 - wo : y0, x0:x1], lab_canvas[:, y0 : y0 + wi, x0:x1], along_rows=False)
        sides.append(((rows - y0).abs().expand(1, height, width), expand_cols(curve)))
    if y1 < height:
        wo, wi = min(SEAM_BAND_PX, height - y1), min(SEAM_BAND_PX, y1 - y0)
        curve, _ = _seam_lines(lab_patch[:, y1 : y1 + wo, x0:x1], lab_canvas[:, y1 - wi : y1, x0:x1], along_rows=False)
        sides.append(((rows - (y1 - 1)).abs().expand(1, height, width), expand_cols(curve)))
    if not sides:
        return field
    numerator = torch.zeros_like(field)
    denominator = torch.zeros((1, height, width, 1), dtype=field.dtype, device=device)
    for distance, side_field in sides:
        weight = (1.0 / (distance + SEAM_BLEND_SOFT_PX) ** 2).unsqueeze(-1)
        numerator = numerator + weight * side_field
        denominator = denominator + weight
    return numerator / denominator


def shift_tone(image: torch.Tensor, offset: torch.Tensor, strength: float) -> torch.Tensor:
    """Subtract ``strength * offset`` from every pixel, in LAB. ``offset``
    is [B, 3] (one shift per frame) or a [B, H, W, 3] field."""
    from ._color_helpers import lab_to_rgb, rgb_to_lab

    if strength <= 0:
        return image
    lab = rgb_to_lab(image[..., :3])
    shift = offset.view(-1, 1, 1, 3) if offset.dim() == 2 else offset
    rgb = lab_to_rgb(lab - shift * float(strength)).clamp(0.0, 1.0)
    if image.shape[3] > 3:
        return torch.cat([rgb, image[..., 3:]], dim=-1)
    return rgb


def stitch_blend_mask(stitcher: dict, frames: int = 1) -> torch.Tensor:
    """The feathered blend mask in original-image coordinates (BHW).

    This is the very mask :func:`apply_stitch` blends with — the sampling
    mask grown by ``blend_pixels`` and blurred — sliced out of the canvas by
    ``canvas_to_original`` so it lines up pixel for pixel with the stitched
    image. A single-image stitcher broadcasts across ``frames``, matching
    the batch :func:`apply_stitch` returns, so a downstream color match or
    composite can weight exactly the pixels the paste touched.
    """
    if not isinstance(stitcher, dict) or stitcher.get("kind") != STITCHER_KIND:
        raise ValueError(
            "Stitch Inpaint needs the stitcher output of Crop For Inpaint."
        )
    blend = stitcher["blend"]
    ox, oy, ow, oh = stitcher["canvas_to_original"]
    frames = max(1, int(frames))
    if blend.shape[0] not in (1, frames):
        raise ValueError(
            f"Blend mask batch {blend.shape[0]} cannot broadcast across "
            f"{frames} inpainted frame(s)."
        )
    mask = blend[:, oy : oy + oh, ox : ox + ow]
    if mask.shape[0] == 1 and frames > 1:
        mask = mask.expand(frames, -1, -1)
    return mask.contiguous()


__all__ = [
    "RESIZE_ALGORITHMS",
    "STITCHER_KIND",
    "build_canvas_stitcher",
    "stitch_blend_from_mask",
    "STITCHER_VERSION",
    "apply_stitch",
    "build_crop",
    "stitch_blend_mask",
    "expand_rect_to_multiple",
    "fit_rect",
    "grow_rect",
    "mask_bbox",
    "rect_margins",
    "round_up_to_multiple",
    "spread_edge_colors",
]
