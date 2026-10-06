"""Image Folder 🆎 — pick a folder, pick its pictures, run the workflow on each."""

from __future__ import annotations

from pathlib import Path

from ._image_folder_helpers import (
    AFTER_RUN,
    AT_THE_END,
    IMAGE_EXTENSIONS,
    MAX_PICTURES,
    NO_PICTURES,
    RUNS,
    SORTS,
    SOURCES,
    choose,
    clean_folder,
    fingerprint,
    list_folders,
    list_pictures,
    load_picture,
    output_name,
    parse_picked,
    shown_folder,
    thumbnail,
    which,
)

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None

# What the frontend reads to show "7 of 42" on the node after a run.
UI_KEY = "ausboss_image_folder"


def _root(source: str) -> Path:
    """ComfyUI's input or output folder. Nothing else is ever a root."""
    if source not in SOURCES:
        raise ValueError(f"Image Folder: From must be one of {SOURCES}, not '{source}'.")
    if folder_paths is None:
        raise RuntimeError("Image Folder needs ComfyUI's folders.")
    getter = folder_paths.get_output_directory if source == "output" else folder_paths.get_input_directory
    return Path(getter()).resolve()


def _picked(source, folder, subfolders, sort, pictures) -> list[dict]:
    listed = list_pictures(_root(str(source)), folder, bool(subfolders), str(sort), str(source))
    if not listed:
        raise ValueError(NO_PICTURES.format(folder=shown_folder(folder, str(source))))
    return choose(listed, parse_picked(pictures))


def _register_routes() -> None:
    """The gallery's three questions: which folders, which pictures, and a
    small copy of one. Every path is attacker-controlled; each is resolved
    below ComfyUI's input or output folder, and anything else answers 400."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    if getattr(PromptServer.instance, "_ausboss_image_folder_routes", False):
        return
    PromptServer.instance._ausboss_image_folder_routes = True
    routes = PromptServer.instance.routes

    def query(request, name: str) -> str:
        return str(request.rel_url.query.get(name, "")).strip()

    def refused(error: Exception):
        return web.json_response({"error": str(error)}, status=400)

    @routes.get("/ausboss/image_folder/folders")
    async def folders(request):
        source = query(request, "source") or "input"
        try:
            shown = clean_folder(query(request, "folder"))
            names = list_folders(_root(source), shown, source)
        except (ValueError, RuntimeError) as error:
            return refused(error)
        return web.json_response({"source": source, "folder": shown, "folders": names})

    @routes.get("/ausboss/image_folder/list")
    async def pictures(request):
        source = query(request, "source") or "input"
        try:
            shown = clean_folder(query(request, "folder"))
            listed = list_pictures(
                _root(source), shown, query(request, "subfolders") == "1", query(request, "sort") or "name", source
            )
        except (ValueError, RuntimeError) as error:
            return refused(error)
        return web.json_response({
            "source": source,
            "folder": shown,
            "full": len(listed) >= MAX_PICTURES,
            "pictures": [{"name": item["name"], "v": int(item["mtime"])} for item in listed],
        })

    @routes.get("/ausboss/image_folder/thumb")
    async def thumb(request):
        source = query(request, "source") or "input"
        name = query(request, "name").replace("\\", "/")
        try:
            root = _root(source)
            base = clean_folder(query(request, "folder"))
            # The name is a path below the folder; it goes through the same door.
            relative = clean_folder(f"{base}/{name}" if base else name)
            path = root.joinpath(*relative.split("/")).resolve()
            if root not in path.parents or not path.is_file() or not path.name.lower().endswith(IMAGE_EXTENSIONS):
                return web.json_response({"error": "no such picture"}, status=404)
            try:
                edge = int(query(request, "size") or 160)
            except ValueError:
                edge = 160
            data = thumbnail(path, edge)
        except (ValueError, RuntimeError) as error:
            return refused(error)
        except Exception:
            return web.json_response({"error": "this picture cannot be shown"}, status=415)
        return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


_register_routes()


class AusBossImageFolder:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Pick a folder, tick the pictures you want, and run the workflow on "
        "each of them. All in one run does every picked picture with one "
        "press of Run. One per run loads one picture each run and steps to "
        "the next by itself, so one that fails only skips itself. It gives "
        "each picture's mask, its file name for saving the result under the "
        "same name, its number and how many there are. Folders are the ones "
        "inside ComfyUI's input or output folder."
    )
    SEARCH_ALIASES = [
        "load folder", "load from folder", "load images", "batch load", "directory",
        "image list", "gallery", "dataset", "load image batch", "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": (
                    list(SOURCES),
                    {
                        "default": SOURCES[0],
                        "tooltip": "Which of ComfyUI's folders to look in: input (pictures you put there) or output (pictures you made).",
                    },
                ),
                "folder": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "The folder inside it. Empty is the input or output folder itself. Browse lists the folders there.",
                    },
                ),
                "subfolders": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "Also take the pictures in the folders inside this one."},
                ),
                "sort": (
                    list(SORTS),
                    {"default": SORTS[0], "tooltip": "The order of the pictures: by name, or by when the file was last changed."},
                ),
                "pictures": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "The picked pictures. Tick them on the node. Empty means every picture in the folder.",
                    },
                ),
                "run": (
                    list(RUNS),
                    {
                        "default": RUNS[0],
                        "tooltip": (
                            "All in one run: one press of Run does every picked picture. One per run: "
                            "each run loads one picture and steps on, so a picture that fails only skips itself."
                        ),
                    },
                ),
                "position": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 1000000,
                        "step": 1,
                        "tooltip": "With one per run: which of the picked pictures the next run loads, counted from 1.",
                    },
                ),
                "after_run": (
                    list(AFTER_RUN),
                    {
                        "default": AFTER_RUN[0],
                        "tooltip": (
                            "With one per run: next moves Picture on by one each time a run is queued, so "
                            "queuing several runs walks the folder. Stay keeps loading the same picture. "
                            "Random jumps to any of the picked ones."
                        ),
                    },
                ),
                "at_the_end": (
                    list(AT_THE_END),
                    {
                        "default": AT_THE_END[0],
                        "tooltip": "With one per run, after the last picture: stop the run with a message, or start over at the first.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "filename", "index", "count")
    OUTPUT_IS_LIST = (True, True, True, True, False)
    OUTPUT_TOOLTIPS = (
        "Each picked picture, one at a time. What comes after runs once for each.",
        "White where the picture is see-through. A picture with no see-through part gives the same empty mask core Load Image does.",
        "The picture's file name without its ending. Wire it to Save Image's filename and the result keeps the name.",
        "The picture's number among the picked ones, counted from 1.",
        "How many pictures are picked.",
    )
    FUNCTION = "load"

    @classmethod
    def IS_CHANGED(cls, source, folder, subfolders, sort, pictures, run, position, after_run, at_the_end):
        try:
            chosen = _picked(source, folder, subfolders, sort, pictures)
        except Exception as error:  # noqa: BLE001 - a changed error is a change too
            return f"error: {error}"
        return f"{fingerprint(chosen)}|{run}|{position if run == 'one per run' else ''}|{at_the_end}"

    @classmethod
    def VALIDATE_INPUTS(cls, source, folder):
        if source is None or folder is None:      # wired in: only known when the run gets there
            return True
        try:
            if not list_pictures(_root(str(source)), folder, True, "name", str(source), limit=1):
                return NO_PICTURES.format(folder=shown_folder(folder, str(source)))
        except (ValueError, RuntimeError) as error:
            return str(error)
        return True

    def load(self, source, folder, subfolders, sort, pictures, run, position, after_run, at_the_end):
        # after_run is the editor's: it moves Picture on after a run is queued. A run loads what Picture says.
        chosen = _picked(source, folder, subfolders, sort, pictures)
        count = len(chosen)
        images, masks, names, numbers = [], [], [], []
        for place in which(count, position, str(run), str(at_the_end)):
            item = chosen[place]
            image, mask = load_picture(item["path"])
            images.append(image)
            masks.append(mask)
            names.append(output_name(item["name"]))
            numbers.append(place + 1)
        note = [{"count": count, "loaded": numbers[:64], "names": [chosen[n - 1]["name"] for n in numbers[:64]]}]
        return {"ui": {UI_KEY: note}, "result": (images, masks, names, numbers, count)}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_ImageFolder": AusBossImageFolder}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_ImageFolder": "Image Folder 🆎"}
