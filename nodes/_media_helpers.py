"""Safe image/video loading and preview routes for AusBoss transform nodes."""

from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
import re

import av
from PIL import Image, ImageOps, ImageSequence

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None


VIDEO_EXTENSIONS = {
    ".avi",
    ".m2ts",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".mts",
    ".webm",
}


def list_input_images() -> list[str]:
    if folder_paths is None:
        return [""]
    root = Path(folder_paths.get_input_directory())
    results: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if folder_paths.filter_files_content_types([path.name], ["image"]):
                results.append(path.relative_to(root).as_posix())
        except Exception:
            if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}:
                results.append(path.relative_to(root).as_posix())
    return sorted(results, key=str.casefold) or [""]


def list_input_videos() -> list[str]:
    if folder_paths is None:
        return [""]
    root = Path(folder_paths.get_input_directory())
    results = [
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    ]
    return sorted(results, key=str.casefold) or [""]


def resolve_input_path(selection: str) -> Path:
    if not selection:
        raise ValueError("Select or upload a source file first.")
    if folder_paths is None:
        path = Path(selection).expanduser().resolve()
    else:
        path = Path(folder_paths.get_annotated_filepath(selection)).resolve()
        input_root = Path(folder_paths.get_input_directory()).resolve()
        try:
            path.relative_to(input_root)
        except ValueError as exc:
            raise ValueError("The selected source is outside ComfyUI's input folder.") from exc
    if not path.is_file():
        raise ValueError("The selected source file no longer exists.")
    return path


def resolve_video_path(source_mode: str, video: str, local_path: str) -> Path:
    if source_mode == "local path":
        text = str(local_path or "").strip().strip('"')
        if not text:
            raise ValueError("Local path mode requires a video path.")
        path = Path(text).expanduser().resolve()
        if not path.is_file():
            raise ValueError("The local video file does not exist.")
    elif source_mode == "input folder":
        path = resolve_input_path(video)
    else:
        raise ValueError("Video source mode must be 'input folder' or 'local path'.")
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported video extension: {path.suffix.lower() or '(none)' }.")
    return path


def load_image_frames(path: Path) -> list[Image.Image]:
    frames: list[Image.Image] = []
    with Image.open(path) as source:
        expected_size: tuple[int, int] | None = None
        for frame in ImageSequence.Iterator(source):
            converted = ImageOps.exif_transpose(frame).convert("RGBA")
            if expected_size is None:
                expected_size = converted.size
            if converted.size != expected_size:
                raise ValueError("Image source contains frames with inconsistent dimensions.")
            frames.append(converted.copy())
            if source.format == "MPO":
                break
    if not frames:
        raise ValueError("The selected image contains no decodable frames.")
    return frames


def video_metadata(path: Path) -> dict[str, float | int | str]:
    with av.open(str(path)) as container:
        stream = next((candidate for candidate in container.streams if candidate.type == "video"), None)
        if stream is None:
            raise ValueError("The selected file does not contain a video stream.")
        fps = float(stream.average_rate or stream.base_rate or 0.0)
        duration = float(stream.duration * stream.time_base) if stream.duration is not None else 0.0
        if duration <= 0 and container.duration is not None:
            duration = float(container.duration / av.time_base)
        frame_count = int(stream.frames or 0)
        if frame_count <= 0 and duration > 0 and fps > 0:
            frame_count = max(1, int(round(duration * fps)))
        return {
            "name": path.name,
            "width": int(stream.codec_context.width or 0),
            "height": int(stream.codec_context.height or 0),
            "fps": fps,
            "frame_count": frame_count,
            "duration": duration,
        }


def decode_video_frame(
    path: Path, seek_mode: str, frame_index: int, frame_time: float
) -> tuple[Image.Image, int, float]:
    metadata = video_metadata(path)
    fps = float(metadata["fps"] or 0.0)
    if seek_mode == "time seconds":
        requested_time = max(0.0, float(frame_time))
        target_index = int(round(requested_time * fps)) if fps > 0 else 0
    elif seek_mode == "frame index":
        target_index = max(0, int(frame_index))
    else:
        raise ValueError("Video seek mode must be 'frame index' or 'time seconds'.")
    frame_count = int(metadata["frame_count"] or 0)
    if frame_count > 0:
        target_index = min(target_index, frame_count - 1)

    selected = None
    actual_index = 0
    actual_time = 0.0
    with av.open(str(path)) as container:
        stream = next((candidate for candidate in container.streams if candidate.type == "video"), None)
        if stream is None:
            raise ValueError("The selected file does not contain a video stream.")
        for index, frame in enumerate(container.decode(stream)):
            if index < target_index:
                continue
            selected = frame.to_image().convert("RGBA")
            actual_index = index
            if frame.time is not None:
                actual_time = float(frame.time)
            elif fps > 0:
                actual_time = index / fps
            break
    if selected is None:
        raise ValueError("The requested video frame could not be decoded.")
    return selected, actual_index, actual_time


def encode_preview(image: Image.Image, max_width: int, max_height: int) -> bytes:
    maximum = max(64, min(2048, int(max(max_width, max_height))))
    preview = image.convert("RGB")
    preview.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
    output = BytesIO()
    preview.save(output, format="JPEG", quality=90, optimize=True)
    return output.getvalue()


def register_video_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None or getattr(prompt_server, "_ausboss_transform_routes", False):
        return
    prompt_server._ausboss_transform_routes = True

    def request_path(request) -> Path:
        return resolve_video_path(
            request.query.get("source_mode", "input folder"),
            request.query.get("video", ""),
            request.query.get("local_path", ""),
        )

    @prompt_server.routes.get("/ausboss/transform/video/metadata")
    async def ausboss_video_metadata(request):
        try:
            return web.json_response(video_metadata(request_path(request)))
        except Exception as exc:
            return web.json_response({"error": _safe_route_error(exc)}, status=400)

    @prompt_server.routes.get("/ausboss/transform/video/frame")
    async def ausboss_video_frame(request):
        try:
            image, actual_index, actual_time = decode_video_frame(
                request_path(request),
                request.query.get("seek_mode", "frame index"),
                _query_int(request, "frame_index", 0),
                _query_float(request, "frame_time", 0.0),
            )
            body = encode_preview(
                image,
                _query_int(request, "max_width", 1600),
                _query_int(request, "max_height", 1600),
            )
            return web.Response(
                body=body,
                content_type="image/jpeg",
                headers={
                    "Cache-Control": "no-store",
                    "X-AusBoss-Frame-Index": str(actual_index),
                    "X-AusBoss-Frame-Time": f"{actual_time:.6f}",
                },
            )
        except Exception as exc:
            return web.json_response({"error": _safe_route_error(exc)}, status=400)


def _safe_route_error(exc: Exception) -> str:
    text = str(exc).strip() or "The media request failed."
    if os.path.isabs(text) or re.search(r"(?:[A-Za-z]:[\\/]|/(?:home|Users|mnt|tmp)/)", text):
        return "The media request failed."
    return text


def _query_int(request, name: str, default: int) -> int:
    try:
        return int(float(request.query.get(name, default)))
    except (TypeError, ValueError):
        return default


def _query_float(request, name: str, default: float) -> float:
    try:
        return float(request.query.get(name, default))
    except (TypeError, ValueError):
        return default
