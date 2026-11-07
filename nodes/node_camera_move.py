"""Camera Move 🆎: move the camera of a clip, steered with keys on the node."""

from __future__ import annotations

from pathlib import Path

from ._camera_move_helpers import (
    camera_at,
    default_camera_text,
    frame_moments,
    pack_depth,
    parse_camera,
    prepare_geometry,
    range_report,
    resolve_pivot,
    auto_pivot,
    scene_frame_indices,
    scene_size,
    warp_frame,
)

UI_KEY = "ausboss_camera_scene"


def _device():
    try:
        import comfy.model_management as mm

        return mm.get_torch_device()
    except Exception:
        import torch

        return torch.device("cuda" if torch.cuda.is_available() else "cpu")


class AusBossCameraMove:
    CATEGORY = "🆎 AusBoss/Video"
    DESCRIPTION = (
        "Moves the camera of your clip. Steer it on the node: drag the picture "
        "to turn, pinch or scroll to pull back, and set keys on the time bar. "
        "Places the old camera never saw come out pink, ready for the "
        "CrossView-Warp LoRA to paint in. Needs depth from MoGe Inference."
    )
    SEARCH_ALIASES = [
        "camera move",
        "move camera",
        "orbit camera",
        "camera orbit video",
        "crossview warp",
        "novel view",
        "dolly",
        "camera keyframes",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "moge_geometry": (
                    "MOGE_GEOMETRY",
                    {"tooltip": "Depth of your clip from MoGe Inference. Every frame needs it."},
                ),
                "camera": (
                    "STRING",
                    {
                        "default": default_camera_text(),
                        "multiline": False,
                        "tooltip": "The camera keys. Set them on the node's picture; you never type here.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("guide", "holes")
    OUTPUT_TOOLTIPS = (
        "Your clip seen from the moved camera. Pink is what the old camera never saw.",
        "White where the guide is pink: the parts to paint in.",
    )
    OUTPUT_NODE = True
    FUNCTION = "run"

    def run(self, moge_geometry, camera):
        import torch

        parsed = parse_camera(camera)
        if parsed["fallback"]:
            print("[AusBoss] Camera Move: could not read the camera keys, using the default move.")
        report = range_report(parsed["keys"])
        if report:
            print("[AusBoss] " + report)
        scene = prepare_geometry(moge_geometry)
        pivot = resolve_pivot(scene, parsed["pivot"])
        device = _device()
        try:
            import comfy.utils

            bar = comfy.utils.ProgressBar(scene["count"])
        except Exception:
            bar = None
        frames, holes = [], []
        with torch.no_grad():
            for i, t in enumerate(frame_moments(scene["count"])):
                frame, hole = warp_frame(scene, i, camera_at(parsed["keys"], t), pivot, device)
                frames.append(frame)
                holes.append(hole)
                if bar is not None:
                    bar.update(1)
        guide = torch.stack(frames)
        mask = torch.stack(holes).float()
        info = self._scene(scene, pivot)
        info["pivot_from"] = parsed["pivot"]
        return {"ui": {UI_KEY: [info]}, "result": (guide, mask)}

    # -- what the node's face looks at ----------------------------------------

    def _scene(self, scene, pivot):
        """A few frames, small, with their depth, written to ComfyUI's temp folder."""
        import folder_paths
        import numpy as np
        from PIL import Image

        W, H, count = scene["width"], scene["height"], scene["count"]
        w, h = scene_size(W, H)
        ys = np.clip(((np.arange(h) + 0.5) * H / h).astype(int), 0, H - 1)
        xs = np.clip(((np.arange(w) + 0.5) * W / w).astype(int), 0, W - 1)
        picks = scene_frame_indices(count)
        small = []
        for i in picks:
            z = scene["z"][i].cpu().numpy()[ys][:, xs]
            valid = scene["valid"][i].cpu().numpy()[ys][:, xs]
            small.append((i, z, valid))
        every = np.concatenate([z[v] for _, z, v in small if v.any()]) if any(v.any() for _, _, v in small) else np.array([1.0])
        zmin, zmax = float(every.min()), float(max(every.max(), every.min() * 1.001))
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
            "ausboss_camera_move", folder_paths.get_temp_directory(), w, h
        )
        frames = []
        for j, (i, z, valid) in enumerate(small):
            colour = (scene["image"][i].cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
            stem = f"{name}_{counter:05}_{j:02}"
            Image.fromarray(colour).resize((w, h), Image.LANCZOS).save(Path(folder) / f"{stem}_c.jpg", quality=88)
            Image.fromarray(pack_depth(z, valid, zmin, zmax)).save(Path(folder) / f"{stem}_d.png", compress_level=1)
            K = scene["K"][i]
            frames.append({
                "i": i,
                "t": i / (count - 1) if count > 1 else 0.0,
                "color": {"filename": f"{stem}_c.jpg", "subfolder": subfolder, "type": "temp"},
                "depth": {"filename": f"{stem}_d.png", "subfolder": subfolder, "type": "temp"},
                "fx": float(K[0, 0]) * w / W,
                "fy": float(K[1, 1]) * h / H,
                "cx": float(K[0, 2]) * w / W,
                "cy": float(K[1, 2]) * h / H,
            })
        return {
            "w": w,
            "h": h,
            "count": count,
            "zmin": zmin,
            "zmax": zmax,
            "far": scene["far"],
            "pivot": [float(x) for x in pivot],
            "pivot_auto": [float(x) for x in auto_pivot(scene)],
            "frames": frames,
        }


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_CameraMove": AusBossCameraMove}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_CameraMove": "Camera Move 🆎"}
