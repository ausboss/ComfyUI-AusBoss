"""Pause for Shot 🆎: the run waits after the 3D viewer, so you can frame the
shot on the model it just built, then Continue takes the camera as it is now.
Given a 360 picture, it also puts that behind the model in the viewer while
it waits, and hands on the part of the 360 the camera sees (`backdrop`), so
the shot and its background can be treated apart (blur one, not the other).

A plain re-run would rebuild nothing that is still cached, but a camera moved
after Run never reaches the run: the prompt holds the camera from the moment
Run was pressed. This node sits between a Preview 3D (Advanced) viewer and
what renders the shot. While it waits, Continue (on this node, and on the
viewer itself, js/pause_shot/) sends the viewer's camera, model turn and
size through POST /ausboss/pause_shot/answer, and the node hands those on in
place of the ones it was given.

The route takes the id of a node that is waiting right now and the shot as
numbers; it reads and writes no file, and an answer for a node that is not
waiting is refused. GET /ausboss/pause_shot/waiting lists the pauses waiting
now, so a page opened or reloaded during a pause shows it again. Cancel in
ComfyUI's queue ends a pause as well.
"""

from __future__ import annotations

import math
import os
import random
import threading

from ._backdrop_helpers import clean_ground, shadow_alpha, view_backdrop

EVENT_WAIT = "ausboss-pause-shot"
EVENT_DONE = "ausboss-pause-shot-done"
MAX_SIDE = 4096

_waiting: dict[str, dict] = {}
_lock = threading.Lock()

# What each 3D viewer was last told to show. ComfyUI sends a node's result
# only to the page that pressed Run; a pause is seen by every open page, so
# it carries its viewer's result along and any page can show the model.
_viewer_results: dict[str, dict] = {}
MODEL_SUFFIXES = (".glb", ".gltf", ".obj", ".fbx", ".stl", ".usdz", ".ply", ".spz", ".splat", ".ksplat")


def model_result(output) -> bool:
    """True for a viewer result whose first item names a 3D file."""
    if not isinstance(output, dict):
        return False
    result = output.get("result")
    if not isinstance(result, (list, tuple)) or not result or not isinstance(result[0], str):
        return False
    name = result[0].rsplit(" [", 1)[0].lower()
    return name.endswith(MODEL_SUFFIXES)


def remember_result(event, data) -> None:
    if event != "executed" or not isinstance(data, dict):
        return
    output = data.get("output")
    if not model_result(output):
        return
    with _lock:
        for key in {str(data.get("node")), str(data.get("display_node"))} - {"None"}:
            _viewer_results.pop(key, None)
            _viewer_results[key] = output
        while len(_viewer_results) > 64:
            _viewer_results.pop(next(iter(_viewer_results)))


def viewer_of(prompt, node_id: str):
    """The id of the viewer wired into this pause's model_3d_info."""
    try:
        link = prompt[node_id]["inputs"]["model_3d_info"]
    except (KeyError, TypeError):
        return None
    return str(link[0]) if isinstance(link, (list, tuple)) and link else None


def _watch_results(server) -> None:
    send = server.send_sync
    if getattr(send, "_ausboss_pause_shot", False):
        return

    def send_sync(event, data, sid=None):
        try:
            remember_result(event, data)
        except Exception:
            pass
        return send(event, data, sid)

    send_sync._ausboss_pause_shot = True
    server.send_sync = send_sync


def _server():
    try:
        from server import PromptServer
    except Exception:
        return None
    return getattr(PromptServer, "instance", None)


def _send(event: str, data: dict) -> None:
    server = _server()
    if server is not None:
        server.send_sync(event, data, None)


def clean_value(value, depth: int = 0):
    """Keep only what a camera or a model turn is made of: numbers, short
    names, and small lists and objects of those. Anything else is dropped."""
    if depth > 4:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value if len(value) <= 40 else None
    if isinstance(value, list):
        return [item for item in (clean_value(v, depth + 1) for v in value[:16]) if item is not None]
    if isinstance(value, dict):
        out = {}
        for key, item in list(value.items())[:32]:
            if isinstance(key, str) and len(key) <= 40:
                cleaned = clean_value(item, depth + 1)
                if cleaned is not None:
                    out[key] = cleaned
        return out
    return None


def clean_shot(shot) -> dict:
    """The parts of an answer the node uses, checked."""
    if not isinstance(shot, dict):
        return {}
    out = {}
    camera = clean_value(shot.get("camera_info"))
    if isinstance(camera, dict) and isinstance(camera.get("position"), dict):
        out["camera_info"] = camera
    model = clean_value(shot.get("model_3d_info"))
    if isinstance(model, list) and all(isinstance(item, dict) for item in model):
        out["model_3d_info"] = model
    sky = clean_value(shot.get("sky"))
    if isinstance(sky, dict):
        out["sky"] = sky
    ground = clean_ground(shot.get("ground"))
    if ground:
        out["ground"] = ground
    # False when the 360 was taken out of the viewer: the backdrop goes grey.
    if shot.get("panorama") is False:
        out["panorama"] = False
    for key in ("width", "height"):
        side = shot.get(key)
        if isinstance(side, (int, float)) and not isinstance(side, bool) and math.isfinite(side):
            out[key] = max(1, min(MAX_SIDE, int(round(side))))
    return out


def _save_panorama(panorama) -> dict | None:
    """The 360 as a temp picture, for the viewer to show while the run waits."""
    try:
        import folder_paths
        from PIL import Image

        array = (panorama[0].clamp(0, 1).cpu().numpy() * 255).round().astype("uint8")
        temp = folder_paths.get_temp_directory()
        os.makedirs(temp, exist_ok=True)
        name = "ausboss_360_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(8)) + ".png"
        Image.fromarray(array).save(os.path.join(temp, name), compress_level=1)
        return {"filename": name, "subfolder": "", "type": "temp"}
    except Exception:
        return None


def _wait_for_answer(node_id: str, extra: dict | None = None) -> dict:
    import comfy.model_management as mm

    slot = {"event": threading.Event(), "answer": None, "payload": {"node": node_id, **(extra or {})}}
    with _lock:
        _waiting[node_id] = slot
    try:
        _send(EVENT_WAIT, slot["payload"])
        while not slot["event"].wait(0.25):
            mm.throw_exception_if_processing_interrupted()
    finally:
        with _lock:
            if _waiting.get(node_id) is slot:
                del _waiting[node_id]
        _send(EVENT_DONE, {"node": node_id})
    answer = slot["answer"] or {}
    if answer.get("action") == "stop":
        mm.interrupt_current_processing()
        raise mm.InterruptProcessingException()
    return answer


def answer_pause(body) -> tuple[int, dict]:
    """Hand an answer from the node or the viewer to the waiting run."""
    if not isinstance(body, dict):
        return 400, {"error": "Pause for Shot: the answer could not be read."}
    node_id = body.get("node")
    action = body.get("action")
    if not isinstance(node_id, str) or action not in ("continue", "stop"):
        return 400, {"error": "Pause for Shot: the answer needs a node and continue or stop."}
    with _lock:
        slot = _waiting.get(node_id)
        if slot is None:
            return 409, {"error": "That node is not waiting any more."}
        slot["answer"] = {"action": action, "shot": clean_shot(body.get("shot"))}
        slot["event"].set()
    return 200, {"ok": True}


def waiting_pauses() -> list[dict]:
    with _lock:
        return [dict(slot["payload"]) for slot in _waiting.values()]


def register_routes() -> None:
    server = _server()
    if server is None or getattr(server, "_ausboss_pause_shot", False):
        return
    try:
        from aiohttp import web
    except Exception:
        return
    server._ausboss_pause_shot = True
    _watch_results(server)

    @server.routes.post("/ausboss/pause_shot/answer")
    async def pause_shot_answer(request):
        try:
            body = await request.json()
        except Exception:
            body = None
        status, data = answer_pause(body)
        return web.json_response(data, status=status)

    @server.routes.get("/ausboss/pause_shot/waiting")
    async def pause_shot_waiting(_request):
        return web.json_response({"waiting": waiting_pauses()})


class AusBossPauseShot:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Stops the run right after the 3D viewer, so you can frame your shot "
        "on the model it just made. Turn the camera, then press Continue, here "
        "or on the viewer: the run goes on with the shot as you left it, and "
        "nothing before this node runs again. Stop ends the run here. Turn "
        "Pause off to let runs go straight through with the camera as it was "
        "when you pressed Run. Wire a 360 picture into panorama and it shows "
        "behind the model while you frame, and backdrop gives the part of it "
        "the camera sees, with the viewer's ground shadow under the model."
    )
    SEARCH_ALIASES = ["pause", "pause shot", "frame shot", "camera", "3d", "viewer", "continue", "wait", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_3d_info": ("LOAD3D_MODEL_INFO", {"tooltip": "The model's placement, from the viewer."}),
                "camera_info": ("LOAD3D_CAMERA", {"tooltip": "The camera, from the viewer."}),
                "width": ("INT", {"forceInput": True, "tooltip": "The shot's width, from the viewer."}),
                "height": ("INT", {"forceInput": True, "tooltip": "The shot's height, from the viewer."}),
                "pause": ("BOOLEAN", {"default": True, "tooltip": "On: the run waits here while you frame the shot. Off: it goes straight through."}),
            },
            "optional": {
                "panorama": ("IMAGE", {"tooltip": "A 360 picture (twice as wide as tall) to show behind the model and hand on as backdrop."}),
            },
            "hidden": {"unique_id": "UNIQUE_ID", "prompt": "PROMPT"},
        }

    RETURN_TYPES = ("LOAD3D_MODEL_INFO", "LOAD3D_CAMERA", "INT", "INT", "IMAGE")
    RETURN_NAMES = ("model_3d_info", "camera_info", "width", "height", "backdrop")
    OUTPUT_TOOLTIPS = (
        "The model's placement as the viewer shows it when you press Continue.",
        "The camera as the viewer shows it when you press Continue.",
        "The shot's width.",
        "The shot's height.",
        "The part of the 360 the camera sees, at the shot's size, with the viewer's ground shadow. Grey when no 360 is wired in.",
    )
    FUNCTION = "wait"

    @classmethod
    def IS_CHANGED(cls, pause=True, **_kwargs):
        # A pause asks on every run, even when nothing above it changed.
        return float("nan") if pause else 0

    def wait(self, model_3d_info, camera_info, width, height, pause, panorama=None, unique_id=None, prompt=None):
        shot = {}
        if pause and unique_id is not None:
            extra = {}
            viewer = viewer_of(prompt, str(unique_id))
            with _lock:
                shown = _viewer_results.get(viewer) if viewer else None
            if shown:
                extra["viewer"] = {"node": viewer, "output": shown}
            if panorama is not None:
                saved = _save_panorama(panorama)
                if saved:
                    extra["panorama"] = saved
            shot = _wait_for_answer(str(unique_id), extra).get("shot") or {}
        model_3d_info = shot.get("model_3d_info", model_3d_info)
        camera_info = shot.get("camera_info", camera_info)
        width = shot.get("width", width)
        height = shot.get("height", height)
        if shot.get("panorama") is False:
            panorama = None
        backdrop = _backdrop(panorama, camera_info, shot.get("sky"), shot.get("ground"), width, height)
        return (model_3d_info, camera_info, width, height, backdrop)


def _backdrop(panorama, camera_info, sky, ground, width, height):
    """The 360 as the camera sees it (grey without one), with the viewer's
    shadow under the model when its Shadow setting is above 0."""
    import numpy as np
    import torch

    width, height = max(1, int(width)), max(1, int(height))
    camera = camera_info if isinstance(camera_info, dict) else {}
    sky = sky if isinstance(sky, dict) else {}
    if panorama is None:
        view = np.full((height, width, 3), 0.5)
    else:
        view = view_backdrop(panorama[0, :, :, :3].float().cpu().numpy(), camera, sky, width, height)
    shadow = sky.get("shadow")
    if ground and isinstance(shadow, (int, float)) and not isinstance(shadow, bool) and shadow > 0:
        view = view * (1 - shadow_alpha(camera, ground, shadow / 100, width, height))[..., None]
    return torch.from_numpy(view.astype("float32")).unsqueeze(0)


register_routes()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_PauseShot": AusBossPauseShot}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_PauseShot": "Pause for Shot 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
