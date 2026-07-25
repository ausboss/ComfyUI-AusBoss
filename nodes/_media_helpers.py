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


# Editor previews of arbitrary local paths are opt-in. Queued workflows are
# unaffected: queueing is an explicit user action, while the preview routes
# answer any HTTP client that can reach the server.
LOCAL_PREVIEW_ENV = "AUSBOSS_TRANSFORM_LOCAL_PREVIEW"

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


def _comfy_managed_roots() -> list[Path]:
    if folder_paths is None:
        return []
    roots: list[Path] = []
    for getter in ("get_input_directory", "get_output_directory", "get_temp_directory"):
        try:
            roots.append(Path(getattr(folder_paths, getter)()).resolve())
        except Exception:
            continue
    return roots


def local_preview_allowed(candidate: str) -> bool:
    """Preview routes may read a local path when the user opted in via the
    environment flag, or when the path is already inside a ComfyUI-managed
    folder (input/output/temp) that core routes serve anyway."""
    if os.environ.get(LOCAL_PREVIEW_ENV, "").strip().lower() in {"1", "true", "yes", "on"}:
        return True
    try:
        resolved = Path(str(candidate or "").strip().strip('"')).expanduser().resolve()
    except (OSError, ValueError):
        return False
    return any(resolved == root or root in resolved.parents for root in _comfy_managed_roots())


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


def _video_stream(container):
    stream = next((candidate for candidate in container.streams if candidate.type == "video"), None)
    if stream is None:
        raise ValueError("The selected file does not contain a video stream.")
    return stream


def _frame_position(frame, fps: float, fallback_index: int) -> tuple[int, float]:
    if frame.time is not None:
        time_value = float(frame.time)
        index = int(round(time_value * fps)) if fps > 0 else fallback_index
        return index, time_value
    return fallback_index, (fallback_index / fps if fps > 0 else 0.0)


def _decode_with_seek(path: Path, requested_time: float, fps: float):
    """Keyframe-seek then decode forward. Returns None when the file has no
    usable timestamps so the caller can fall back to a sequential scan."""
    with av.open(str(path)) as container:
        stream = _video_stream(container)
        if not stream.time_base:
            return None
        try:
            offset = int(requested_time / stream.time_base) + (stream.start_time or 0)
            container.seek(offset, stream=stream, backward=True, any_frame=False)
        except Exception:
            return None
        tolerance = (0.5 / fps) if fps > 0 else 0.0
        last = None
        for frame in container.decode(stream):
            if frame.time is None:
                return None
            last = frame
            if float(frame.time) + tolerance >= requested_time:
                break
        if last is None:
            return None
        index, time_value = _frame_position(last, fps, 0)
        return last.to_image().convert("RGBA"), index, time_value


def _decode_sequential(path: Path, target_index: int, fps: float):
    with av.open(str(path)) as container:
        stream = _video_stream(container)
        last = None
        for index, frame in enumerate(container.decode(stream)):
            last = (frame, index)
            if index >= target_index:
                break
        if last is None:
            raise ValueError("The requested video frame could not be decoded.")
        frame, index = last
        position_index, position_time = _frame_position(frame, fps, index)
        return frame.to_image().convert("RGBA"), position_index, position_time


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
        requested_time = target_index / fps if fps > 0 else 0.0
    else:
        raise ValueError("Video seek mode must be 'frame index' or 'time seconds'.")
    frame_count = int(metadata["frame_count"] or 0)
    if frame_count > 0 and target_index > frame_count - 1:
        target_index = frame_count - 1
        if fps > 0:
            requested_time = target_index / fps

    # Keyframe seek keeps scrubbing fast on long videos; the sequential scan
    # remains as the safety net for files without reliable timestamps.
    if fps > 0 and target_index > 0:
        selected = _decode_with_seek(path, requested_time, fps)
        if selected is not None:
            return selected
    return _decode_sequential(path, target_index, fps)


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
        source_mode = request.query.get("source_mode", "input folder")
        local_path = request.query.get("local_path", "")
        # Gate before touching the filesystem so a denied request can not be
        # used to probe which paths exist.
        if source_mode == "local path" and not local_preview_allowed(local_path):
            raise ValueError(
                "Local path previews are disabled by default; queued workflows still "
                f"read the file. Start ComfyUI with {LOCAL_PREVIEW_ENV}=1 to enable "
                "editor previews for local paths."
            )
        return resolve_video_path(source_mode, request.query.get("video", ""), local_path)

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
