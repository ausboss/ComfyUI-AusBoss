"""The 360 behind the model, as the 3D viewer's camera sees it.

Pause for Shot hands this on so the run gets the same backdrop the viewer
showed. The maths follows three.js, which draws the viewer: a camera looks
down its -Z axis with +Y up, turned by its quaternion; the 360's own Turn,
Tilt and Roll (js/viewer_pano) turn each view direction by the inverse
(transpose) of their ZXY rotation, as three's background shader does (the
negated angles only agree while one angle is set); and a direction finds its pixel in the
equirectangular picture by u = atan2(z, x) / 2pi + 0.5 and
v = asin(y) / pi + 0.5, with v = 1 at the picture's top row.
"""

from __future__ import annotations

import math

import numpy as np

DEG = math.pi / 180


def quaternion_matrix(q) -> np.ndarray:
    x, y, z, w = (float(v) for v in q)
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def euler_zxy_matrix(x: float, y: float, z: float) -> np.ndarray:
    """three.js Matrix4.makeRotationFromEuler for order 'ZXY'."""
    a, b = math.cos(x), math.sin(x)
    c, d = math.cos(y), math.sin(y)
    e, f = math.cos(z), math.sin(z)
    ce, cf, de, df = c * e, c * f, d * e, d * f
    return np.array([
        [ce - df * b, -a * f, de + cf * b],
        [cf + de * b, a * e, df - ce * b],
        [-a * d, b, a * c],
    ])


def _number(value, default: float) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else default


def view_backdrop(panorama: np.ndarray, camera: dict, sky: dict, width: int, height: int) -> np.ndarray:
    """panorama: H x W x 3 float equirectangular picture. Returns height x
    width x 3: the 360 as the viewer's camera saw it."""
    sky = sky if isinstance(sky, dict) else {}
    camera = camera if isinstance(camera, dict) else {}
    quaternion = camera.get("quaternion") or {}
    turn = [quaternion.get(k, 0.0 if k != "w" else 1.0) for k in ("x", "y", "z", "w")]
    view = sky.get("view")
    if sky.get("orbit") == "fixed":
        turn = view if isinstance(view, list) and len(view) == 4 else [0.0, 0.0, 0.0, 1.0]
    fov = _number(sky.get("fov"), _number(camera.get("fov"), 35.0))
    fov = min(170.0, max(1.0, fov))

    aspect = width / max(1, height)
    half = math.tan(fov * DEG / 2)
    xs = ((np.arange(width) + 0.5) / width * 2 - 1) * half * aspect
    ys = (1 - (np.arange(height) + 0.5) / height * 2) * half
    gx, gy = np.meshgrid(xs, ys)
    directions = np.stack([gx, gy, -np.ones_like(gx)], -1)
    directions /= np.linalg.norm(directions, axis=-1, keepdims=True)

    rotation = euler_zxy_matrix(_number(sky.get("tilt"), 0) * DEG, _number(sky.get("turn"), 0) * DEG, _number(sky.get("roll"), 0) * DEG).T
    world = directions @ (rotation @ quaternion_matrix(turn)).T

    ph, pw = panorama.shape[:2]
    u = np.arctan2(world[..., 2], world[..., 0]) / (2 * math.pi) + 0.5
    v = np.arcsin(np.clip(world[..., 1], -1, 1)) / math.pi + 0.5
    px = u * pw - 0.5
    py = (1 - v) * ph - 0.5
    x0 = np.floor(px).astype(np.int64)
    y0 = np.clip(np.floor(py).astype(np.int64), 0, ph - 1)
    y1 = np.clip(y0 + 1, 0, ph - 1)
    fx = (px - x0)[..., None]
    fy = np.clip(py - y0, 0, 1)[..., None]
    x1 = (x0 + 1) % pw
    x0 %= pw
    top = panorama[y0, x0] * (1 - fx) + panorama[y0, x1] * fx
    bottom = panorama[y1, x0] * (1 - fx) + panorama[y1, x1] * fx
    picture = top * (1 - fy) + bottom * fy
    return np.clip(picture * (_number(sky.get("bright"), 100) / 100), 0, 1)


def shadow_falloff(distance: np.ndarray) -> np.ndarray:
    """How dark the shadow is at a distance from its middle, where 1 is its
    edge. The viewer draws the same curve (js/viewer_pano, SHADOW_RINGS)."""
    inside = np.clip(1.0 - distance * distance, 0.0, 1.0)
    return inside * inside


def clean_ground(ground) -> dict | None:
    """The patch of floor under the model, as the viewer measured it: the
    floor's height `y`, the middle `cx`, `cz` and the half sizes `rx`, `rz`."""
    if not isinstance(ground, dict):
        return None
    values = {key: _number(ground.get(key), math.nan) for key in ("y", "cx", "cz", "rx", "rz")}
    if not all(math.isfinite(v) for v in values.values()) or values["rx"] <= 0 or values["rz"] <= 0:
        return None
    return values


def shadow_alpha(camera: dict, ground, strength: float, width: int, height: int) -> np.ndarray:
    """height x width, 0 to 1: how much a soft shadow on the floor under the
    model darkens each pixel of the shot. The rays are the ones Render Mesh
    casts for the same camera: from its position towards its target, +Y up,
    no roll, its field of view narrowed by its zoom."""
    ground = clean_ground(ground)
    strength = min(1.0, max(0.0, float(strength)))
    alpha = np.zeros((height, width), dtype=np.float64)
    if ground is None or strength <= 0 or not isinstance(camera, dict):
        return alpha

    def vector(data, default):
        if not isinstance(data, dict):
            return default
        return np.array([_number(data.get(k), d) for k, d in zip("xyz", default)])

    eye = vector(camera.get("position"), np.array([0.0, 0.0, 5.0]))
    target = vector(camera.get("target"), np.array([0.0, 0.0, 0.0]))
    if eye[1] <= ground["y"]:
        # Under the floor: no shadow, as in the viewer.
        return alpha
    forward = target - eye
    if np.linalg.norm(forward) < 1e-9:
        return alpha
    forward /= np.linalg.norm(forward)
    up = np.array([0.0, 1.0, 0.0]) if abs(forward[1]) < 0.99 else np.array([0.0, 0.0, 1.0])
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    fov = min(170.0, max(1.0, _number(camera.get("fov"), 40.0) or 40.0))
    zoom = max(1e-3, _number(camera.get("zoom"), 1.0) or 1.0)
    tn = math.tan(fov * DEG / 2) / zoom

    xs = (np.arange(width) + 0.5) / width * 2 - 1
    ys = 1 - (np.arange(height) + 0.5) / height * 2
    gx, gy = np.meshgrid(xs, ys)
    rays = right * (gx * tn * (width / max(1, height)))[..., None] + up * (gy * tn)[..., None] + forward
    dy = rays[..., 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (ground["y"] - eye[1]) / dy
    hit = np.isfinite(t) & (t > 0)
    t = np.where(hit, t, 0.0)
    px = eye[0] + rays[..., 0] * t
    pz = eye[2] + rays[..., 2] * t
    distance = np.sqrt(((px - ground["cx"]) / ground["rx"]) ** 2 + ((pz - ground["cz"]) / ground["rz"]) ** 2)
    return np.where(hit, shadow_falloff(distance) * strength, 0.0)
