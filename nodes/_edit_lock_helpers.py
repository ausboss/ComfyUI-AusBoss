"""Edit Lock: keep what an edit did not change. Pure torch, no ComfyUI imports.

At every sampling step an edit model predicts the finished picture. Where
that prediction sits close to the original, the edit is not happening
there, so the original is put back and the model carries on from the real
picture. This is the target TailSteer trains a model toward
(original where nothing changed, the model's edit elsewhere), applied while
sampling instead of through training.

What counts as changed is measured against the quiet part of the picture:
the tenth of it where the prediction differs least, which a local edit
leaves near the level of the model's own redraw noise. The node watches the
first steps, where it only undoes the model's zoom and shift, and decides
once the picture has formed. An edit of the whole picture (a style, the
light) has no quiet part: the first look checks for that and the lock steps
aside. A soft change over the whole picture (rain, snow, haze) has no clear
peak: the decision checks for that, and the picture is only held in place.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

LOCK_MODES = ("auto", "always", "off")

# A spot counts as changed when it differs from the original by STRONG times
# the quiet level, or by WEAK times while it touches a spot that does. So a
# faint change next to a clear one belongs to the edit, and a faint change
# alone is redraw noise. Set against what 14 plain MiniMax-H3-Image edits
# changed in the end: this frees about 80% of it at the first look and 3%
# of what stayed.
WEAK = 2.0
STRONG = 3.0
# The model often draws the whole picture a little larger or shifted. That
# is measured and discounted before anything is compared, up to these
# limits; a bigger move is treated as part of the edit.
# The node watches the start of a run and decides once the noise is down to
# this share of where it began. The first prediction is a blur: rain, snow,
# smoke and the light a new hair color throws on a face only show a few
# steps in. While it watches it only undoes the zoom and shift.
DECIDE_AT = 0.8
# A local edit has a peak: somewhere the picture clearly changes. Rain, snow
# and haze change the whole picture a little and no part clearly. A lock
# would hold them back, or let them through in patches where it hands a wide
# part of the picture to the edit. So two things are read at the decision,
# in units of the quiet level: the strongest spot, and the strongest
# hundredth when the lock would free SOFT_WIDE of the picture or more. On
# recorded MiniMax-H3-Image runs the strongest spot read 4.7 or more for
# every local edit, glasses and makeup included, and 3.7 or less for light
# rain, fog and snow; with a wide part freed, the strongest hundredth read
# 4.4 or more for local edits and 3.6 or less for rain and snow.
SOFT_WIDE = 0.10
SOFT_PEAK = 4.0
# Kept this much or more: the report adds what to do if the edit is missing.
# A soft effect over the whole picture (rain, snow, smoke) looks like a small
# edit at the first look, and under the lock the model then drops it.
NEARLY_ALL = 0.95
MAX_ZOOM = 0.05
MAX_SHIFT = 4.0
# The whole picture is changing when even its calmest fifth sits this far
# from the original at the first look, in units of the original's own
# spread. Measured on MiniMax-H3-Image: 28 local edits at 1, 4 and 16 MP came
# in at 0.22 or less (zoomed ones included), 12 whole-picture edits (styles,
# light, weather) at 0.27 or more.
WHOLE_PICTURE = 0.243
# Blur and growth of the change map, as a share of the short side.
REACH = 1.0 / 54.0
# A result this much larger or smaller than the picture is another picture.
SIZE_SLACK = 0.04


def box_blur(x: torch.Tensor, radius: int) -> torch.Tensor:
    if radius <= 0:
        return x
    size = 2 * radius + 1
    return F.avg_pool2d(F.pad(x, (radius,) * 4, mode="replicate"), size, stride=1)


def reach(height: int, width: int) -> int:
    return max(1, round(min(height, width) * REACH))


def _moved(source: torch.Tensor, move: torch.Tensor) -> torch.Tensor:
    """The original sampled at (zoom_x * x + shift_x, zoom_y * y + shift_y), x and y in cells from the centre.

    move = [zoom_x - 1, zoom_y - 1, shift_x, shift_y].
    """
    height, width = source.shape[-2:]
    theta = torch.zeros(source.shape[0], 2, 3, device=source.device, dtype=source.dtype)
    theta[:, 0, 0] = 1.0 + move[0]
    theta[:, 1, 1] = 1.0 + move[1]
    theta[:, 0, 2] = 2.0 * move[2] / width
    theta[:, 1, 2] = 2.0 * move[3] / height
    grid = F.affine_grid(theta, list(source.shape), align_corners=False)
    return F.grid_sample(source, grid, mode="bilinear", padding_mode="border", align_corners=False)


def measure_redraw(pred: torch.Tensor, source: torch.Tensor) -> torch.Tensor:
    """How much larger and how far shifted the prediction is drawn, as the move that lays the original over it.

    pred and source are [1, C, H, W]. Fitted on the calmer half of the
    picture, so the edit itself does not pull the answer, from a coarse grid
    down to the full one. Returns [zoom_x - 1, zoom_y - 1, shift_x, shift_y];
    zeros when nothing can be measured.
    """
    pred, source = pred.float(), source.float()
    move = torch.zeros(4, device=pred.device, dtype=torch.float32)
    limit = torch.tensor([MAX_ZOOM, MAX_ZOOM, MAX_SHIFT, MAX_SHIFT], device=pred.device)
    for level in (4, 2, 1):
        if min(pred.shape[-2:]) // level < 16:
            continue
        a = box_blur(F.avg_pool2d(pred, level) if level > 1 else pred, 1)
        b = box_blur(F.avg_pool2d(source, level) if level > 1 else source, 1)
        height, width = a.shape[-2:]
        ys = (torch.arange(height, device=a.device, dtype=torch.float32) + 0.5 - height / 2)[:, None].expand(height, width)
        xs = (torch.arange(width, device=a.device, dtype=torch.float32) + 0.5 - width / 2)[None, :].expand(height, width)
        here = move.clone()
        here[2:] = here[2:] / level
        for _ in range(6):
            laid = _moved(b, here)
            rest = a - laid
            rest = rest - rest.flatten(2).median(dim=2).values[:, :, None, None]
            wide = F.pad(laid, (1, 1, 1, 1), mode="replicate")
            gx = (wide[..., 1:-1, 2:] - wide[..., 1:-1, :-2]) / 2.0
            gy = (wide[..., 2:, 1:-1] - wide[..., :-2, 1:-1]) / 2.0
            size = rest.abs().mean(dim=1, keepdim=True)
            calm = (size <= size.flatten().median()).float()
            calm[..., :2, :] = 0.0
            calm[..., -2:, :] = 0.0
            calm[..., :, :2] = 0.0
            calm[..., :, -2:] = 0.0
            jac = (torch.stack([gx * xs, gy * ys, gx, gy], dim=-1) * calm[..., None]).reshape(-1, 4)
            normal = jac.T @ jac + 1e-6 * torch.eye(4, device=a.device)
            try:
                change = torch.linalg.solve(normal, jac.T @ (rest * calm).reshape(-1))
            except RuntimeError:
                return torch.zeros(4, device=pred.device, dtype=torch.float32)
            if not bool(torch.isfinite(change).all()):
                return torch.zeros(4, device=pred.device, dtype=torch.float32)
            here = here + change
            if float(change.abs().max()) < 1e-4:
                break
        move = here.clone()
        move[2:] = move[2:] * level
        move = torch.maximum(torch.minimum(move, limit), -limit)
    return move


def redraws(pred: torch.Tensor, source: torch.Tensor) -> list[torch.Tensor]:
    """measure_redraw for each picture of a batch."""
    return [measure_redraw(pred[index:index + 1], source[:1]) for index in range(pred.shape[0])]


def difference(pred: torch.Tensor, source: torch.Tensor, moves: list[torch.Tensor] | None = None) -> torch.Tensor:
    """How far each spot of the prediction is from the original, [B, 1, H, W].

    Two things are not a change. A redraw of the whole picture slightly
    larger or shifted: the original is laid over the prediction first. And
    an even tint: each channel's middle difference is taken out. The result
    is in units of the original's own spread, which keeps the numbers alike
    between models.
    """
    pred = pred.float()
    source = source.float()
    moves = moves if moves is not None else redraws(pred, source)
    out = []
    for index in range(pred.shape[0]):
        delta = pred[index:index + 1] - _moved(source[:1], moves[index])
        delta = delta - delta.flatten(2).median(dim=2).values[:, :, None, None]
        out.append(delta.abs().mean(dim=1, keepdim=True))
    magnitude = torch.cat(out) / source.std().clamp_min(1e-6)
    return box_blur(magnitude, reach(*magnitude.shape[-2:]))


def moved_back(pred: torch.Tensor, moves: list[torch.Tensor]) -> torch.Tensor:
    """The prediction with its zoom and shift undone, so it sits where the original does.

    Resampling softens a latent, so a move under a tenth of a cell at the
    corner is left alone, and the rest is resampled bicubic: on recorded
    runs that kept 85% of the fine detail where bilinear kept 65%.
    """
    out = []
    for index in range(pred.shape[0]):
        one = pred[index:index + 1]
        move = moves[index]
        height, width = one.shape[-2:]
        corner = (move[0].abs() * width / 2 + move[2].abs()).maximum(move[1].abs() * height / 2 + move[3].abs())
        if float(corner) < 0.1:
            out.append(one)
            continue
        theta = torch.zeros(1, 2, 3, device=one.device, dtype=torch.float32)
        theta[:, 0, 0] = 1.0 / (1.0 + move[0])
        theta[:, 1, 1] = 1.0 / (1.0 + move[1])
        theta[:, 0, 2] = -2.0 * move[2] / (1.0 + move[0]) / width
        theta[:, 1, 2] = -2.0 * move[3] / (1.0 + move[1]) / height
        grid = F.affine_grid(theta, list(one.shape), align_corners=False)
        back = F.grid_sample(one.float(), grid, mode="bicubic", padding_mode="border", align_corners=False)
        out.append(back.to(one.dtype))
    return torch.cat(out)


def broad_change(pred: torch.Tensor, source: torch.Tensor) -> torch.Tensor:
    """How far the calmest fifth of each picture sits from the original, [B].

    Read on a smoothed copy, where a redraw one percent larger nearly
    vanishes and a new style, new light or new weather does not. An even
    tint is taken out first: the model adds one by itself, a stronger one
    on large pictures, and that is no edit.
    """
    delta = (pred - source).float()
    delta = delta - delta.flatten(2).median(dim=2).values[:, :, None, None]
    delta = box_blur(delta, max(1, round(min(delta.shape[-2:]) / 30.0)))
    level = (delta * delta).mean(dim=1).sqrt().flatten(1)
    stride = max(1, level.shape[1] // 200000)
    spread = source.float().std().clamp_min(1e-6)
    return torch.quantile(level[:, ::stride], 0.2, dim=1) / spread


def quiet_level(magnitude: torch.Tensor) -> torch.Tensor:
    """The tenth of each picture that differs least, [B]."""
    flat = magnitude.flatten(1)
    stride = max(1, flat.shape[1] // 200000)
    return torch.quantile(flat[:, ::stride], 0.1, dim=1)


def peaks(magnitude: torch.Tensor, quiet: torch.Tensor) -> tuple[float, float]:
    """How clear the clearest change is, in units of the quiet level: (strongest spot, strongest hundredth)."""
    ratio = (magnitude / quiet.clamp_min(1e-6)[:, None, None, None]).flatten(1)
    stride = max(1, ratio.shape[1] // 200000)
    return float(ratio.max(dim=1).values.min()), float(torch.quantile(ratio[:, ::stride], 0.99, dim=1).min())


def change_core(magnitude: torch.Tensor, quiet: torch.Tensor, tolerance: float = 1.0,
                held: torch.Tensor | None = None) -> torch.Tensor:
    """1 where the edit changed the picture, 0 where it did not, hard-edged, [B, 1, H, W].

    `held` is what earlier steps called changed: it stays changed, and
    faint change that touches it joins it.
    """
    ratio = magnitude / quiet.clamp_min(1e-6)[:, None, None, None]
    weak = (ratio > WEAK * tolerance).float()
    core = (ratio > STRONG * tolerance).float()
    if held is not None:
        weak = torch.maximum(weak, held)
        core = torch.maximum(core, held)
    for _ in range(sum(core.shape[-2:])):
        grown = F.max_pool2d(core, 3, stride=1, padding=1) * weak
        if torch.equal(grown, core):
            break
        core = grown
    return core


def soften(core: torch.Tensor) -> torch.Tensor:
    """The hard change map with a margin and a soft edge, so the edit has room to blend in."""
    grow = reach(*core.shape[-2:])
    return box_blur(F.max_pool2d(core, 2 * grow + 1, stride=1, padding=grow), grow)


def fit_latent(latent: torch.Tensor, height: int, width: int) -> torch.Tensor | None:
    """The original's latent on the result's grid, or None when they are different pictures."""
    h, w = latent.shape[-2:]
    if (h, w) == (height, width):
        return latent
    if abs(h / height - 1.0) > SIZE_SLACK or abs(w / width - 1.0) > SIZE_SLACK:
        return None
    return F.interpolate(latent, size=(height, width), mode="bilinear", align_corners=False)


class EditLock:
    """One lock: the original, the settings, and what the last run kept."""

    def __init__(self, mode: str = "auto", tolerance: float = 1.0):
        self.mode = mode
        self.tolerance = tolerance
        self.source: torch.Tensor | None = None      # IMAGE, [1, H, W, 3]
        self.latent: torch.Tensor | None = None      # [1, C, H, W] or [1, C, 1, H, W], model space
        self.user_mask: torch.Tensor | None = None   # MASK, white = the edit may happen
        self.status = "waiting"
        self.mask: torch.Tensor | None = None        # [B, 1, h, w], 1 = changed, soft-edged
        self.core: torch.Tensor | None = None        # the same before its margin, hard-edged
        self.quiet: torch.Tensor | None = None       # [B], the quiet level at the decision
        self.broad: float | None = None              # the first look's whole-picture reading
        self.wide: float | None = None               # share of the picture the lock would free, at the decision
        self.top: float | None = None                # the strongest spot then, in units of the quiet level
        self.peak: float | None = None               # and the strongest hundredth
        self._sigma: float | None = None
        self._first = True
        self._first_sigma = 1.0
        self._decided = False

    def _begin(self) -> None:
        self.status = "waiting"
        self.mask = None
        self.core = None
        self.quiet = None
        self.broad = None
        self.wide = None
        self.top = None
        self.peak = None
        self._first = True
        self._decided = False

    def _decides_now(self, args: dict, sigma: float) -> bool:
        """True once the noise is down far enough, or this is the run's last step."""
        steps = (args.get("model_options") or {}).get("transformer_options", {}).get("sample_sigmas")
        if steps is None or len(steps) < 2:
            return True  # the sampler does not say where the run ends: decide at once
        if sigma <= float(steps[-2]) * 1.0001:
            return True
        return sigma <= DECIDE_AT * self._first_sigma

    def step(self, args: dict) -> torch.Tensor:
        """ComfyUI's post-CFG hook: the prediction comes in, the locked prediction goes out."""
        pred = args["denoised"]
        sigma = float(args["sigma"].flatten()[0])
        if self._sigma is None or sigma >= self._sigma:
            self._begin()  # the noise level went up: a new run
        self._sigma = sigma
        if self.status in ("whole picture", "size", "video", "vae") or self.latent is None:
            return pred
        video = pred.ndim == 5
        if video and pred.shape[2] != 1:
            self.status = "video"
            return pred
        flat = pred[:, :, 0] if video else pred
        latent = self.latent[:, :, 0] if self.latent.ndim == 5 else self.latent
        if latent.shape[1] != flat.shape[1]:
            self.status = "vae"
            return pred
        source = fit_latent(latent.to(device=flat.device, dtype=torch.float32), *flat.shape[-2:])
        if source is None:
            self.status = "size"
            return pred
        if self.status == "soft":
            # nothing is put back, the picture is only held where the original sits
            back = moved_back(flat, redraws(flat, source))
            return back[:, :, None] if video else back
        if self.user_mask is not None:
            mask = self._given_mask(flat)
        else:
            if self._first:
                self._first_sigma = sigma
                self.broad = float(broad_change(flat, source).max())
                if self.mode == "auto" and self.broad > WHOLE_PICTURE:
                    self.status = "whole picture"
                    return pred
            moves = redraws(flat, source)
            magnitude = difference(flat, source, moves)
            if not self._decided and not self._decides_now(args, sigma):
                # still watching: the model draws its own picture, only its zoom and shift are undone
                self._first = False
                self.status = "watching"
                if self.broad > WHOLE_PICTURE:
                    return pred  # too much is changing to trust the measured move
                back = moved_back(flat, moves)
                return back[:, :, None] if video else back
            if not self._decided:
                self._decided = True
                # the yardstick is set once, here: later steps are read against it
                self.quiet = quiet_level(magnitude)
                self.top, self.peak = peaks(magnitude, self.quiet)
                self.wide = float(change_core(magnitude, self.quiet, self.tolerance).flatten(1).mean(dim=1).max())
                thin = self.top < SOFT_PEAK or (self.wide >= SOFT_WIDE and self.peak < SOFT_PEAK)
                if self.mode == "auto" and not self._first and thin:
                    # a soft change over the whole picture: a lock would hold it back or let it through in patches
                    self.status = "soft"
                    back = moved_back(flat, moves)
                    return back[:, :, None] if video else back
            held = self.core if self.core is not None and self.core.shape[0] == flat.shape[0] else None
            self.core = change_core(magnitude, self.quiet.to(magnitude.device), self.tolerance,
                                    held.to(magnitude.device) if held is not None else None).detach()
            mask = soften(self.core)
        self._first = False
        self.mask = mask.detach()
        self.status = "locked"
        keep = (1.0 - mask).to(flat.dtype)
        locked = flat * (1.0 - keep) + source.to(flat.dtype) * keep
        return locked[:, :, None] if video else locked

    def _given_mask(self, flat: torch.Tensor) -> torch.Tensor:
        mask = self.user_mask
        if mask.ndim == 2:
            mask = mask[None]
        mask = mask[:1, None].to(device=flat.device, dtype=torch.float32)
        mask = F.interpolate(mask, size=flat.shape[-2:], mode="bilinear", align_corners=False).clamp(0.0, 1.0)
        return soften(mask).expand(flat.shape[0], -1, -1, -1)

    def kept_share(self) -> float | None:
        if self.status != "locked" or self.mask is None:
            return None
        return float((self.mask < 0.5).float().mean())

    def pixel_mask(self, height: int, width: int) -> torch.Tensor | None:
        """The change mask at the picture's size, [B, H, W], or None when nothing was locked."""
        if self.status != "locked" or self.mask is None:
            return None
        mask = F.interpolate(self.mask.float().cpu(), size=(height, width), mode="bilinear", align_corners=False)
        return mask[:, 0].clamp(0.0, 1.0)


def restore_pixels(result: torch.Tensor, source: torch.Tensor, mask: torch.Tensor,
                   feather: int) -> tuple[torch.Tensor, torch.Tensor]:
    """The original's own pixels where the mask is black. result [B, H, W, C], source [1, h, w, 3], mask [b, H, W].

    The fade lies outside the edit: the mask is widened by the feather first.
    """
    frames, height, width = int(result.shape[0]), int(result.shape[1]), int(result.shape[2])
    edit = mask[:, None].float()
    if edit.shape[0] not in (1, frames):
        edit = edit[:1]
    if feather > 0:
        size = 2 * feather + 1
        edit = F.max_pool2d(edit, size, stride=1, padding=feather)
        edit = box_blur(edit, feather)
    original = source[..., :3].float()
    if tuple(original.shape[1:3]) != (height, width):
        original = F.interpolate(original.movedim(-1, 1), size=(height, width), mode="bicubic",
                                 align_corners=False, antialias=True).movedim(1, -1).clamp(0.0, 1.0)
    weight = edit.movedim(1, -1).to(result.device, result.dtype)
    out = result.clone()
    out[..., :3] = result[..., :3] * weight + original.to(result.device, result.dtype) * (1.0 - weight)
    edit_mask = edit[:, 0].expand(frames, -1, -1).clone()
    return out, edit_mask


def describe(lock: EditLock) -> str:
    if lock.status == "locked":
        kept = lock.kept_share() or 0.0
        how = "your mask" if lock.user_mask is not None else "what the edit changed"
        text = (f"Edit Lock kept {kept * 100:.0f}% of your picture as it was and left "
                f"{(1.0 - kept) * 100:.0f}% to the edit ({how}).")
        if kept >= NEARLY_ALL and lock.user_mask is None:
            # rain, snow or smoke over the whole picture reads as a small edit and is held back
            text += (" If your edit is missing, it is one that spreads thinly over the whole picture "
                     "(rain, snow, smoke): set lock to off.")
        return text
    if lock.status == "whole picture":
        return ("Edit Lock stepped aside: the edit changes the whole picture, so there was nothing to keep. "
                "Set lock to always to lock anyway.")
    if lock.status == "soft":
        return ("Edit Lock stepped aside: the edit spreads thinly over the whole picture (rain, snow, haze), "
                "so no part of it stayed as it was. It only held the picture in place. "
                "Set lock to always to lock anyway.")
    if lock.status == "off":
        return "Edit Lock is off."
    if lock.status == "size":
        return ("Edit Lock did nothing: the picture and the result are different sizes. "
                "Give it the picture at the size of the result.")
    if lock.status == "video":
        return "Edit Lock did nothing: it works on single pictures, not video."
    if lock.status == "vae":
        return "Edit Lock did nothing: this VAE does not belong to this model."
    return "Edit Lock has not run yet: plug its model output into the sampler."
