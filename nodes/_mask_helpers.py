"""Mask refinement helpers shared by AusBoss nodes."""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional

try:
    from scipy.ndimage import binary_fill_holes as _scipy_fill_holes
except Exception:  # scipy is optional; the torch fallback below covers it.
    _scipy_fill_holes = None


def _as_bhw(mask: torch.Tensor) -> torch.Tensor:
    if isinstance(mask, torch.Tensor) and mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if not isinstance(mask, torch.Tensor) or mask.ndim != 3:
        raise ValueError("Refine Mask expected a BHW MASK.")
    return mask.float().clamp(0.0, 1.0)


def grow_shrink_mask(mask: torch.Tensor, pixels: int) -> torch.Tensor:
    """Dilate (positive) or erode (negative) by whole pixels; soft values survive."""
    steps = abs(int(pixels))
    if steps == 0:
        return mask
    grown = mask.unsqueeze(1)
    for _ in range(steps):
        if pixels > 0:
            grown = functional.max_pool2d(grown, kernel_size=3, stride=1, padding=1)
        else:
            grown = -functional.max_pool2d(-grown, kernel_size=3, stride=1, padding=1)
    return grown.squeeze(1)


def _torch_fill_holes(solid: torch.Tensor) -> torch.Tensor:
    """Flood the border-connected background; whatever is left inside is a hole."""
    background = ~solid
    reachable = torch.zeros_like(background)
    reachable[:, 0, :] = background[:, 0, :]
    reachable[:, -1, :] = background[:, -1, :]
    reachable[:, :, 0] = background[:, :, 0]
    reachable[:, :, -1] = background[:, :, -1]
    while True:
        grown = (
            functional.max_pool2d(
                reachable.float().unsqueeze(1), kernel_size=3, stride=1, padding=1
            )
            .squeeze(1)
            .bool()
            & background
        )
        if torch.equal(grown, reachable):
            break
        reachable = grown
    return solid | (background & ~reachable)


def fill_mask_holes(mask: torch.Tensor) -> torch.Tensor:
    solid = mask >= 0.5
    if _scipy_fill_holes is not None:
        filled = torch.stack(
            [torch.from_numpy(_scipy_fill_holes(layer.cpu().numpy())) for layer in solid]
        ).to(mask.device)
    else:
        filled = _torch_fill_holes(solid)
    return torch.maximum(mask, filled.to(mask.dtype))


def blur_mask(mask: torch.Tensor, sigma: float) -> torch.Tensor:
    if sigma <= 0.0:
        return mask
    radius = max(1, int(math.ceil(float(sigma) * 3.0)))
    coords = torch.arange(-radius, radius + 1, dtype=torch.float32, device=mask.device)
    kernel = torch.exp(-(coords**2) / (2.0 * float(sigma) ** 2))
    kernel = kernel / kernel.sum()
    blurred = mask.unsqueeze(1)
    blurred = functional.pad(blurred, (radius, radius, 0, 0), mode="replicate")
    blurred = functional.conv2d(blurred, kernel.view(1, 1, 1, -1))
    blurred = functional.pad(blurred, (0, 0, radius, radius), mode="replicate")
    blurred = functional.conv2d(blurred, kernel.view(1, 1, -1, 1))
    return blurred.squeeze(1)


def smooth_mask(mask: torch.Tensor, pixels: int) -> torch.Tensor:
    """Melt staircase jaggies while keeping a hard edge.

    Binarize at 0.5, gaussian-blur with sigma ~ pixels, re-binarize at 0.5.
    Unlike blur_mask this never leaves soft values behind, so it de-jaggies
    segmentation edges without feathering them.
    """
    if int(pixels) <= 0:
        return mask
    solid = (mask >= 0.5).to(mask.dtype)
    return (blur_mask(solid, float(int(pixels))) >= 0.5).to(mask.dtype)


EDGE_REFINE_MODES = ("off", "guided filter", "matting")

_GUIDED_FILTER_HINT = (
    "Refine Mask edge_refine 'guided filter' needs the optional "
    "opencv-contrib dependency. Install it into ComfyUI's python with: "
    "pip install opencv-contrib-python (the pack's 'guided-filter' "
    "optional-dependencies group), then restart ComfyUI."
)
_MATTING_HINT = (
    "Refine Mask edge_refine 'matting' needs the optional pymatting "
    "dependency. Install it into ComfyUI's python with: pip install "
    "pymatting (the pack's 'matting' optional-dependencies group), then "
    "restart ComfyUI."
)


def _optional_import(module_name: str):
    """Import an optional dependency at call time; tests monkeypatch this."""
    import importlib

    return importlib.import_module(module_name)


def _load_guided_filter():
    try:
        cv2 = _optional_import("cv2")
    except ImportError as exc:
        raise RuntimeError(_GUIDED_FILTER_HINT) from exc
    ximgproc = getattr(cv2, "ximgproc", None)
    if ximgproc is None or not hasattr(ximgproc, "guidedFilter"):
        # Plain opencv-python ships without the contrib ximgproc module.
        raise RuntimeError(_GUIDED_FILTER_HINT)
    return ximgproc.guidedFilter


def _load_alpha_matting():
    try:
        pymatting = _optional_import("pymatting")
    except ImportError as exc:
        raise RuntimeError(_MATTING_HINT) from exc
    estimate = getattr(pymatting, "estimate_alpha_cf", None)
    if estimate is None:
        raise RuntimeError(_MATTING_HINT)
    return estimate


def _raise_if_interrupted() -> None:
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
    except ImportError:  # Offline tests run without ComfyUI.
        return
    throw_exception_if_processing_interrupted()


def _edge_radius(expand: int) -> int:
    """Working radius at the edge, scaled with how far the mask was moved."""
    return max(4, 2 * abs(int(expand)))


def _guide_frames(
    guide_image: torch.Tensor, count: int, height: int, width: int
) -> torch.Tensor:
    """Validate guide_image against the mask batch and return BHWC RGB frames."""
    if (
        not isinstance(guide_image, torch.Tensor)
        or guide_image.ndim != 4
        or guide_image.shape[-1] < 3
    ):
        raise ValueError("Refine Mask expected guide_image as a BHWC RGB IMAGE batch.")
    if tuple(guide_image.shape[1:3]) != (height, width):
        raise ValueError(
            f"Refine Mask guide_image is {guide_image.shape[2]}x{guide_image.shape[1]} "
            f"but the mask is {width}x{height}; connect the image the mask belongs to."
        )
    if guide_image.shape[0] not in {1, count}:
        raise ValueError(
            "Refine Mask needs one guide frame for the whole mask batch or one per mask."
        )
    frames = guide_image[..., :3].float().clamp(0.0, 1.0)
    if frames.shape[0] == 1 and count > 1:
        frames = frames.expand(count, -1, -1, -1)
    return frames


def guided_filter_refine(
    mask: torch.Tensor, guide_image: torch.Tensor, expand: int
) -> torch.Tensor:
    """Snap soft mask edges to guide-image edges with an edge-aware filter."""
    guided_filter = _load_guided_filter()
    count, height, width = mask.shape
    guides = _guide_frames(guide_image, count, height, width)
    radius = _edge_radius(expand)
    frames = []
    for index in range(count):
        _raise_if_interrupted()
        guide = guides[index].detach().contiguous().cpu().numpy()
        source = mask[index].detach().float().contiguous().cpu().numpy()
        frames.append(torch.from_numpy(guided_filter(guide, source, radius, 1e-4)))
    return torch.stack(frames).to(device=mask.device, dtype=mask.dtype).clamp(0.0, 1.0)


def matting_refine(
    mask: torch.Tensor, guide_image: torch.Tensor, expand: int
) -> torch.Tensor:
    """Closed-form alpha matting around the mask edge.

    The binarized mask eroded by the edge radius is definite foreground, the
    dilation marks where definite background begins, and the band between is
    solved by pymatting's estimate_alpha_cf against the guide image.
    """
    estimate_alpha_cf = _load_alpha_matting()
    count, height, width = mask.shape
    guides = _guide_frames(guide_image, count, height, width)
    band = _edge_radius(expand)
    frames = []
    for index in range(count):
        _raise_if_interrupted()
        solid = (mask[index].detach().float().cpu() >= 0.5).float().unsqueeze(0)
        sure_fg = grow_shrink_mask(solid, -band).squeeze(0) >= 0.5
        possible = grow_shrink_mask(solid, band).squeeze(0) >= 0.5
        unknown = possible & ~sure_fg
        if not bool(unknown.any()) or not bool(sure_fg.any()) or bool(possible.all()):
            # Degenerate trimap (empty mask, mask everywhere, or a shape the
            # band swallows whole): keep the binarized mask for this frame.
            frames.append(solid.squeeze(0))
            continue
        trimap = torch.full((height, width), 0.5, dtype=torch.float64)
        trimap[~possible] = 0.0
        trimap[sure_fg] = 1.0
        guide = guides[index].detach().contiguous().cpu().numpy().astype("float64")
        alpha = estimate_alpha_cf(guide, trimap.numpy())
        frames.append(torch.from_numpy(alpha).float())
    return torch.stack(frames).to(device=mask.device, dtype=mask.dtype).clamp(0.0, 1.0)


def remap_mask(
    mask: torch.Tensor, black_point: float, white_point: float
) -> torch.Tensor:
    """Levels remap: values at or below black_point become 0, values at or
    above white_point become 1, the range between rescales linearly. Clears
    gray haze left behind by soft segmentation or feathering."""
    black = float(black_point)
    white = float(white_point)
    if black <= 0.0 and white >= 1.0:
        return mask
    span = max(white - black, 1e-6)  # degenerate points act as a threshold
    return ((mask - black) / span).clamp(0.0, 1.0)


def refine_mask(
    mask: torch.Tensor,
    expand: int,
    blur: float,
    fill_holes: bool,
    smooth: int = 0,
    black_point: float = 0.0,
    white_point: float = 1.0,
    edge_refine: str = "off",
    guide_image: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Expand, fill holes, smooth, feather, edge-refine, then remap levels."""
    if edge_refine not in EDGE_REFINE_MODES:
        raise ValueError(
            f"Refine Mask edge_refine must be one of {EDGE_REFINE_MODES}, "
            f"not '{edge_refine}'."
        )
    if edge_refine != "off" and guide_image is None:
        raise ValueError(
            f"Refine Mask edge_refine '{edge_refine}' needs the guide_image "
            "input; connect the RGB image the mask belongs to, or set "
            "edge_refine back to 'off'."
        )
    refined = _as_bhw(mask)
    refined = grow_shrink_mask(refined, expand)
    if fill_holes:
        refined = fill_mask_holes(refined)
    refined = smooth_mask(refined, int(smooth))
    refined = blur_mask(refined, blur).clamp(0.0, 1.0)
    if edge_refine == "guided filter":
        refined = guided_filter_refine(refined, guide_image, expand)
    elif edge_refine == "matting":
        refined = matting_refine(refined, guide_image, expand)
    refined = remap_mask(refined, black_point, white_point)
    return refined, 1.0 - refined


__all__ = [
    "EDGE_REFINE_MODES",
    "blur_mask",
    "fill_mask_holes",
    "grow_shrink_mask",
    "guided_filter_refine",
    "matting_refine",
    "refine_mask",
    "remap_mask",
    "smooth_mask",
]
