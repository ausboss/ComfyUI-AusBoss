"""Save Image 🆎."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ._folder_access_helpers import register_folder_access_routes
from ._image_save_helpers import (
    EXISTING_POLICIES,
    FORMAT_EXTENSIONS,
    IMAGE_FORMATS,
    encode_image,
    existing_action,
    metadata_disabled,
    name_stem,
    next_free_counter,
    plan_exact_names,
    plan_local_names,
    resolve_output_root,
    sanitize_exact_name,
    sidecar_path,
    split_prefix,
    strip_image_extension,
)
from ._video_save_helpers import workflow_metadata

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None


def _register_folder_route() -> None:
    """GET /ausboss/save_image/folders?path=<relative> lists the subfolders
    under ComfyUI's output folder, for the node's Browse button. Paths are
    attacker-controlled: anything that resolves outside the output folder
    answers 400, and nothing outside it is ever listed."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    if getattr(PromptServer.instance, "_ausboss_save_image_folders", False):
        return
    PromptServer.instance._ausboss_save_image_folders = True

    @PromptServer.instance.routes.get("/ausboss/save_image/folders")
    async def list_folders(request):
        root = Path(folder_paths.get_output_directory()).resolve()
        relative = str(request.rel_url.query.get("path", "")).strip().replace("\\", "/")
        try:
            target = (root / relative).resolve() if relative else root
        except Exception:
            return web.json_response({"error": "bad path"}, status=400)
        if target != root and root not in target.parents:
            return web.json_response({"error": "outside the output folder"}, status=400)
        if not target.is_dir():
            return web.json_response({"error": "not a folder"}, status=404)
        folders = sorted(
            entry.name for entry in target.iterdir()
            if entry.is_dir() and not entry.name.startswith(".")
        )
        shown = "" if target == root else target.relative_to(root).as_posix()
        return web.json_response({"path": shown, "folders": folders})


class AusBossSaveImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Saves an IMAGE batch as PNG, lossless WebP or lossless JPEG XL, with "
        "the workflow embedded or deliberately left out. The name is either "
        "composed here - a prefix plus the tags you switch on (date, time, "
        "size, a collision-safe counter, a batch number) - or supplied "
        "exactly by the filename input, so an edit or caption pass keeps the "
        "source file's name. A non-empty caption writes a .txt sidecar with "
        "the same basename, the dataset-captioning pair."
    )
    SEARCH_ALIASES = [
        "save image",
        "png",
        "webp",
        "jpeg xl",
        "jxl",
        "exact filename",
        "caption",
        "dataset",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": (
                    "IMAGE",
                    {"tooltip": "BHWC batch; every frame in it is saved."},
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "AusBoss/image",
                        "tooltip": (
                            "The local filename, with optional subfolders: the "
                            "name tags (date, time, size, counter, batch) are "
                            "appended to it. Ignored while filename is linked "
                            "or exact_name is set."
                        ),
                    },
                ),
                "format": (
                    list(IMAGE_FORMATS),
                    {
                        "default": "png",
                        "tooltip": (
                            "png saves everywhere and preserves alpha. webp "
                            "lossless is usually smaller than png, alpha kept. "
                            "jxl lossless is the most compact; it needs the "
                            "optional pillow-jxl-plugin in ComfyUI's python and "
                            "few browsers preview it."
                        ),
                    },
                ),
                "save_metadata": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "On embeds the prompt and workflow (PNG text "
                            "chunks; EXIF in webp and jxl), so the file drags "
                            "back into ComfyUI. Off writes a clean file with no "
                            "workflow inside - for sharing or datasets."
                        ),
                    },
                ),
            },
            "optional": {
                "exact_name": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "Save under exactly this filename - no tags. An "
                            "image extension on the value is replaced by the "
                            "chosen format's own. Subfolders are allowed; a "
                            "batch appends _001, _002... Empty composes the "
                            "name from filename_prefix instead. A linked "
                            "filename input takes precedence."
                        ),
                    },
                ),
                "on_existing": (
                    list(EXISTING_POLICIES),
                    {
                        "default": "overwrite",
                        "tooltip": (
                            "What a save that lands on an existing file does: "
                            "overwrite replaces it, skip leaves it, error stops "
                            "the run. Only reachable with the counter off, an "
                            "exact name, or a linked filename - the counter "
                            "never collides."
                        ),
                    },
                ),
                "output_dir": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "Where to save. Empty is ComfyUI's output folder; "
                            "a relative path is a subfolder of it. Any other "
                            "folder must be approved on the ComfyUI computer "
                            "once: Browse > Choose another folder opens the "
                            "system folder dialog there. The node preview only "
                            "shows files inside the output folder."
                        ),
                    },
                ),
                "caption": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": (
                            "When not empty, writes this text as a UTF-8 .txt "
                            "sidecar with the same basename as each saved "
                            "image. The caption_text input takes precedence."
                        ),
                    },
                ),
                "filename": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "Exact filename from upstream (a Load Image name, "
                            "a caption tool's id). Its image extension is "
                            "replaced by the chosen format's; no tags are "
                            "added; a batch appends _001, _002... A linked but "
                            "empty value stops the run rather than saving "
                            "under a made-up name."
                        ),
                    },
                ),
                "caption_text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "Caption from upstream: saved as a .txt in the same "
                            "folder with the same name as the image (portrait.png "
                            "-> portrait.txt). Empty writes no sidecar."
                        ),
                    },
                ),
                "name_counter": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Append the next free five-digit number. On is "
                            "collision-safe; off reuses the same path and "
                            "replaces an existing file."
                        ),
                    },
                ),
                "name_date": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "Append the local save date as YYYY-MM-DD."},
                ),
                "name_time": (
                    "BOOLEAN",
                    {"default": False, "tooltip": "Append the local save time as HH-mm-ss."},
                ),
                "name_size": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Append the image dimensions as WIDTHxHEIGHT, such as 1024x1024.",
                    },
                ),
                "name_batch": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "For an image batch, append b001, b002... so each "
                            "image's position in this run is visible. A single "
                            "image is unchanged."
                        ),
                    },
                ),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("file_path", "images")
    OUTPUT_TOOLTIPS = (
        "Absolute path of the first file this run saved (empty when every "
        "file was skipped), for downstream nodes that want the file itself.",
        "The input batch, unchanged - save first, keep wiring.",
    )
    OUTPUT_NODE = True
    FUNCTION = "save"

    def save(
        self,
        images,
        filename_prefix,
        format,
        save_metadata,
        exact_name="",
        on_existing="overwrite",
        output_dir="",
        caption="",
        filename=None,
        caption_text=None,
        name_counter=True,
        name_date=False,
        name_time=False,
        name_size=False,
        name_batch=False,
        prompt=None,
        extra_pnginfo=None,
    ):
        if folder_paths is None:
            raise RuntimeError("Save Image requires ComfyUI's folder_paths at runtime.")
        extension = FORMAT_EXTENSIONS[format]
        # --disable-metadata is the server owner's call and beats the widget.
        embed = save_metadata and not metadata_disabled()
        metadata = workflow_metadata(prompt, extra_pnginfo) if embed else None
        # A linked caption wins over the legacy text box; blank means no sidecar.
        linked_caption = str(caption_text or "") if caption_text is not None else ""
        caption_value = linked_caption if linked_caption.strip() else str(caption or "")
        output_root = Path(folder_paths.get_output_directory())
        root = resolve_output_root(output_dir, output_root)
        count = int(images.shape[0])
        height, width = int(images.shape[1]), int(images.shape[2])

        # Exact naming: the linked filename first, then the legacy widget.
        if filename is not None:
            text = str(filename).strip()
            if not text:
                raise ValueError(
                    "Save Image: the linked filename is empty. Feed it a name "
                    "or unlink it to compose the name here."
                )
            exact = sanitize_exact_name(text)
        else:
            exact = sanitize_exact_name(exact_name)

        planned: list[tuple[Path, str]] = []  # (path, collision policy)
        if exact:
            base = strip_image_extension(exact)
            for name in plan_exact_names(base, extension, count):
                planned.append((root / name, on_existing))
        else:
            subfolder, base = split_prefix(filename_prefix)
            folder = root / subfolder if subfolder else root
            stem = name_stem(
                base,
                {"date": bool(name_date), "time": bool(name_time), "size": bool(name_size)},
                datetime.now(),
                width,
                height,
            )
            counter = bool(name_counter)
            existing = [entry.name for entry in folder.iterdir()] if folder.is_dir() else []
            names = plan_local_names(
                stem, extension, count, counter=counter, batch=bool(name_batch),
                next_counter=next_free_counter(existing, stem),
            )
            # The counter is collision-safe by construction; without it the
            # legacy policy decides, and its default deliberately overwrites.
            policy = "overwrite" if counter else on_existing
            planned.extend((folder / name, policy) for name in names)

        saved: list[Path] = []
        for (path, policy), frame in zip(planned, images):
            if existing_action(path.exists(), policy) == "skip":
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            encode_image(path, frame, format, metadata)
            if caption_value.strip():
                sidecar_path(path).write_text(caption_value, encoding="utf-8")
            saved.append(path)

        # The frontend can only serve previews from inside the output
        # folder; anything saved elsewhere is reported by path instead.
        previews: list[dict] = []
        resolved_root = output_root.resolve()
        shown_paths: list[str] = []
        for path in saved:
            resolved = path.resolve()
            inside = resolved_root == resolved.parent or resolved_root in resolved.parents
            if inside:
                relative = resolved.parent.relative_to(resolved_root)
                previews.append({
                    "filename": resolved.name,
                    "subfolder": "" if relative == Path(".") else str(relative),
                    "type": "output",
                })
                shown_paths.append(resolved.relative_to(resolved_root).as_posix())
            else:
                shown_paths.append(str(resolved))
        return {
            "ui": {"images": previews, "ausboss_saved_path": shown_paths[:1]},
            "result": (str(saved[0]) if saved else "", images),
        }

    @classmethod
    def IS_CHANGED(cls, **_values):
        # A saver's job is the side effect: deleting the file and queueing
        # again must save again, so this node never reports "unchanged".
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, exact_name="", filename_prefix="", **_values):
        # Surface a bad name before the run instead of mid-save.
        for label, value in (("exact_name", exact_name), ("filename_prefix", filename_prefix)):
            if isinstance(value, str) and value.strip():
                try:
                    sanitize_exact_name(value)
                except ValueError as exc:
                    return str(exc).replace("exact_name", label)
        # **_values carries every input, so core skips its own checks here:
        # the folder is refused before the run, not mid-save.
        output_dir = _values.get("output_dir")
        if isinstance(output_dir, str) and output_dir.strip() and folder_paths is not None:
            try:
                resolve_output_root(output_dir, folder_paths.get_output_directory())
            except ValueError as exc:
                return str(exc)
        return True


_register_folder_route()
register_folder_access_routes()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_SaveImage": AusBossSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_SaveImage": "Save Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
