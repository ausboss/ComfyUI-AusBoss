"""Cut a model to a band of its own depth, as the camera sees it: the 3D
viewer's Cut (js/viewer_pano, Cut tab) and Pause for Shot's mesh output.

Two planes face the camera. Front takes away that share of the model's
depth from the side nearest the camera, Back from the far side, both in
percent. "The model's depth" is how far its box reaches along the camera's
view: the eight corners of the box around the model's own points (before the
viewer moves, turns or sizes it), placed where the viewer shows the model.
The viewer measures the same box, so its cut and this one meet at the same
planes. This keeps the triangles whose middle lies between the planes; the
viewer cuts at the exact plane, so the two edges agree to within a triangle.
"""

from __future__ import annotations

import math

import numpy as np

CUT_KEYS = ("front", "back")
# At least this much of the model's depth stays, so a cut never empties it.
MIN_KEEP = 1.0


def clean_cut(value) -> dict | None:
    """{"front": %, "back": %} from an answer or a saved viewer, or None when
    nothing is cut."""
    if not isinstance(value, dict):
        return None
    out = {}
    for key in CUT_KEYS:
        number = value.get(key)
        ok = isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
        out[key] = min(100.0 - MIN_KEEP, max(0.0, float(number))) if ok else 0.0
    out["back"] = min(out["back"], 100.0 - MIN_KEEP - out["front"])
    return out if out["front"] > 0 or out["back"] > 0 else None


def _vec(data, default=(0.0, 0.0, 0.0)) -> np.ndarray:
    out = list(default)
    if isinstance(data, dict):
        for i, key in enumerate("xyz"):
            value = data.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                out[i] = float(value)
    return np.array(out, dtype=np.float64)


def model_transform(model_3d_info):
    """(scale, rotation, position) of the viewer's model, the way Render Mesh
    places it; None without one."""
    transform = model_3d_info[0] if isinstance(model_3d_info, list) and model_3d_info else model_3d_info
    if not isinstance(transform, dict) or not isinstance(transform.get("quaternion"), dict):
        return None
    q = transform["quaternion"]
    x, y, z, w = (float(q.get(k, 0.0) or 0.0) for k in "xyzw")
    rotation = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    return _vec(transform.get("scale"), (1.0, 1.0, 1.0)), rotation, _vec(transform.get("position"))


def place(points: np.ndarray, transform) -> np.ndarray:
    if transform is None:
        return points
    scale, rotation, position = transform
    return (points * scale) @ rotation.T + position


def camera_view(camera_info):
    """(eye, forward) of a viewer camera; None without a usable one."""
    if not isinstance(camera_info, dict) or not isinstance(camera_info.get("position"), dict):
        return None
    eye = _vec(camera_info["position"])
    if isinstance(camera_info.get("target"), dict):
        forward = _vec(camera_info["target"]) - eye
    elif isinstance(camera_info.get("quaternion"), dict):
        _, rotation, _ = model_transform([{"quaternion": camera_info["quaternion"]}])
        forward = rotation @ np.array([0.0, 0.0, -1.0])
    else:
        return None
    norm = float(np.linalg.norm(forward))
    if norm < 1e-9:
        return None
    return eye, forward / norm


def box_corners(points: np.ndarray) -> np.ndarray:
    lo, hi = points.min(0), points.max(0)
    return np.array([[(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]] for i in (0, 1) for j in (0, 1) for k in (0, 1)])


def cut_planes(points: np.ndarray, transform, view, cut: dict) -> tuple[float, float]:
    """(near, far): the kept band, as distances along the camera's view."""
    eye, forward = view
    depth = (place(box_corners(points), transform) - eye) @ forward
    lo, hi = float(depth.min()), float(depth.max())
    span = hi - lo
    return lo + span * cut["front"] / 100.0, hi - span * cut["back"] / 100.0


def kept_faces(points: np.ndarray, faces: np.ndarray, transform, view, cut: dict) -> np.ndarray:
    """True for each triangle whose middle lies between the cut planes."""
    near, far = cut_planes(points, transform, view, cut)
    eye, forward = view
    depth = (place(points, transform) - eye) @ forward
    middle = depth[faces].mean(1)
    return (middle >= near) & (middle <= far)


def cut_mesh(mesh, model_3d_info, camera_info, cut):
    """The mesh with the cut-away triangles dropped (its points, colours and
    pictures kept). Unchanged when nothing is cut or the cut needs a camera."""
    cut = clean_cut(cut)
    view = camera_view(camera_info)
    if mesh is None or cut is None or view is None:
        return mesh
    import copy

    import torch

    vertices, faces = mesh.vertices, mesh.faces
    if vertices.ndim != 3 or faces.ndim != 3 or vertices.shape[0] != 1:
        return mesh  # one model at a time, as Render Mesh draws
    n = int(mesh.vertex_counts[0]) if getattr(mesh, "vertex_counts", None) is not None else vertices.shape[1]
    m = int(mesh.face_counts[0]) if getattr(mesh, "face_counts", None) is not None else faces.shape[1]
    points = vertices[0, :n].detach().float().cpu().numpy().astype(np.float64)
    tris = faces[0, :m].detach().cpu().numpy().astype(np.int64)
    if points.size == 0 or tris.size == 0:
        return mesh
    keep = kept_faces(points, tris, model_transform(model_3d_info), view, cut)
    if keep.all() or not keep.any():
        return mesh
    out = copy.copy(mesh)
    kept = faces[0, :m][torch.from_numpy(keep).to(faces.device)]
    out.faces = kept.unsqueeze(0)
    if getattr(mesh, "face_counts", None) is not None:
        out.face_counts = torch.tensor([kept.shape[0]], dtype=mesh.face_counts.dtype, device=mesh.face_counts.device)
    return out
