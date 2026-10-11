"""Fine edges for a picked area, and the picture's main subject.

SAM 3 says yes or no for every pixel. That is right for a mug and wrong for
hair, where a pixel is often half hair and half wall.

ComfyUI has a model of its own for exactly that: its background-removal
model (BiRefNet, ComfyUI 0.21 or newer). It knows the main subject of a
picture down to single strands, on any background. It knows nothing else: it
cannot tell the hair from the face, and it takes a girl together with the
cup she holds. So the two share the work:

- SAM 3 decides what is picked.
- Where the edge of the pick is the subject's own outline (the pick's side
  is subject, the other side is not), that outline is taken from the
  background-removal model. Everywhere else the edge stays where SAM 3 put
  it: a necklace on a neck, a cup in a hand, hair against a face.
- Background that SAM 3 took along inside a thing of the subject goes: the
  wall between strands, a street light seen through the hair.
- Where a pixel is half see-through, its colour is a mix of the thing and
  what was behind it. The thing's own colour is worked out, so a cut-out
  carries no colour of the old background.

The same model answers "the subject" and "the background" as picks of their
own.
"""

from __future__ import annotations

from collections import OrderedDict
import os
import sys

import torch
import torch.nn.functional as F

from ._execution_helpers import comfy_torch_device, raise_if_interrupted
from ._mask_helpers import grow_shrink_mask

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


# ComfyUI's own folder for these models (models/background_removal).
MODEL_FOLDER = "background_removal"
# What the input holds while fine edges are not wanted.
OFF = "off"
# The file ComfyUI's own example uses. It is taken when the input is off
# and a pick still needs the subject.
PREFERRED = "birefnet.safetensors"

NEEDS_MODEL = (
    "This needs ComfyUI's background-removal model. Get birefnet.safetensors "
    "(about 445 MB) from the Hugging Face page Comfy-Org/BiRefNet, put it in "
    "ComfyUI/models/background_removal, press R to refresh, and try again."
)
NOT_FOUND = (
    "Fine edges: the model file '{name}' is not in ComfyUI/models/background_removal. "
    "Put it there and press R, or pick another file under Fine edges."
)
NEEDS_NEWER = (
    "Fine edges, Subject and Background need ComfyUI 0.21 or newer, which has a "
    "background-removal model built in. Update ComfyUI, or leave them off."
)
NOT_A_MODEL = (
    "Fine edges: '{name}' is not a background-removal model this ComfyUI can read. "
    "Use birefnet.safetensors from the Hugging Face page Comfy-Org/BiRefNet."
)

# The band and its tests are worked out on a copy this long at most. They
# are about areas, not about single pixels, so a big picture loses nothing.
WORK_SIDE = 1024
# All in pixels of that copy.
REACH = 68      # how far outside the pick the outline may lie
INNER = 40      # how far inside the pick it may lie
CORE = 7        # deeper than this counts as well inside, or well outside
RADIUS = 68     # how far around a pixel the two sides are looked at
# From this share of the band's width on, the outline is taken less and
# less, down to nothing where the band ends: so nothing stops at a line.
FADE_FROM = 0.65
# The pick's side counts as subject from this much of it, and the other
# side as not subject up to this much.
IS_SUBJECT = 0.8
NOT_SUBJECT = 0.25
# For taking away inside the pick, its side counts as subject from this
# much on: clearly more subject than not.
MOSTLY = 0.6
# A piece of the pick that is this much subject as a whole is a thing of the
# subject. Where its rim is thin (loose curls with a street light between
# them) but still has this much subject in it, and the background lies
# beyond, the background inside it goes too.
PIECE_IS_SUBJECT = 0.75
THIN = 0.2
# Only a piece with a body counts for that: somewhere it is deeper than
# this. A bracelet or a chain has no rim and no pockets, it is all edge.
BODY = 12
# A pocket of background inside a thing of the subject (a street light seen
# between curls, however deep in the hair) goes whole when it is no bigger
# than this share of the picture and the model is this sure of it.
POCKET = 0.006
POCKET_SURE = 0.25
POCKET_RIM = 6
# What a pixel right beside the pick counts for when the other side is
# looked at, against one well outside. Little, so a strand zone does not
# hide the wall behind it; enough to speak where nothing else is in view.
BESIDE = 0.1
# The matte's nearly-nothing and nearly-all count as nothing and all.
FIRM = 0.04
# A piece of subject inside a pick on the background is solid, and stays,
# when it is more than this many pixels deep: thicker than a strand.
SOLID = 4
# Outside the pick the outline counts only where it joins the pick through
# pixels at least this strong.
JOINS_FROM = 0.08
# A result that keeps less than this share of the pick went wrong: the pick
# is then kept as it was.
KEEP_AT_LEAST = 0.6
# How many loaded models and how many pictures' subjects are remembered.
MODELS_KEPT = 2
SUBJECTS_KEPT = 8
# The colour clean-up's two passes, for a picture 1440 pixels long.
CLEAN_RADII = (90, 6)
CLEAN_FOR = 1440

_MODELS = OrderedDict()
_SUBJECTS = OrderedDict()


# ---------------------------------------------------------------------------
# The model
# ---------------------------------------------------------------------------


def list_subject_models() -> list[str]:
    """The background-removal files this ComfyUI has, by the name the input
    shows. Empty on a ComfyUI without that folder (before 0.21)."""
    if folder_paths is None or MODEL_FOLDER not in getattr(folder_paths, "folder_names_and_paths", {}):
        return []
    return list(folder_paths.get_filename_list(MODEL_FOLDER))


def fine_edge_choices() -> list[str]:
    """What the Fine edges input offers: off, then every model file."""
    return [OFF, *list_subject_models()]


def wants_fine_edges(choice) -> bool:
    return str(choice or OFF).strip() not in ("", OFF)


def subject_model_name(choice) -> str:
    """The model file to ask about the subject: the one Fine edges is set
    to, or, while that is off, ComfyUI's usual one if it is there, else the
    first there is."""
    if wants_fine_edges(choice):
        return str(choice).strip()
    files = list_subject_models()
    if PREFERRED in files:
        return PREFERRED
    if files:
        return files[0]
    raise FileNotFoundError(NEEDS_MODEL)


def _core_node(key: str):
    """One of ComfyUI's own node classes. None outside ComfyUI, or before 0.21."""
    mappings = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", None)
    node = mappings.get(key) if isinstance(mappings, dict) else None
    return node if hasattr(node, "execute") else None


def _load(name: str):
    """The model, through ComfyUI's own loader node, as a workflow would
    load it. Kept while its file does not change."""
    loader = _core_node("LoadBackgroundRemovalModel")
    if loader is None or _core_node("RemoveBackground") is None:
        raise RuntimeError(NEEDS_NEWER)
    path = folder_paths.get_full_path(MODEL_FOLDER, name) if folder_paths is not None else None
    if not path:
        raise FileNotFoundError(NOT_FOUND.format(name=name) if list_subject_models() else NEEDS_MODEL)
    stamp = (path, os.path.getmtime(path), os.path.getsize(path))
    kept = _MODELS.get(name)
    if kept is not None and kept[0] == stamp:
        _MODELS.move_to_end(name)
        return kept[1]
    try:
        model = loader.execute(bg_removal_name=name).result[0]
    except Exception as error:  # noqa: BLE001 - ComfyUI's own words for a wrong file are not plain
        raise ValueError(NOT_A_MODEL.format(name=name)) from error
    _MODELS[name] = (stamp, model)
    while len(_MODELS) > MODELS_KEPT:
        _MODELS.popitem(last=False)
    return model


def loaded_subject_models() -> list:
    """The models this module holds, for Free VRAM."""
    return [model for _, model in _MODELS.values()]


def subject_matte(frame: torch.Tensor, choice, key: str | None = None) -> torch.Tensor:
    """How much of each pixel is the picture's main subject (H x W, 0..1).

    `frame` is one picture, 1 x H x W x C. `choice` is what Fine edges is
    set to. With `key` (the picture's own key) the answer is remembered: a
    picture is asked about once, however many picks follow."""
    name = subject_model_name(choice)
    slot = (name, key)
    if key is not None and slot in _SUBJECTS:
        _SUBJECTS.move_to_end(slot)
        return _SUBJECTS[slot].float() / 255.0
    model = _load(name)
    raise_if_interrupted()
    answer = _core_node("RemoveBackground").execute(bg_removal_model=model, image=frame[..., :3]).result[0]
    height, width = int(frame.shape[1]), int(frame.shape[2])
    if not isinstance(answer, torch.Tensor) or answer.ndim != 3 or tuple(answer.shape[1:]) != (height, width):
        raise ValueError("the background-removal model's answer is not one mask the size of the picture")
    matte = answer[0].detach().float().clamp(0.0, 1.0).cpu()
    if key is not None:
        _SUBJECTS[slot] = (matte * 255.0).round().to(torch.uint8)
        while len(_SUBJECTS) > SUBJECTS_KEPT:
            _SUBJECTS.popitem(last=False)
    return matte


def forget_subjects() -> None:
    _SUBJECTS.clear()
    _MODELS.clear()


# ---------------------------------------------------------------------------
# Small tools, all on N x C x H x W
# ---------------------------------------------------------------------------


def _grown(area: torch.Tensor, cross: bool) -> torch.Tensor:
    """`area` one pixel bigger: to every side, or (cross) not to the corners."""
    values = area.float()
    if cross:
        return torch.maximum(F.max_pool2d(values, (3, 1), 1, (1, 0)), F.max_pool2d(values, (1, 3), 1, (0, 1))) > 0.5
    return F.max_pool2d(values, 3, 1, 1) > 0.5


def _depth(area: torch.Tensor, steps: int) -> torch.Tensor:
    """How many pixels deep each pixel sits inside `area`, counted up to
    `steps`. Every other step leaves the corners out, so "this deep" is
    close to a circle and not a square: a band made from it has no corners
    of its own. The picture's border is no edge."""
    deep = torch.zeros(area.shape, device=area.device)
    left = area
    for step in range(int(steps)):
        deep += left
        left = ~_grown(~left, cross=step % 2 == 1)
        if not bool(left.any()):
            break
    return deep


def _reached(seed: torch.Tensor, through: torch.Tensor, steps: int) -> torch.Tensor:
    """`seed` grown by up to `steps` pixels, without leaving `through`."""
    area = seed & through
    for step in range(int(steps)):
        wider = _grown(area, cross=step % 2 == 1) & through
        if bool((wider == area).all()):
            break
        area = wider
    return area


def _box(values: torch.Tensor, reach: int) -> torch.Tensor:
    return F.avg_pool2d(F.pad(values, (reach, reach, reach, reach), mode="replicate"), 2 * reach + 1, 1)


def _blur(values: torch.Tensor, reach: int) -> torch.Tensor:
    """A soft blur of about `reach` pixels: three box passes."""
    step = max(1, int(reach) // 3)
    return _box(_box(_box(values, step), step), step)


def _wide_blur(values: torch.Tensor, reach: int) -> torch.Tensor:
    """`_blur` for a wide reach, worked out on a smaller copy: the result is
    smooth anyway, and the work stays small on a large picture."""
    shrink = max(1, int(reach) // 12)
    if shrink == 1:
        return _blur(values, reach)
    height, width = values.shape[-2:]
    small = F.interpolate(values, size=(max(1, height // shrink), max(1, width // shrink)), mode="area")
    small = _blur(small, max(1, int(reach) // shrink))
    return F.interpolate(small, size=(height, width), mode="bilinear", align_corners=False)


def _around(values: torch.Tensor, weight: torch.Tensor, reach: int) -> tuple:
    """The weighted mean of `values` around every pixel, also where the
    weight itself is zero (within the reach), and how much weight was there."""
    total = _wide_blur(weight, reach)
    return _wide_blur(values * weight, reach) / total.clamp_min(1e-6), total


def _seen(values: torch.Tensor, counts: torch.Tensor, through: torch.Tensor, reach: int) -> tuple:
    """`_around` that does not look across a wall: the weighted mean of
    `values` each pixel of `through` has in view without leaving `through`,
    about `reach` pixels far, and how much weight it found.

    `_around` blurs straight through whatever lies between. Down the front of
    an open coat that reads the field beyond the coat's other half as "the
    other side" of the gap. Here the look spreads step by step and only over
    `through`, so a gap is read by what is in the gap and at its ends. Worked
    out on a smaller copy, like `_wide_blur`."""
    shrink = max(1, int(reach) // 16)
    height, width = values.shape[-2:]
    size = (max(1, height // shrink), max(1, width // shrink))
    weight = counts * through.float()

    def small(field: torch.Tensor) -> torch.Tensor:
        return F.interpolate(field, size=size, mode="area") if shrink > 1 else field

    open_ = (small(through.float()) >= 0.5).float()
    total, found = small(values * weight) * open_, small(weight) * open_
    # As wide as `_blur(reach)`: one step of a 3 x 3 mean spreads by 2/3.
    side = 2 * max(1, int(reach) // shrink // 3) + 1
    for _step in range(max(1, round((side * side - 1) / 4 * 1.5))):
        near = _box(open_, 1).clamp_min(1e-6)
        total, found = _box(total, 1) / near * open_, _box(found, 1) / near * open_
    if shrink > 1:
        total = F.interpolate(total, size=(height, width), mode="bilinear", align_corners=False)
        found = F.interpolate(found, size=(height, width), mode="bilinear", align_corners=False)
    return total / found.clamp_min(1e-6), found


def _pieces(area: torch.Tensor) -> torch.Tensor:
    """A number for every connected piece of `area` (1 x 1 x H x W): one long
    row of numbers, a pixel after the other, 0 outside the area.

    Every pixel starts with its own number; each pass takes the largest
    number next to it and then the number that pixel holds, until a piece
    holds one number."""
    size = area.shape[-2:]
    inside = area.reshape(-1)
    count = inside.numel()
    nothing = torch.zeros(count, device=area.device)
    names = torch.where(inside, torch.arange(1, count + 1, dtype=torch.float32, device=area.device), nothing)
    for _pass in range(count):
        spread = F.max_pool2d(names.view(1, 1, *size), 3, 1, 1).reshape(-1)
        spread = torch.where(inside, spread, nothing)
        spread = torch.where(inside, spread[(spread.long() - 1).clamp(min=0)], nothing)
        if torch.equal(spread, names):
            break
        names = spread
    return names.long()


def _per_piece(piece: torch.Tensor, values: torch.Tensor) -> torch.Tensor:
    """The sum of `values` over each piece, by the piece's number."""
    return torch.zeros(piece.numel() + 1, device=piece.device).index_add_(0, piece, values.reshape(-1).float())


def _things_of_the_subject(picked: torch.Tensor, matte: torch.Tensor, inside: torch.Tensor) -> torch.Tensor:
    """The pieces of the pick that are things of the subject: mostly
    subject as a whole, and with a body (1 x 1 x H x W, True there).

    `inside` is how deep each picked pixel lies. Worked out on a smaller
    copy: this is a count, not an edge."""
    height, width = picked.shape[-2:]
    shrink = 4 if max(height, width) > 256 else 1
    if shrink > 1:
        size = (max(1, height // shrink), max(1, width // shrink))
        small = F.interpolate(picked.float(), size=size, mode="area") >= 0.5
        worth = F.interpolate(matte, size=size, mode="area")
        deep = F.adaptive_max_pool2d(inside, size)
    else:
        small, worth, deep = picked, matte, inside
    piece = _pieces(small)
    many = _per_piece(piece, torch.ones_like(worth)).clamp_min(1.0)
    good = (_per_piece(piece, worth) > PIECE_IS_SUBJECT * many) & (_per_piece(piece, (deep > BODY).float()) > 0)
    good[0] = False
    things = good[piece].view(1, 1, *small.shape[-2:])
    if shrink > 1:
        things = F.interpolate(things.float(), size=(height, width), mode="nearest") > 0.5
    return things & picked


def _pockets(picked: torch.Tensor, matte: torch.Tensor, of_subject: torch.Tensor) -> torch.Tensor:
    """Small pockets of background inside a thing of the subject, each with
    its soft rim (1 x 1 x H x W, True there)."""
    low = picked & of_subject & (matte < 0.5)
    if not bool(low.any()):
        return low
    piece = _pieces(low)
    many = _per_piece(piece, torch.ones_like(matte))
    small = (many <= POCKET * piece.numel()) & (_per_piece(piece, matte) < POCKET_SURE * many)
    small[0] = False
    return _reached(small[piece].view_as(picked), picked, POCKET_RIM)


# ---------------------------------------------------------------------------
# The edge
# ---------------------------------------------------------------------------


def _firm(matte: torch.Tensor) -> torch.Tensor:
    """The matte with its nearly-nothing and nearly-all made nothing and all:
    under FIRM it is 0, over 1 - FIRM it is 1. So no faint veil is left
    where there is nothing, and what is solid stays solid."""
    return ((matte - FIRM) / (1.0 - 2.0 * FIRM)).clamp(0.0, 1.0)


def _carried(answers: torch.Tensor, along: torch.Tensor) -> torch.Tensor:
    """What the edge nearest to each pixel answered (N x C x H x W).

    `answers` hold a value per pixel that only counts along the edge
    (`along`, 1 there). Every pixel takes the mean answer of the edge it has
    in view, from the tightest look-around that has any: on the edge that is
    the edge's own answer, far out in the band it is the answer of the
    stretch of edge it lies off."""
    out = torch.zeros_like(answers)
    found = torch.zeros_like(along, dtype=torch.bool)
    for reach in (6, 12, 24, 48, 96, 2 * REACH):
        weight = _wide_blur(along, reach)
        fresh = (weight > 0.02) & ~found
        if bool(fresh.any()):
            out = torch.where(fresh, _wide_blur(answers * along, reach) / weight.clamp_min(1e-6), out)
            found |= fresh
    return out


@torch.no_grad()
def outline_plan(picked: torch.Tensor, matte: torch.Tensor) -> tuple:
    """Where the pick's edge is the subject's outline, and how much of the
    matte to take there. All 1 x 1 x h x w, at the working size.

    Returns (weights, turned, joined). `weights` and `turned` come as a
    pair of maps each, one that counts inside the pick and one that counts
    outside it (see `_side`):
    - `weights`, 0..1: how much of the matte replaces the pick. 0 means the
      pick stays as it is.
    - `turned`: True where the pick lies outside the subject (a picked
      background), so the matte counts the other way round there.
    - `joined`: outside the pick, True where the result joins the pick. A
      strand over the wall joins the hair; a lit speck far away does not.

    Two questions are asked along the edge itself, where both sides are in
    view: "is the pick subject here?" and "is this edge the outline?" (the
    pick subject, the other side not). The answers are then carried across
    the band to every pixel near that stretch of edge. Asked pixel by pixel,
    a strand far out would have no "inside" in view any more and be cut off
    where that happens.
    """
    inside, outside = _depth(picked, INNER + 1), _depth(~picked, REACH + 1)
    in_matte, in_weight = _around(matte, (inside > CORE).float(), RADIUS)
    # The other side is what lies beyond the edge without crossing the pick
    # again: in a gap of the pick that is what the gap shows (the shirt down
    # the front of an open coat), not the field beyond the coat's other half.
    beside = (outside > CORE).float() + BESIDE * ((outside > 0) & (outside <= CORE)).float()
    out_matte, out_weight = _seen(matte, beside, ~picked, RADIUS)
    along = ((inside <= CORE + 1) & (outside <= CORE + 1) & (in_weight > 0.02) & (out_weight > 0.004)).float()
    # Which side of the subject the pick lies on here, and whether the other
    # side of its edge is the opposite: then the edge is the outline.
    # For taking away inside a pick on the subject, "mostly" is enough:
    # where SAM 3's mask swallowed a strip of wall, the pick's side is no
    # longer nearly all subject, and that is exactly where the wall has to
    # go. The model's "not subject" can be trusted that far. Its "subject"
    # cannot: a flower lying on a sweater is partly subject to it, and must
    # not lose that part. So a pick on the background only gives way where
    # its edge is the outline.
    is_subject = (in_matte > MOSTLY).float()
    # Loose curls at the rim of the hair, a street light between them: there
    # the pick's side is no longer mostly subject. It still is the subject's
    # own rim when the piece as a whole is subject, some of it is here, and
    # beyond the edge there is none.
    of_subject = _things_of_the_subject(picked, matte, inside)
    whole = F.max_pool2d(of_subject.float(), 2 * CORE + 3, 1, CORE + 1) > 0.5
    is_subject = torch.maximum(is_subject, whole.float() * (in_matte > THIN).float() * (out_matte < NOT_SUBJECT).float())
    outline_subject = (in_matte > IS_SUBJECT).float() * (out_matte < NOT_SUBJECT).float()
    outline_backdrop = (in_matte < NOT_SUBJECT).float() * (out_matte > IS_SUBJECT).float()
    votes = _carried(torch.cat([is_subject, outline_backdrop, outline_subject, outline_backdrop], dim=1), along)

    def sure(vote: torch.Tensor) -> torch.Tensor:
        # From two thirds of the edge nearby on: between a stretch that
        # counts and one that does not, the matte comes in gradually.
        return _blur(((vote - 1.0 / 3.0) * 3.0).clamp(0.0, 1.0), 3)

    fade_in = ((INNER + 1 - inside) / max(1.0, INNER * (1.0 - FADE_FROM))).clamp(0.0, 1.0)
    fade_out = ((REACH + 1 - outside) / max(1.0, REACH * (1.0 - FADE_FROM))).clamp(0.0, 1.0)
    # Inside the pick the matte may take away wherever the pick is subject:
    # wall between strands goes, whatever lies beyond the edge. Outside the
    # pick it may only add where the edge is the outline: a strand over the
    # wall joins the hair, the face beside the hair does not. The two are
    # kept apart, each for its own side of the edge: brought up to a bigger
    # picture, one must not run into the other across the edge.
    weights = torch.cat([
        fade_in * sure(torch.maximum(votes[:, 0:1], votes[:, 1:2])),
        fade_out * sure(torch.maximum(votes[:, 2:3], votes[:, 3:4])),
    ], dim=1)
    turned = torch.cat([votes[:, 1:2] > votes[:, 0:1], votes[:, 3:4] > votes[:, 2:3]], dim=1)
    # A pick on the background gives way to the subject's soft fringe and to
    # strands that cross into it. A solid piece of "subject" lying in it is
    # another matter: that is the model's own view of the thing (the part of
    # a flower that lies on the sweater), and the thing keeps it.
    solid = _depth(picked & (matte > 0.5), SOLID + 1) > SOLID
    if bool(solid.any()):
        kept = _reached(solid, picked & (matte > FIRM), 4 * SOLID)
        weights[:, 0:1] = torch.where(kept & turned[:, 0:1], torch.zeros_like(weights[:, 0:1]), weights[:, 0:1])
    # A pocket of background inside a thing of the subject goes whole,
    # however far from the pick's edge it lies.
    pocket = _pockets(picked, matte, of_subject)
    weights[:, 0:1] = torch.maximum(weights[:, 0:1], pocket.float())
    turned[:, 0:1] = turned[:, 0:1] & ~pocket
    plain = picked.float()
    target = _firm(torch.where(_side(turned, picked), 1.0 - matte, matte))
    alpha = plain + _side(weights, picked) * (target - plain)
    joined = picked
    strong = alpha > JOINS_FROM
    for step in range(REACH + 1):
        wider = _grown(joined, cross=step % 2 == 1) & (picked | strong)
        if bool((wider == joined).all()):
            break
        joined = wider
    return weights, turned, joined


def _side(pair: torch.Tensor, picked: torch.Tensor) -> torch.Tensor:
    """Of a pair of maps (N x 2 x H x W), the first inside the pick and the
    second outside it."""
    return torch.where(picked, pair[:, 0:1], pair[:, 1:2])


@torch.no_grad()
def subject_edge(picked: torch.Tensor, matte: torch.Tensor, keep_hard: torch.Tensor | None = None) -> torch.Tensor:
    """One picture's pick with the subject's outline where the two meet
    (H x W, 0..1).

    `picked` is H x W (True inside), `matte` H x W (0..1, the subject).
    `keep_hard` (H x W, True) marks what must stay exactly as picked: paint.
    """
    plain = picked.float()
    if not bool(picked.any()) or bool(picked.all()):
        return plain
    height, width = picked.shape
    scale = min(1.0, WORK_SIDE / max(height, width))
    full_pick, full_matte = picked[None, None], matte[None, None].float().clamp(0.0, 1.0)
    if scale < 1.0:
        size = (max(32, round(height * scale)), max(32, round(width * scale)))
        small_pick = F.interpolate(full_pick.float(), size=size, mode="area") >= 0.5
        small_matte = F.interpolate(full_matte, size=size, mode="area")
    else:
        small_pick, small_matte = full_pick, full_matte
    if not bool(small_pick.any()):
        return plain
    weights, turned, joined = outline_plan(small_pick, small_matte)
    if scale < 1.0:
        weights = F.interpolate(weights, size=(height, width), mode="bilinear", align_corners=False)
        turned = F.interpolate(turned.float(), size=(height, width), mode="nearest") > 0.5
        joined = F.interpolate(_grown(joined, cross=False).float(), size=(height, width), mode="nearest") > 0.5
    target = _firm(torch.where(_side(turned, full_pick), 1.0 - full_matte, full_matte))
    alpha = full_pick.float() + _side(weights, full_pick) * (target - full_pick.float())
    alpha = torch.where(full_pick | joined, alpha, torch.zeros_like(alpha))[0, 0]
    if keep_hard is not None:
        alpha = torch.where(keep_hard, plain, alpha)
    if float((alpha * plain).sum()) < KEEP_AT_LEAST * float(plain.sum()):
        return plain
    return alpha.clamp(0.0, 1.0)


def grow_fine(alpha: torch.Tensor, hard: torch.Tensor, pixels: int) -> torch.Tensor:
    """Grow or shrink a mask that has a fine edge (B x H x W both).

    The plain area (`hard`, on or off) is what moves. Grown, it is laid over
    the fine edge, so the area is solid out to its new line and strands
    longer than that still show. Shrunk, it cuts the fine edge back to its
    new line. Pushing the soft values themselves about would turn strands
    into blocks."""
    pixels = int(pixels)
    if pixels == 0:
        return alpha
    moved = grow_shrink_mask(hard.to(alpha.dtype), pixels)
    return torch.maximum(moved, alpha) if pixels > 0 else torch.minimum(moved, alpha)


# ---------------------------------------------------------------------------
# The colours
# ---------------------------------------------------------------------------


@torch.no_grad()
def clean_colours(frame: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    """The thing's own colour for every pixel (H x W x 3).

    `frame` is H x W x 3, `alpha` H x W: how much of each pixel is the thing.
    Where a pixel is all the thing, the colour is the picture's own. Where it
    is a mix, two passes work it out, a wide one and a narrow one: each
    guesses the thing's colour and the background's from the pixels around,
    and corrects the guess by what the picture shows at that pixel."""
    image = frame[..., :3].movedim(-1, 0)[None].float().clamp(0.0, 1.0)
    cover = alpha[None, None].float().clamp(0.0, 1.0)
    grow = max(image.shape[-2:]) / CLEAN_FOR
    thing, behind = image, image
    for reach in CLEAN_RADII:
        reach = max(1, round(reach * grow))
        weight = _wide_blur(cover, reach)
        near_thing = _wide_blur(thing * cover, reach) / (weight + 1e-5)
        near_behind = _wide_blur(behind * (1.0 - cover), reach) / ((1.0 - weight) + 1e-5)
        thing = (near_thing + cover * (image - cover * near_thing - (1.0 - cover) * near_behind)).clamp(0.0, 1.0)
        behind = near_behind.clamp(0.0, 1.0)
    return thing[0].movedim(0, -1)


def shown_colours(frame: torch.Tensor, clean: torch.Tensor, alpha: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """The colours for a cut-out whose see-through channel is `mask`.

    `alpha` is the fine edge as found, `mask` what the node returns after
    Grow and Soften. Where the two are the same the clean colour is right.
    Where the mask shows more of a pixel than the thing covers (it was
    grown), the rest of the pixel is the picture itself, so the colour moves
    back to the picture's own: a mask of 1 shows the picture as it is."""
    cover = alpha.unsqueeze(-1).clamp(0.0, 1.0)
    shown = mask.unsqueeze(-1).clamp(0.0, 1.0)
    extra = ((shown - cover) / (1.0 - cover).clamp_min(1e-4)).clamp(0.0, 1.0)
    mixed = (cover * (1.0 - extra) * clean + extra * frame[..., :3]) / (cover * (1.0 - extra) + extra).clamp_min(1e-4)
    return torch.where(shown > cover, mixed, clean).clamp(0.0, 1.0)


# ---------------------------------------------------------------------------
# All of it, for the node
# ---------------------------------------------------------------------------


def fine_edges(
    image: torch.Tensor, picked: torch.Tensor, choice, turned: bool = False,
    keep_hard: torch.Tensor | None = None, keys: list | None = None,
) -> tuple:
    """Every picture's pick with a fine edge, and its clean colours.

    `image` is B x H x W x C, `picked` B x H x W (True inside), `choice`
    what Fine edges is set to. `keep_hard` (B x H x W) marks painted areas,
    which stay exactly as painted; `keys` are the pictures' keys, so each
    picture's subject is asked for once. Returns (B x H x W alpha,
    B x H x W x 3 colours), both on the CPU. With `turned` the colours are
    those of everything but the pick: what a mask turned round shows."""
    device = comfy_torch_device()
    alphas, colours = [], []
    for index in range(int(picked.shape[0])):
        raise_if_interrupted()
        at = min(index, image.shape[0] - 1)
        area = picked[index]
        if not bool(area.any()):
            alphas.append(area.float())
            colours.append(image[at, ..., :3].float().cpu())
            continue
        matte = subject_matte(image[at:at + 1], choice, keys[at] if keys else None)
        hard = None if keep_hard is None else keep_hard[index].to(device)
        alpha = subject_edge(area.to(device), matte.to(device), hard)
        frame = image[at].to(device)
        alphas.append(alpha.cpu())
        colours.append(clean_colours(frame, 1.0 - alpha if turned else alpha).cpu())
    return torch.stack(alphas), torch.stack(colours)
