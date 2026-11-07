"""Camera Move: the camera keys, the camera's pose and the depth warp.

The keys are what the node's face writes: a list of moments on the clip
(t from 0 to 1) and where the camera is at each one. Between two keys the
camera eases from one to the other. The face draws its picture with the
same maths, so what you steer on the node is what the warp makes.

Axes are OpenCV's: x right, y down, z into the picture. Each frame's points
stay where the original camera saw them; only the camera moves.

Technical details
-----------------
A key holds az (turn, degrees, right is positive), el (rise, degrees, up is
positive), back (pull back, in distances to the pivot; negative pushes in),
px and py (slide right and down, in distances to the pivot).

  R = Ry(-az) . Rx(-el)
  C = pivot - R.pivot + R.[px.d, py.d, -back.d]      d = |pivot|

A point P lands in the new camera at R^T (P - C). The pivot is the spot the
camera circles: picked by a tap on the face, else what sits in the middle
of the first frame.
"""

from __future__ import annotations

import json
import math

LIMITS = {"az": (-90.0, 90.0), "el": (-30.0, 60.0), "back": (-0.6, 2.0), "px": (-1.0, 1.0), "py": (-1.0, 1.0)}
FIELDS = tuple(LIMITS)
HOME = {name: 0.0 for name in FIELDS}
# Where the LoRA was trained to work well. Past this the face warns.
LORA_RANGE = {"az": 45.0, "el_up": 30.0, "el_down": -20.0}
# Two keys within this much of the clip are the same key.
SAME_KEY = 0.015
MAX_KEYS = 64
MAGENTA = (1.0, 0.0, 1.0)
# The nearest thing in the middle of the first frame, never further than this
# (in the depth model's metres): the move stays a move, not a flight.
PIVOT_CAP = 3.0
SCENE_LONG_SIDE = 416
# Every second frame of a 5-second clip, so the face plays smoothly (about 190 KB a frame).
SCENE_FRAMES = 61

DEFAULT_CAMERA = {
    "v": 1,
    "keys": [{"t": 0.0, **HOME}, {"t": 1.0, **HOME, "az": 30.0, "el": 5.0}],
    "pivot": None,
}


def default_camera_text() -> str:
    return json.dumps(DEFAULT_CAMERA, separators=(",", ":"))


def _number(value, fallback=0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _clamp(value, low, high):
    return max(low, min(high, value))


def clean_key(raw) -> dict:
    """One key with every field present, inside its limits."""
    raw = raw if isinstance(raw, dict) else {}
    key = {"t": _clamp(_number(raw.get("t")), 0.0, 1.0)}
    for name, (low, high) in LIMITS.items():
        key[name] = _clamp(_number(raw.get(name)), low, high)
    return key


def parse_camera(text) -> dict:
    """The camera the face wrote. Anything unreadable falls back to the default move.

    Returns {"keys": [...], "pivot": None | {"u", "v", "t"}, "fallback": bool}.
    Keys come back sorted by time, with keys at the same moment merged (the
    later one wins), and never empty.
    """
    data = None
    if isinstance(text, dict):
        data = text
    elif isinstance(text, str) and text.strip():
        try:
            data = json.loads(text)
        except (ValueError, RecursionError):
            data = None
    fallback = not isinstance(data, dict) or not isinstance(data.get("keys"), list) or not data["keys"]
    if fallback:
        data = DEFAULT_CAMERA
    keys = []
    for raw in data["keys"][:MAX_KEYS]:
        key = clean_key(raw)
        same = next((k for k in keys if abs(k["t"] - key["t"]) < SAME_KEY), None)
        if same is not None:
            same.update(key)
        else:
            keys.append(key)
    keys.sort(key=lambda k: k["t"])
    pivot = data.get("pivot")
    if isinstance(pivot, dict) and all(name in pivot for name in ("u", "v")):
        pivot = {
            "u": _clamp(_number(pivot.get("u"), 0.5), 0.0, 1.0),
            "v": _clamp(_number(pivot.get("v"), 0.5), 0.0, 1.0),
            "t": _clamp(_number(pivot.get("t"), 0.0), 0.0, 1.0),
        }
    else:
        pivot = None
    return {"keys": keys, "pivot": pivot, "fallback": fallback}


def smoothstep(s: float) -> float:
    return s * s * (3.0 - 2.0 * s)


def camera_at(keys, t: float) -> dict:
    """Where the camera is at moment t (0..1), easing between the keys either side."""
    if not keys:
        return dict(HOME)
    first, last = keys[0], keys[-1]
    if len(keys) == 1 or t <= first["t"]:
        return {name: first[name] for name in FIELDS}
    if t >= last["t"]:
        return {name: last[name] for name in FIELDS}
    for a, b in zip(keys, keys[1:]):
        if a["t"] <= t <= b["t"]:
            e = smoothstep((t - a["t"]) / max(1e-6, b["t"] - a["t"]))
            return {name: a[name] + (b[name] - a[name]) * e for name in FIELDS}
    return {name: last[name] for name in FIELDS}


def frame_moments(count: int) -> list[float]:
    """The moment (0..1) of each frame. One frame sits at the start."""
    if count <= 1:
        return [0.0] * max(0, count)
    return [i / (count - 1) for i in range(count)]


def rotation(az: float, el: float) -> list[list[float]]:
    """R = Ry(-az) . Rx(-el): az > 0 swings the camera right, el > 0 lifts it."""
    th, ph = math.radians(-az), math.radians(-el)
    ct, st, cp, sp = math.cos(th), math.sin(th), math.cos(ph), math.sin(ph)
    return [[ct, st * sp, st * cp], [0.0, cp, -sp], [-st, ct * sp, ct * cp]]


def _mv(R, v):
    return [sum(R[r][c] * v[c] for c in range(3)) for r in range(3)]


def pose(cam: dict, pivot) -> tuple[list[list[float]], list[float]]:
    """The moved camera's rotation R and centre C, for a key and a pivot point."""
    R = rotation(cam["az"], cam["el"])
    d = math.sqrt(sum(x * x for x in pivot))
    Rp = _mv(R, pivot)
    b = _mv(R, [cam.get("px", 0.0) * d, cam.get("py", 0.0) * d, -cam["back"] * d])
    return R, [pivot[i] - Rp[i] + b[i] for i in range(3)]


def past_lora_range(cam: dict) -> bool:
    return abs(cam["az"]) > LORA_RANGE["az"] or cam["el"] > LORA_RANGE["el_up"] or cam["el"] < LORA_RANGE["el_down"]


def range_report(keys) -> str:
    """One plain line when a key goes past where the LoRA was trained, else empty."""
    over = [k for k in keys if past_lora_range(k)]
    if not over:
        return ""
    when = ", ".join(f"{k['t']:.2f}" for k in over[:4])
    return (
        f"Camera Move: {len(over)} key(s) past the LoRA's range (at {when} of the clip). "
        "It learned up to 45 degrees of turn, 30 up and 20 down; more may leave pink."
    )


def scene_frame_indices(count: int, most: int = SCENE_FRAMES) -> list[int]:
    """Which frames the face gets to look at: evenly spread, first and last included."""
    if count <= 0:
        return []
    if count <= most:
        return list(range(count))
    return sorted({round(i * (count - 1) / (most - 1)) for i in range(most)})


def scene_size(width: int, height: int, long_side: int = SCENE_LONG_SIDE) -> tuple[int, int]:
    scale = min(1.0, long_side / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def pack_depth(z, valid, zmin: float, zmax: float):
    """Depth as two bytes a pixel (red high, green low) on a log scale; 0 is no depth.

    z and valid are numpy arrays. Returns an (H, W, 3) uint8 array.
    """
    import numpy as np

    lo, hi = math.log(max(zmin, 1e-6)), math.log(max(zmax, zmin * 1.0001, 1e-6))
    q = np.zeros(z.shape, dtype=np.uint32)
    if valid.any():
        zz = np.clip(z[valid], math.exp(lo), math.exp(hi))
        q[valid] = 1 + np.round((np.log(zz) - lo) / max(1e-9, hi - lo) * 65534).astype(np.uint32)
    out = np.zeros(z.shape + (3,), dtype=np.uint8)
    out[..., 0] = (q >> 8) & 255
    out[..., 1] = q & 255
    return out


def unpack_depth(rgb, zmin: float, zmax: float, far: float):
    """The face's reading of pack_depth, for tests."""
    import numpy as np

    q = rgb[..., 0].astype(np.uint32) * 256 + rgb[..., 1].astype(np.uint32)
    lo, hi = math.log(zmin), math.log(zmax)
    z = np.exp(lo + (q.astype(np.float64) - 1) / 65534 * (hi - lo))
    return np.where(q == 0, far, z), q > 0


# -- the warp (torch) ---------------------------------------------------------


def pixel_intrinsics(K, width: int, height: int):
    """MoGe's lens as pixels; it may come normalised to the picture size."""
    K = K.clone().float()
    if K[0, 2] < 4:
        K[0, :] *= width
        K[1, :] *= height
    return K


def prepare_geometry(geometry: dict):
    """Points, colours and lens from a MOGE_GEOMETRY, with every frame held to one depth scale.

    The depth model's scale wobbles from frame to frame. Each frame is scaled
    so its median depth follows a smoothed line through all of them.
    """
    import torch
    import torch.nn.functional as F

    points = geometry.get("points")
    intrinsics = geometry.get("intrinsics")
    if points is None or intrinsics is None:
        raise ValueError(
            "Camera Move needs depth from MoGe Inference with its camera lens. "
            "Connect MoGe Inference's geometry, not a panorama."
        )
    points = points.float()
    count, height, width, _ = points.shape
    image = geometry["image"][..., :3].float()
    if image.shape[1:3] != (height, width):
        image = F.interpolate(image.movedim(-1, 1), size=(height, width), mode="bilinear", align_corners=False).movedim(1, -1)
    z = points[..., 2]
    valid = torch.isfinite(points).all(-1) & (z > 0)
    mask = geometry.get("mask")
    if mask is not None:
        valid &= mask.bool().to(valid.device)
    z = torch.where(valid, z, torch.zeros_like(z))
    meds = torch.stack([z[i][valid[i]].median() if valid[i].any() else torch.tensor(1.0) for i in range(count)])
    win = 9
    padded = F.pad(meds.log()[None, None], (win // 2, win // 2), mode="replicate")
    smooth = F.avg_pool1d(padded, win, 1)[0, 0]
    scale = meds.median() / smooth.exp()
    z = z * scale[:, None, None]
    Ks = torch.stack([pixel_intrinsics(intrinsics[i], width, height) for i in range(count)])
    v0 = valid[0]
    far = float(torch.quantile(z[0][v0][::7], 0.98)) * 2.5 if v0.any() else float(meds.median()) * 10.0
    return {"z": z, "valid": valid, "image": image, "K": Ks, "far": far, "count": count, "width": width, "height": height}


def unproject(K, x: float, y: float, depth: float) -> list[float]:
    fx, fy, cx, cy = float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])
    return [(x - cx) / fx * depth, (y - cy) / fy * depth, depth]


def auto_pivot(scene) -> list[float]:
    """What sits in the middle of the first frame: the nearest fifth of the centre box."""
    import torch

    z0, v0, H, W = scene["z"][0], scene["valid"][0], scene["height"], scene["width"]
    box = (slice(int(H * 0.35), int(H * 0.65)), slice(int(W * 0.4), int(W * 0.6)))
    vb = v0[box]
    if vb.any():
        depth = float(torch.quantile(z0[box][vb].float(), 0.2))
    elif v0.any():
        depth = float(z0[v0].median())
    else:
        depth = 1.0
    return [0.0, 0.0, min(depth, PIVOT_CAP)]


def resolve_pivot(scene, pivot) -> list[float]:
    """The 3D spot the camera circles: the tapped one, else the automatic one."""
    if not pivot:
        return auto_pivot(scene)
    count, H, W = scene["count"], scene["height"], scene["width"]
    i = min(count - 1, max(0, round(pivot["t"] * (count - 1))))
    x = min(W - 1, max(0, int(pivot["u"] * W)))
    y = min(H - 1, max(0, int(pivot["v"] * H)))
    z, valid = scene["z"][i], scene["valid"][i]
    for r in range(0, 4):
        y0, y1, x0, x1 = max(0, y - r), min(H, y + r + 1), max(0, x - r), min(W, x + r + 1)
        patch = valid[y0:y1, x0:x1]
        if patch.any():
            depth = float(z[y0:y1, x0:x1][patch].median())
            return unproject(scene["K"][i], x + 0.5, y + 0.5, depth)
    return auto_pivot(scene)


def _fill_cracks(img, filled, passes=2):
    """Fill one-pixel gaps that are mostly surrounded by picture."""
    import torch
    import torch.nn.functional as F

    k = torch.ones(1, 1, 3, 3, device=img.device)
    for _ in range(passes):
        f = filled.float()[None, None]
        cnt = F.conv2d(f, k, padding=1)[0, 0]
        s = F.conv2d((img * filled.float())[:, None], k, padding=1)[:, 0]
        take = (~filled) & (cnt >= 5)
        if not take.any():
            break
        img = torch.where(take[None], s / cnt.clamp(min=1), img)
        filled = filled | take
    return img, filled


def warp_frame(scene, i: int, cam: dict, pivot, device):
    """One frame seen from the moved camera. Returns (colour (H,W,3), hole (H,W) bool) on the CPU."""
    import torch

    H, W = scene["height"], scene["width"]
    K = scene["K"][i].to(device)
    Kinv = torch.linalg.inv(K)
    valid = scene["valid"][i].to(device)
    zi = torch.where(valid, scene["z"][i].to(device), torch.full((H, W), scene["far"], device=device))
    col = scene["image"][i].to(device)
    sub = torch.tensor([[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]], device=device)
    vv, uu = torch.meshgrid(torch.arange(H, device=device, dtype=torch.float32), torch.arange(W, device=device, dtype=torch.float32), indexing="ij")
    u = (uu[None] + 0.5 + sub[:, 0, None, None]).reshape(-1)
    v = (vv[None] + 0.5 + sub[:, 1, None, None]).reshape(-1)
    zz = zi[None].expand(4, H, W).reshape(-1)
    cc = col[None].expand(4, H, W, 3).reshape(-1, 3)
    P = (torch.stack([u, v, torch.ones_like(u)], -1) @ Kinv.T) * zz[:, None]
    R_list, C_list = pose(cam, pivot)
    R = torch.tensor(R_list, dtype=torch.float32, device=device)
    C = torch.tensor(C_list, dtype=torch.float32, device=device)
    Pc = (P - C) @ R  # R^T (P - C), row vectors
    zc = Pc[:, 2]
    ok = zc > 1e-3
    uv = Pc[:, :2] / zc.clamp(min=1e-3)[:, None]
    up = K[0, 0] * uv[:, 0] + K[0, 2]
    vp = K[1, 1] * uv[:, 1] + K[1, 2]
    ui, vi = up.floor().long(), vp.floor().long()
    ok &= (ui >= 0) & (ui < W) & (vi >= 0) & (vi < H)
    lin, zc, cc = vi[ok] * W + ui[ok], zc[ok], cc[ok]
    zbuf = torch.full((H * W,), float("inf"), device=device)
    zbuf.scatter_reduce_(0, lin, zc, reduce="amin", include_self=True)
    win = zc <= zbuf[lin] * (1 + 1e-5)
    magenta = torch.tensor(MAGENTA, device=device).view(3, 1, 1)
    frame = magenta.expand(3, H, W).clone()
    frame.view(3, -1)[:, lin[win]] = cc[win].T
    filled = torch.isfinite(zbuf).view(H, W)
    frame, filled = _fill_cracks(frame, filled)
    frame = torch.where(filled[None], frame, magenta)
    return frame.movedim(0, -1).clamp(0, 1).cpu(), (~filled).cpu()
