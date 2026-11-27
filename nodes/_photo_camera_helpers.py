"""The camera a photo was taken with, in the frame a pixel-aligned 3D build
(Pixal3D) puts its model in, and where the photo sits on a 360 canvas.

Pixal3D builds the model from a square crop around the subject (Crop to Mask)
and a horizontal field of view for that crop. Its model comes out Y-up, the
crop's camera on +Z looking down -Z at the origin, and the crop's frame
spanning x and y from -0.5 to 0.5 on the z = 0 plane. So the crop's camera
stands at distance 0.5 / tan(crop_fov / 2).

The whole photo was taken from the same point. Its centre lies off the crop's
axis by the crop's offset in the photo, so the photo's camera is the crop's
camera turned towards the photo's centre (no roll), with the photo's own
field of view. A sensor shift is what really happened; a turn is what the
3D viewer and Render Mesh can show, and for the few degrees a subject sits
off centre the two agree to within a few pixels.

The 360 canvas is an equirectangular picture in which the photo is laid flat
at its own width in degrees. Its centre column faces the way the viewer's
front camera looks once the 360 is turned 90 degrees (BACKDROP_TURN), so the
photo goes where the camera's axis meets the canvas.
"""

from __future__ import annotations

import math

# The 360's Turn that puts the canvas's centre column behind the model as the
# viewer's front camera sees it (three.js samples a background at
# u = atan2(z, x) / 2pi + 0.5, so the centre faces +X until turned).
BACKDROP_TURN = 90.0


def subject_box(mask, pad_factor: float = 1.1, max_side: int = 1024) -> tuple[tuple[float, float, float, float], tuple[int, int]]:
    """The square Crop to Mask cuts around the subject, in the photo's pixels.

    mask: H x W numbers from 0 to 1 (the subject white). Returns
    ((x1, y1, x2, y2), (W, H)) at the size Crop to Mask measures at, which is
    the photo scaled down so its longest side is at most max_side.
    """
    import numpy as np

    m = np.asarray(mask, dtype=np.float64)
    h, w = m.shape
    border = np.concatenate([m[0, :], m[-1, :], m[:, 0], m[:, -1]])
    centre = m[h // 4:h - h // 4, w // 4:w - w // 4]
    if border.mean() > 0.5 and centre.mean() < 0.5:
        m = 1.0 - m
    scale = 1.0
    if max(h, w) > max_side:
        scale = max_side / max(h, w)
    W, H = (int(w * scale), int(h * scale)) if scale != 1.0 else (w, h)
    ys, xs = np.nonzero(m > 0.8)
    if xs.size == 0:
        return (0.0, 0.0, float(W), float(H)), (W, H)
    # Measured on the full-size mask and scaled, which agrees with a box
    # measured on the scaled mask to about a pixel.
    x0, x1 = xs.min() * scale, (xs.max() + 1) * scale - 1
    y0, y1 = ys.min() * scale, (ys.max() + 1) * scale - 1
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    side = int(max(x1 - x0 + 1, y1 - y0 + 1) * pad_factor)
    half = math.ceil(side / 2)
    left, top = int(cx - half), int(cy - half)
    return (float(left), float(top), float(left + 2 * half), float(top + 2 * half)), (W, H)


def look_quaternion(eye, target) -> dict:
    """three.js camera quaternion (x, y, z, w) looking from eye to target,
    +Y up, no roll: a turn about Y, then a tip about X."""
    dx, dy, dz = (e - t for e, t in zip(eye, target))
    yaw = math.atan2(dx, dz)
    pitch = -math.atan2(dy, math.hypot(dx, dz))
    cy, sy, cp, sp = math.cos(yaw / 2), math.sin(yaw / 2), math.cos(pitch / 2), math.sin(pitch / 2)
    return {"x": cy * sp, "y": sy * cp, "z": -sy * sp, "w": cy * cp}


def photo_camera(box, size, fov: float, canvas_width: int = 2048) -> dict:
    """Everything that follows from the crop and the photo's horizontal field
    of view (degrees): the crop's field of view for Pixal3D, the photo's
    camera for the viewer, and the photo's place on the 360 canvas."""
    x1, y1, x2, y2 = (float(v) for v in box)
    W, H = int(size[0]), int(size[1])
    fov = min(170.0, max(1.0, float(fov)))
    focal = (W / 2.0) / math.tan(math.radians(fov) / 2.0)
    side = max(1.0, x2 - x1)
    crop_fov = math.degrees(2.0 * math.atan((side / 2.0) / focal))
    distance = 0.5 / math.tan(math.radians(crop_fov) / 2.0)

    # The photo's centre, seen from the crop's camera (x right, y up, -z ahead).
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    dx = (W / 2.0 - cx) / focal
    dy = (cy - H / 2.0) / focal
    norm = math.sqrt(dx * dx + dy * dy + 1.0)
    eye = (0.0, 0.0, distance)
    target = (dx / norm * distance, dy / norm * distance, distance - distance / norm)
    vfov = math.degrees(2.0 * math.atan((H / 2.0) / focal))
    xyz = lambda v: {"x": float(v[0]), "y": float(v[1]), "z": float(v[2])}
    camera = {
        "position": xyz(eye), "target": xyz(target), "quaternion": look_quaternion(eye, target),
        "fov": vfov, "aspect": W / max(1, H), "zoom": 1, "cameraType": "perspective",
        "near": 0.01, "far": 10000, "frustum": {"left": -5, "right": 5, "top": 5, "bottom": -5},
    }

    # The photo on the 360 canvas: its centre where the camera's axis meets it.
    canvas_width = max(8, int(canvas_width))
    canvas_height = canvas_width // 2
    yaw = math.atan2(dx, 1.0)
    pitch = math.atan2(dy, math.hypot(dx, 1.0))
    strip_width = max(1, round(canvas_width * fov / 360.0))
    strip_height = max(1, round(strip_width * H / max(1, W)))
    centre_x = (0.5 + yaw / (2 * math.pi)) * canvas_width
    centre_y = (0.5 - pitch / math.pi) * canvas_height
    return {
        "crop_fov": crop_fov,
        "camera_info": camera,
        "strip_width": int(strip_width),
        "strip_x": int(round(centre_x - strip_width / 2.0)),
        "strip_y": int(round(centre_y - strip_height / 2.0)),
        "distance": distance,
    }
