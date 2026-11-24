"""Your own photo behind the model, lined up with it: the backdrop Pause for
Shot makes from the photo with the person taken out and the camera that took
it (Photo Camera's camera_info).

The photo is laid on a simple stage around the camera that took it: a flat
floor at the model's feet, and everything else far away. Each pixel of the
shot is a ray, cast the way Render Mesh casts it (from the camera's position
towards its target, +Y up, no roll, the field of view narrowed by zoom).
Where the ray meets the floor, or else far away in its direction, that point
is looked up in the photo through the photo's own camera.

Seen from the photo's own camera this gives the photo back exactly, and a
zoom stays exact. Turned away from it, she still stands on the photo's floor
instead of floating over a 360 that is infinitely far away. What the photo
never saw (behind its camera, or past its edges) comes from the 360 when one
is given, painted around the same camera, or else from the photo's nearest
edge, fading into a soft blur of it a little way out, so a turn past the
photo shows a soft backdrop to paint into rather than stretched streaks.

The same stage with the 360 alone ("360 floor") lays the 360's lower half on
that floor, the way a grounded sky dome does.

How far away "far away" is comes from the viewer's Size: the stage is a dome
around the photo's camera with that floor cut across it, Size camera heights
across from its middle to its wall. A small dome is a room: its walls shift
behind her as the camera moves round, as a room's walls would. Size 0 keeps
the wall endlessly far, like a sky.
"""

from __future__ import annotations

import math

import numpy as np

from ._backdrop_helpers import DEG, _number, euler_zxy_matrix

BACKGROUNDS = ("photo", "360", "360 floor")


def _vec(data, default) -> np.ndarray:
    if not isinstance(data, dict):
        return np.array(default, dtype=np.float64)
    return np.array([_number(data.get(k), d) for k, d in zip("xyz", default)], dtype=np.float64)


def camera_frame(camera: dict):
    """(eye, right, up, forward, tan of half the vertical view) of a camera,
    as Render Mesh reads it; None without a usable one."""
    if not isinstance(camera, dict) or not isinstance(camera.get("position"), dict):
        return None
    eye = _vec(camera.get("position"), (0.0, 0.0, 5.0))
    target = _vec(camera.get("target"), (0.0, 0.0, 0.0))
    forward = target - eye
    if np.linalg.norm(forward) < 1e-9:
        return None
    forward /= np.linalg.norm(forward)
    up = np.array([0.0, 1.0, 0.0]) if abs(forward[1]) < 0.99 else np.array([0.0, 0.0, 1.0])
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    fov = min(170.0, max(1.0, _number(camera.get("fov"), 40.0) or 40.0))
    zoom = max(1e-3, _number(camera.get("zoom"), 1.0) or 1.0)
    return eye, right, up, forward, math.tan(fov * DEG / 2) / zoom


def shot_rays(frame, width: int, height: int) -> np.ndarray:
    """height x width x 3: one ray per pixel (not normalised)."""
    _, right, up, forward, tn = frame
    xs = (np.arange(width) + 0.5) / width * 2 - 1
    ys = 1 - (np.arange(height) + 0.5) / height * 2
    gx, gy = np.meshgrid(xs, ys)
    return (right * (gx * tn * (width / max(1, height)))[..., None]
            + up * (gy * tn)[..., None] + forward)


def project(frame, vectors: np.ndarray, width: int, height: int):
    """Where vectors (from the camera's eye) land in that camera's picture:
    (column, row, in front) with pixel centres at whole numbers."""
    _, right, up, forward, tn = frame
    z = vectors @ forward
    front = z > 1e-9
    z = np.where(front, z, 1.0)
    nx = (vectors @ right) / (z * tn * (width / max(1, height)))
    ny = (vectors @ up) / (z * tn)
    return (nx + 1) / 2 * width - 0.5, (1 - ny) / 2 * height - 0.5, front


def bilinear(picture: np.ndarray, col: np.ndarray, row: np.ndarray) -> np.ndarray:
    h, w = picture.shape[:2]
    col = np.clip(col, 0, w - 1)
    row = np.clip(row, 0, h - 1)
    c0 = np.floor(col).astype(np.int64)
    r0 = np.floor(row).astype(np.int64)
    c1 = np.minimum(c0 + 1, w - 1)
    r1 = np.minimum(r0 + 1, h - 1)
    fc = (col - c0)[..., None]
    fr = (row - r0)[..., None]
    top = picture[r0, c0] * (1 - fc) + picture[r0, c1] * fc
    bottom = picture[r1, c0] * (1 - fc) + picture[r1, c1] * fc
    return top * (1 - fr) + bottom * fr


def panorama_lookup(panorama: np.ndarray, directions: np.ndarray, sky: dict) -> np.ndarray:
    """The 360's colour in each world direction, turned by its Turn, Tilt and
    Roll the way the viewer turns it (js/viewer_pano, _backdrop_helpers)."""
    sky = sky if isinstance(sky, dict) else {}
    rotation = euler_zxy_matrix(_number(sky.get("tilt"), 0) * DEG, _number(sky.get("turn"), 0) * DEG,
                                _number(sky.get("roll"), 0) * DEG).T
    world = directions @ rotation.T
    world = world / np.maximum(np.linalg.norm(world, axis=-1, keepdims=True), 1e-12)
    ph, pw = panorama.shape[:2]
    u = np.arctan2(world[..., 2], world[..., 0]) / (2 * math.pi) + 0.5
    v = np.arcsin(np.clip(world[..., 1], -1, 1)) / math.pi + 0.5
    px = u * pw - 0.5
    py = (1 - v) * ph - 0.5
    x0 = np.floor(px).astype(np.int64)
    fx = (px - x0)[..., None]
    x1 = (x0 + 1) % pw
    x0 %= pw
    y0 = np.clip(np.floor(py).astype(np.int64), 0, ph - 1)
    y1 = np.clip(y0 + 1, 0, ph - 1)
    fy = np.clip(py - np.floor(py), 0, 1)[..., None]
    top = panorama[y0, x0] * (1 - fx) + panorama[y0, x1] * fx
    bottom = panorama[y1, x0] * (1 - fx) + panorama[y1, x1] * fx
    return np.clip((top * (1 - fy) + bottom * fy) * (_number(sky.get("bright"), 100) / 100), 0, 1)


# How far past the photo's edge (a share of its width) the sharp edge has
# faded into the blur, and how much the blur shrinks the photo first. The
# viewer does the same with the texture's smallest pictures (photo_stage.mjs).
EDGE_FADE = 0.12
BLUR_SHRINK = 48


def edge_fill(plate: np.ndarray, col: np.ndarray, row: np.ndarray, sharp: np.ndarray) -> np.ndarray:
    """Past the photo's edges: its nearest edge, fading into a soft blur."""
    h, w = plate.shape[:2]
    sh, sw = max(1, h // BLUR_SHRINK), max(1, w // BLUR_SHRINK)
    small = plate[: sh * BLUR_SHRINK, : sw * BLUR_SHRINK].reshape(sh, BLUR_SHRINK, sw, BLUR_SHRINK, -1).mean((1, 3)) \
        if h >= BLUR_SHRINK and w >= BLUR_SHRINK else plate.reshape(1, 1, -1, plate.shape[-1]).mean((0, 1, 2))[None, None]
    blur = bilinear(small, (col + 0.5) / w * small.shape[1] - 0.5, (row + 0.5) / h * small.shape[0] - 0.5)
    u = (col + 0.5) / w
    v = (row + 0.5) / h
    out = np.maximum(np.maximum(-u, u - 1), np.maximum(-v, v - 1) * h / w)
    t = np.clip(out / EDGE_FADE, 0, 1)[..., None]
    return sharp * (1 - t) + blur * t


SIZE_MIN = 1.5
SIZE_MAX = 1000.0


def dome_radius(size, eye_y: float, floor_y: float | None) -> float:
    """The dome's radius from the viewer's Size (camera heights); 0 for an
    endless one. A dome smaller than SIZE_MIN would barely reach the floor."""
    if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or size <= 0:
        return 0.0
    if floor_y is None or not math.isfinite(floor_y) or eye_y <= floor_y:
        return 0.0
    return min(SIZE_MAX, max(SIZE_MIN, float(size))) * (eye_y - floor_y)


def stage_points(shot_camera: dict, photo_camera: dict, floor_y: float | None, width: int, height: int,
                 size=0):
    """Where each pixel of the shot lands on the stage, as seen from the
    photo's camera: (photo frame, vectors from the photo's eye, on_floor).
    A vector is a point (on the floor or the dome's wall) or, where the dome
    is endless, a direction; either looks up the same way."""
    shot = camera_frame(shot_camera)
    photo = camera_frame(photo_camera)
    if shot is None or photo is None:
        return None
    eye = shot[0]
    rays = shot_rays(shot, width, height)
    direction = rays / np.linalg.norm(rays, axis=-1, keepdims=True)
    vectors = direction.copy()
    radius = dome_radius(size, photo[0][1], floor_y)
    if radius > 0:
        # Where the ray leaves the dome (the far side when the camera is outside it).
        rel = eye - photo[0]
        b = direction @ rel
        disc = b * b - (rel @ rel - radius * radius)
        exit_t = -b + np.sqrt(np.maximum(disc, 0.0))
        wall = (disc >= 0) & (exit_t > 0)
        vectors = np.where(wall[..., None], rel + direction * exit_t[..., None], vectors)
    on_floor = np.zeros(rays.shape[:2], dtype=bool)
    if floor_y is not None and math.isfinite(floor_y) and eye[1] > floor_y:
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (floor_y - eye[1]) / direction[..., 1]
        on_floor = np.isfinite(t) & (t > 0)
        hits = eye + direction * np.where(on_floor, t, 0.0)[..., None] - photo[0]
        if radius > 0:
            on_floor &= np.einsum("...i,...i->...", hits, hits) <= radius * radius
        vectors = np.where(on_floor[..., None], hits, vectors)
    return photo, vectors, on_floor


def stage_backdrop(plate: np.ndarray | None, photo_camera: dict, shot_camera: dict, floor_y: float | None,
                   width: int, height: int, panorama: np.ndarray | None = None, sky: dict | None = None,
                   use_photo: bool = True) -> np.ndarray | None:
    """height x width x 3 floats: the stage as the shot's camera sees it.
    plate: H x W x 3, the photo with the person taken out. With use_photo off
    (or no plate) the 360 alone covers the stage ("360 floor")."""
    found = stage_points(shot_camera, photo_camera, floor_y, int(width), int(height), (sky or {}).get("size"))
    if found is None:
        return None
    photo, vectors, _ = found
    width, height = int(width), int(height)
    have_360 = panorama is not None
    if not use_photo or plate is None:
        if not have_360:
            return None
        return panorama_lookup(panorama, vectors, sky or {})
    ph, pw = plate.shape[:2]
    col, row, front = project(photo, vectors, pw, ph)
    inside = front & (col >= -0.5) & (col <= pw - 0.5) & (row >= -0.5) & (row <= ph - 0.5)
    picture = bilinear(plate, col, row)
    if have_360:
        fill = panorama_lookup(panorama, vectors, sky or {})
    else:
        # The photo's nearest edge in front of its camera, its average colour behind it.
        fill = np.where(front[..., None], edge_fill(plate, col, row, picture), plate.reshape(-1, plate.shape[-1]).mean(0))
    return np.clip(np.where(inside[..., None], picture, fill), 0, 1)


def ground_patch(points: np.ndarray) -> dict | None:
    """The floor patch under the model, measured the way the viewer measures
    it (groundPatch in js/viewer_pano): the floor at the lowest point, the
    patch around the bottom tenth of the model."""
    if points.size == 0:
        return None
    low, high = float(points[:, 1].min()), float(points[:, 1].max())
    tall = max(high - low, 1e-6)
    foot = points[points[:, 1] <= low + tall * 0.1]
    x0, x1 = float(foot[:, 0].min()), float(foot[:, 0].max())
    z0, z1 = float(foot[:, 2].min()), float(foot[:, 2].max())
    margin = tall * 0.08
    return {"y": low, "cx": (x0 + x1) / 2, "cz": (z0 + z1) / 2,
            "rx": (x1 - x0) / 2 * 1.2 + margin, "rz": (z1 - z0) / 2 * 1.2 + margin}


def mesh_ground(mesh, model_3d_info) -> dict | None:
    """The floor patch under the model as the viewer places it: where the
    stage's floor goes, so she stands on it, and where her shadow falls."""
    if mesh is None:
        return None
    from ._mesh_cut_helpers import model_transform, place

    vertices = getattr(mesh, "vertices", None)
    if vertices is None or vertices.ndim != 3 or vertices.shape[0] < 1:
        return None
    counts = getattr(mesh, "vertex_counts", None)
    n = int(counts[0]) if counts is not None else vertices.shape[1]
    points = vertices[0, :n].detach().float().cpu().numpy().astype(np.float64)
    return ground_patch(place(points, model_transform(model_3d_info)))
