"""Save Image 🆎."""

from __future__ import annotations

from pathlib import Path

from ._image_save_helpers import (
    EXISTING_POLICIES,
    FORMAT_EXTENSIONS,
    IMAGE_FORMATS,
    encode_image,
    existing_action,
    metadata_disabled,
    plan_exact_names,
    resolve_output_root,
    sanitize_exact_name,
    sidecar_path,
    strip_image_extension,
)
from ._video_save_helpers import workflow_metadata

try:
    import folder_paths
except ImportError:  # offline tests
    folder_paths = None


class AusBossSaveImage:
    CATEGORY = "🆎 AusBoss/Image"
    DESCRIPTION = (
        "Saves an IMAGE batch as PNG or lossless JPEG XL, with the workflow "
        "embedded or deliberately left out. exact_name saves under exactly "
        "that filename — no counter suffix — so an edit or caption pass can "
        "keep the source file's name; a non-empty caption writes a .txt "
        "sidecar with the same basename, the dataset-captioning pair. "
        "Leave exact_name empty for classic prefix_00001_ saving that "
        "never overwrites."
    )
    SEARCH_ALIASES = [
        "save image",
        "png",
        "jpeg xl",
        "jxl",
        "exact filename",
        "caption",
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
                            "Classic naming: prefix plus a counter that "
                            "never overwrites, in ComfyUI's output folder. "
                            "Subfolders are allowed. Ignored while "
                            "exact_name is set."
                        ),
                    },
                ),
                "format": (
                    list(IMAGE_FORMATS),
                    {
                        "default": "png",
                        "tooltip": (
                            "png saves everywhere. jxl lossless keeps every "
                            "pixel bit-identical in a smaller file; it needs "
                            "the optional pillow-jxl-plugin in ComfyUI's "
                            "python and says so if it is missing."
                        ),
                    },
                ),
                "save_metadata": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "On embeds the prompt and workflow (PNG text "
                            "chunks; EXIF in jxl), so the file drags back "
                            "into ComfyUI. Off writes a clean file with no "
                            "workflow inside — for sharing without "
                            "shipping the recipe."
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
                            "Save under exactly this filename — no counter "
                            "suffix. An image extension on the value is "
                            "replaced by the chosen format's own, so "
                            "'photo123.jpg' saves as photo123.png and "
                            "pairs with photo123.txt. Subfolders are "
                            "allowed; a batch appends _001, _002… since "
                            "frames cannot share one name. Empty uses "
                            "filename_prefix instead."
                        ),
                    },
                ),
                "on_existing": (
                    list(EXISTING_POLICIES),
                    {
                        "default": "overwrite",
                        "tooltip": (
                            "What an exact_name save does when the file is "
                            "already there: overwrite replaces it (the "
                            "usual reason to want an exact name), skip "
                            "leaves it and moves on, error stops the run. "
                            "Classic prefix saving never collides."
                        ),
                    },
                ),
                "output_dir": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "Where to save. Empty is ComfyUI's output "
                            "folder; a relative path is a subfolder of it; "
                            "an absolute path saves anywhere you can write "
                            "— e.g. straight into a dataset folder. The "
                            "node preview only shows files inside the "
                            "output folder."
                        ),
                    },
                ),
                "caption": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": (
                            "When not empty, writes this text as a UTF-8 "
                            ".txt sidecar with the same basename as each "
                            "saved image — the image/caption pair training "
                            "tools expect. Empty writes no sidecar."
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
        "The input batch, unchanged — save first, keep wiring.",
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
        prompt=None,
        extra_pnginfo=None,
    ):
        if folder_paths is None:
            raise RuntimeError("Save Image requires ComfyUI's folder_paths at runtime.")
        extension = FORMAT_EXTENSIONS[format]
        # --disable-metadata is the server owner's call and beats the widget.
        embed = save_metadata and not metadata_disabled()
        metadata = workflow_metadata(prompt, extra_pnginfo) if embed else None
        caption_text = str(caption or "")
        output_root = Path(folder_paths.get_output_directory())
        count = int(images.shape[0])

        exact = sanitize_exact_name(exact_name)
        saved: list[Path] = []
        previews: list[dict] = []
        if exact:
            root = resolve_output_root(output_dir, output_root)
            base = strip_image_extension(exact)
            for name, frame in zip(plan_exact_names(base, extension, count), images):
                path = root / name
                if existing_action(path.exists(), on_existing) == "skip":
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                encode_image(path, frame, format, metadata)
                if caption_text.strip():
                    sidecar_path(path).write_text(caption_text, encoding="utf-8")
                saved.append(path)
        else:
            # Classic mode: core's counter naming, never a collision. A
            # custom output_dir still applies by re-rooting the prefix walk.
            root = resolve_output_root(output_dir, output_root)
            full_output_folder, filename, counter, subfolder, filename_prefix = (
                folder_paths.get_save_image_path(
                    filename_prefix, str(root), int(images.shape[2]), int(images.shape[1])
                )
            )
            for index, frame in enumerate(images):
                file = f"{filename}_{counter + index:05}_.{extension}"
                path = Path(full_output_folder) / file
                encode_image(path, frame, format, metadata)
                if caption_text.strip():
                    sidecar_path(path).write_text(caption_text, encoding="utf-8")
                saved.append(path)

        # The frontend can only serve previews from inside the output
        # folder; anything saved elsewhere is reported by path instead.
        resolved_root = output_root.resolve()
        for path in saved:
            resolved = path.resolve()
            if resolved_root == resolved.parent or resolved_root in resolved.parents:
                relative = resolved.parent.relative_to(resolved_root)
                previews.append({
                    "filename": resolved.name,
                    "subfolder": "" if relative == Path(".") else str(relative),
                    "type": "output",
                })
        return {
            "ui": {"images": previews},
            "result": (str(saved[0]) if saved else "", images),
        }

    @classmethod
    def IS_CHANGED(cls, **_values):
        # A saver's job is the side effect: deleting the file and queueing
        # again must save again, so this node never reports "unchanged".
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, exact_name="", **_values):
        # Surface a bad exact name before the run instead of mid-save.
        if isinstance(exact_name, str) and exact_name.strip():
            try:
                sanitize_exact_name(exact_name)
            except ValueError as exc:
                return str(exc)
        return True


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_SaveImage": AusBossSaveImage}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_SaveImage": "Save Image 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
