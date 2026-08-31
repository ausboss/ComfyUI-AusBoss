"""Shared backend logic for the LoRA Loader node.

Pure stack parsing and trigger-word logic live at the top so they stay
testable without torch or a running ComfyUI; everything that needs comfy or
the web server imports lazily and fails soft.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path
from typing import Any

try:
    import folder_paths
except ImportError:  # pragma: no cover - only outside ComfyUI
    folder_paths = None

STRENGTH_LIMIT = 10.0
_THUMB_SUFFIXES = (".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                   ".png", ".jpg", ".jpeg", ".webp")


def clamp_strength(value: Any, fallback: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(-STRENGTH_LIMIT, min(STRENGTH_LIMIT, number))


def parse_lora_stack(raw: str | None) -> list[dict[str, Any]]:
    """Validate the serialized stack into clean row dicts.

    Raises ValueError with a user-readable message on malformed input; an
    empty or missing value is a valid empty stack.
    """
    if raw is None or str(raw).strip() == "" or str(raw).strip() == "[]":
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LoRA stack is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("LoRA stack must be a JSON list of rows.")
    rows: list[dict[str, Any]] = []
    for index, entry in enumerate(data, start=1):
        if not isinstance(entry, dict):
            raise ValueError(f"LoRA stack row {index} must be an object.")
        name = str(entry.get("name") or "").strip()
        if not name:
            # Blank rows are a UI convenience (freshly added, not yet picked);
            # they are skipped rather than rejected so a half-built stack runs.
            continue
        strength = clamp_strength(entry.get("strength", 1.0))
        rows.append(
            {
                "name": name,
                "strength": strength,
                "strength_clip": clamp_strength(entry.get("strength_clip", strength), strength),
                "enabled": bool(entry.get("enabled", True)),
                "triggers": str(entry.get("triggers") or "").strip(),
            }
        )
    return rows


def collect_trigger_words(rows: list[dict[str, Any]], separator: str = ", ") -> str:
    """Join enabled rows' trigger words, deduplicated, order preserved."""
    seen: set[str] = set()
    words: list[str] = []
    for row in rows:
        if not row.get("enabled", True):
            continue
        for chunk in str(row.get("triggers", "")).split(","):
            word = chunk.strip()
            key = word.lower()
            if word and key not in seen:
                seen.add(key)
                words.append(word)
    return separator.join(words)


def list_loras() -> list[str]:
    if folder_paths is None:
        return []
    try:
        return sorted(folder_paths.get_filename_list("loras"))
    except Exception:
        return []


def resolve_lora_path(name: str) -> Path:
    if folder_paths is None:
        raise ValueError("folder_paths is unavailable outside ComfyUI.")
    full = folder_paths.get_full_path("loras", name)
    if not full:
        raise ValueError(f"LoRA file not found in models/loras: {name}")
    path = Path(full).resolve()
    roots = [Path(root).resolve() for root in folder_paths.get_folder_paths("loras")]
    if not any(root in path.parents or root == path.parent for root in roots):
        raise ValueError(f"LoRA path escapes the loras folders: {name}")
    return path


def find_thumbnail(name: str) -> Path | None:
    """A sibling preview image for a LoRA file, if the user saved one."""
    try:
        path = resolve_lora_path(name)
    except ValueError:
        return None
    stem = path.with_suffix("")
    for suffix in _THUMB_SUFFIXES:
        candidate = Path(str(stem) + suffix)
        if candidate.is_file():
            return candidate
    return None


# Keep the last few decoded LoRA files: stacks re-run whenever any strength
# changes, and reloading multi-hundred-MB files each run dwarfs the apply cost.
_LORA_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_LORA_CACHE_LIMIT = 4


def _load_lora_file(path: Path) -> Any:
    import comfy.utils

    key = str(path)
    mtime = path.stat().st_mtime
    cached = _LORA_CACHE.get(key)
    if cached and cached[0] == mtime:
        _LORA_CACHE.move_to_end(key)
        return cached[1]
    lora_sd = comfy.utils.load_torch_file(key, safe_load=True)
    _LORA_CACHE[key] = (mtime, lora_sd)
    _LORA_CACHE.move_to_end(key)
    while len(_LORA_CACHE) > _LORA_CACHE_LIMIT:
        _LORA_CACHE.popitem(last=False)
    return lora_sd


def patch_total(model, clip) -> int | None:
    """Applied patch entries across model + CLIP, None when unreadable.

    comfy records every patched weight on the ModelPatcher as
    {weight_key: [patch, ...]}, so a LoRA that matched no keys leaves the
    total untouched. Duck-typed and fail-soft: an unreadable patcher (a
    future comfy refactor) returns None and simply disables the check.
    """
    total = 0
    readable = False
    for patcher in (model, getattr(clip, "patcher", None)):
        patches = getattr(patcher, "patches", None)
        if not isinstance(patches, dict):
            continue
        readable = True
        for entries in patches.values():
            try:
                total += len(entries)
            except TypeError:
                total += 1
    return total if readable else None


_no_effect_warned: set[str] = set()


def _warn_no_effect(row_name: str, declared_family: str) -> None:
    """Warn once per LoRA that patched nothing on the connected model.

    Keyed on the name alone: the same LoRA against a second model is the
    same user-facing mistake, and repeating it every run is noise.
    """
    if row_name in _no_effect_warned:
        return
    _no_effect_warned.add(row_name)
    trained_for = f" It declares base model '{declared_family}'." if declared_family else ""
    print(
        f"[AusBoss] LoRA Loader: '{row_name}' matched nothing in the connected "
        f"model, so it had no effect on this run.{trained_for} It is almost "
        "certainly built for a different base model - check the LoRA's base "
        "model against the checkpoint feeding this node."
    )


def apply_lora_stack(model, clip, rows: list[dict[str, Any]]):
    import comfy.sd

    for row in rows:
        if not row["enabled"]:
            continue
        strength_clip = row["strength_clip"] if clip is not None else 0.0
        if row["strength"] == 0 and strength_clip == 0:
            continue
        path = resolve_lora_path(row["name"])
        lora_sd = _load_lora_file(path)
        before = patch_total(model, clip)
        model, clip = comfy.sd.load_lora_for_models(
            model, clip, lora_sd, row["strength"], strength_clip
        )
        after = patch_total(model, clip)
        # Measured, not guessed: this holds for every model family, present
        # and future, and never fires on a LoRA that actually did something.
        if before is not None and after is not None and after == before:
            _warn_no_effect(row["name"], base_model_family(read_safetensors_metadata(path)))
    return model, clip


def stack_fingerprint(rows: list[dict[str, Any]]) -> str:
    """Cache key covering row values plus each file's identity on disk."""
    parts: list[str] = []
    for row in rows:
        try:
            stat = resolve_lora_path(row["name"]).stat()
            identity = f"{stat.st_mtime_ns}:{stat.st_size}"
        except (ValueError, OSError):
            identity = "missing"
        parts.append(
            f"{row['name']}|{row['strength']}|{row['strength_clip']}|{row['enabled']}|{identity}"
        )
    return ";".join(parts)


def read_safetensors_metadata(path: Path) -> dict[str, Any]:
    """The __metadata__ block of a .safetensors header, without the tensors.

    Reads only the 8-byte header length plus the JSON header; anything odd
    (non-safetensors, oversized header) returns an empty dict.
    """
    if path.suffix.lower() != ".safetensors":
        return {}
    try:
        import struct

        with path.open("rb") as handle:
            header_size = struct.unpack("<Q", handle.read(8))[0]
            if header_size <= 0 or header_size > 100 * 1024 * 1024:
                return {}
            header = json.loads(handle.read(header_size))
        metadata = header.get("__metadata__")
        return metadata if isinstance(metadata, dict) else {}
    except Exception:
        return {}


def file_trigger_words(metadata: dict[str, Any]) -> list[str]:
    """Trigger words a LoRA file states about itself.

    Explicit trigger keys win; the noisy ss_tag_frequency fallback is capped
    hard because most frequent training tags are dataset tags, not activators.
    """
    for key in ("modelspec.trigger_phrase", "ss_trigger_words"):
        value = str(metadata.get(key) or "").strip()
        if value:
            return [word.strip() for word in value.split(",") if word.strip()][:20]
    frequency = metadata.get("ss_tag_frequency")
    if isinstance(frequency, str):
        try:
            frequency = json.loads(frequency)
        except json.JSONDecodeError:
            return []
    if not isinstance(frequency, dict):
        return []
    totals: dict[str, int] = {}
    for dataset in frequency.values():
        if isinstance(dataset, dict):
            for tag, count in dataset.items():
                if isinstance(count, (int, float)):
                    totals[tag.strip()] = totals.get(tag.strip(), 0) + int(count)
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    return [tag for tag, _ in ranked[:8] if tag]


def base_model_family(metadata: dict[str, Any]) -> str:
    """Base model a LoRA declares, '' when it declares nothing.

    Only the two *declarative* keys are read. `ss_sd_model_name` is the
    trainer's source filename, not an architecture, so mining it for
    substrings reported any `..._v1.safetensors` as SD1.5 - a wrong label on
    a working LoRA is worse than no label.
    """
    haystack = " ".join(
        str(metadata.get(key) or "")
        for key in ("modelspec.architecture", "ss_base_model_version")
    ).lower()
    for needle, family in (
        ("flux", "Flux"), ("sd3", "SD3"), ("xl", "SDXL"), ("v2", "SD2"), ("v1", "SD1.5"),
    ):
        if needle in haystack:
            return family
    # Families newer than that table still declare themselves ("krea2/lora",
    # "qwen_image"); show what the file claims rather than nothing.
    declared = str(metadata.get("modelspec.architecture")
                   or metadata.get("ss_base_model_version") or "").strip()
    return declared.split("/")[0].strip()


def _user_store_dir() -> Path | None:
    if folder_paths is None:
        return None
    try:
        base = Path(folder_paths.get_user_directory()) / "ausboss"
        base.mkdir(parents=True, exist_ok=True)
        return base
    except Exception:
        return None


def _atomic_write_json(path: Path, data: Any) -> None:
    import os
    import threading

    temporary = path.with_suffix(f".tmp{os.getpid()}-{threading.get_ident()}")
    temporary.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(temporary, path)


def _triggers_store_path() -> Path | None:
    base = _user_store_dir()
    return None if base is None else base / "lora_triggers.json"


def _read_custom_entry(name: str) -> dict[str, Any]:
    """One LoRA's user data. Values are either a legacy plain word list or a
    dict {words, min, max}; both shapes normalize to the dict form."""
    store = _triggers_store_path()
    if store is None or not store.is_file():
        return {}
    try:
        data = json.loads(store.read_text(encoding="utf-8"))
        entry = data.get(name)
    except Exception:
        return {}
    if isinstance(entry, list):
        return {"words": [str(word) for word in entry if str(word).strip()]}
    if isinstance(entry, dict):
        return entry
    return {}


def load_custom_triggers(name: str) -> list[str]:
    words = _read_custom_entry(name).get("words", [])
    return [str(word) for word in words if str(word).strip()] if isinstance(words, list) else []


def _clean_bound(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return max(-STRENGTH_LIMIT, min(STRENGTH_LIMIT, number))


def load_custom_range(name: str) -> dict[str, float] | None:
    entry = _read_custom_entry(name)
    low = _clean_bound(entry.get("min"))
    high = _clean_bound(entry.get("max"))
    if low is None and high is None:
        return None
    return {"min": low, "max": high}


def save_custom_lora_data(name: str, words: list[str], bounds: dict[str, Any] | None = None) -> dict[str, Any]:
    store = _triggers_store_path()
    if store is None:
        return {"words": []}
    cleaned = [str(word).strip() for word in words if str(word).strip()][:64]
    entry: dict[str, Any] = {"words": cleaned}
    if bounds:
        low = _clean_bound(bounds.get("min"))
        high = _clean_bound(bounds.get("max"))
        if low is not None and high is not None and low > high:
            low, high = high, low
        if low is not None:
            entry["min"] = low
        if high is not None:
            entry["max"] = high
    try:
        data = json.loads(store.read_text(encoding="utf-8")) if store.is_file() else {}
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    if cleaned or len(entry) > 1:
        data[name] = entry
    else:
        data.pop(name, None)
    _atomic_write_json(store, data)
    return entry


def save_custom_triggers(name: str, words: list[str]) -> list[str]:
    entry = _read_custom_entry(name)
    bounds = {"min": entry.get("min"), "max": entry.get("max")}
    return save_custom_lora_data(name, words, bounds).get("words", [])


def _civitai_sidecar_path(name: str) -> Path:
    """ComfyUI's shared Civitai metadata sidecar beside the LoRA file."""
    return resolve_lora_path(name).with_suffix(".civitai.info")


def _clean_civitai_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _normalize_civitai_info(data: Any) -> dict[str, Any]:
    """Normalize either a raw standard sidecar or this pack's old cache shape."""
    if not isinstance(data, dict):
        return {}
    model = data.get("model")
    model = model if isinstance(model, dict) else {}
    raw_words = data.get("trainedWords", data.get("trained_words", []))
    trained_words = (
        [str(word).strip() for word in raw_words if str(word).strip()][:40]
        if isinstance(raw_words, list)
        else []
    )
    info = {
        "found": bool(data.get("found", True)),
        "title": str(model.get("name") or data.get("title") or data.get("name") or ""),
        "base_model": str(data.get("baseModel") or data.get("base_model") or ""),
        "trained_words": trained_words,
        "model_id": _clean_civitai_id(data.get("modelId", data.get("model_id"))),
        "version_id": _clean_civitai_id(data.get("id", data.get("version_id"))),
    }
    recognized = any(
        info[key] not in (None, "", [])
        for key in ("title", "base_model", "trained_words", "model_id", "version_id")
    )
    return info if info["found"] and recognized else {}


def load_civitai_cache(name: str) -> dict[str, Any]:
    try:
        sidecar = _civitai_sidecar_path(name)
    except ValueError:
        return {}
    if not sidecar.is_file():
        return {}
    try:
        return _normalize_civitai_info(json.loads(sidecar.read_text(encoding="utf-8")))
    except Exception:
        return {}


def save_civitai_sidecar(name: str, payload: dict[str, Any]) -> Path:
    """Write the raw Civitai response using the shared sibling-file convention."""
    if not isinstance(payload, dict):
        raise ValueError("Civitai response must be a JSON object.")
    sidecar = _civitai_sidecar_path(name)
    _atomic_write_json(sidecar, payload)
    return sidecar


def _hash_cache_path() -> Path | None:
    base = _user_store_dir()
    return None if base is None else base / "lora_hashes.json"


def file_sha256(path: Path) -> str:
    """SHA256 of the file, cached by (mtime, size) — LoRAs are hundreds of MB."""
    import hashlib

    stat = path.stat()
    identity = f"{stat.st_mtime_ns}:{stat.st_size}"
    cache_file = _hash_cache_path()
    cache: dict[str, Any] = {}
    if cache_file is not None and cache_file.is_file():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    entry = cache.get(str(path))
    if isinstance(entry, dict) and entry.get("identity") == identity:
        return str(entry.get("sha256", ""))
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    sha = digest.hexdigest()
    if cache_file is not None:
        cache[str(path)] = {"identity": identity, "sha256": sha}
        try:
            _atomic_write_json(cache_file, cache)
        except OSError:
            pass
    return sha


def lora_info(name: str) -> dict[str, Any]:
    path = resolve_lora_path(name)
    metadata = read_safetensors_metadata(path)
    civitai = load_civitai_cache(name)
    stat = path.stat()
    return {
        "name": name,
        "size_bytes": stat.st_size,
        "mtime": stat.st_mtime,
        "base_model": base_model_family(metadata) or civitai.get("base_model", ""),
        "file_triggers": file_trigger_words(metadata),
        "civitai_triggers": civitai.get("trained_words", []),
        "civitai_title": civitai.get("title", ""),
        "civitai_model_id": civitai.get("model_id"),
        "civitai_version_id": civitai.get("version_id"),
        "custom_triggers": load_custom_triggers(name),
        "range": load_custom_range(name),
        "has_preview": find_thumbnail(name) is not None,
        "has_civitai": bool(civitai),
    }


async def fetch_civitai_info(name: str) -> dict[str, Any]:
    """Look up the exact LoRA hash and save Civitai's raw standard sidecar."""
    import aiohttp
    import asyncio

    path = resolve_lora_path(name)
    sha = await asyncio.get_running_loop().run_in_executor(None, file_sha256, path)
    timeout = aiohttp.ClientTimeout(total=30, connect=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            f"https://civitai.com/api/v1/model-versions/by-hash/{sha}",
            headers={"User-Agent": "ComfyUI-AusBoss"},
        ) as response:
            if response.status == 404:
                return {"found": False}
            response.raise_for_status()
            # StreamReader.read(n) hands back whatever the buffer holds, not
            # the full body - a real hit is ~150KB of JSON and the first TCP
            # chunk is ~1KB, so a single read truncated every successful
            # lookup mid-string. Accumulate to EOF, capping as chunks arrive.
            body = bytearray()
            async for chunk in response.content.iter_chunked(64 * 1024):
                body.extend(chunk)
                if len(body) > 4 * 1024 * 1024:
                    raise ValueError("Civitai response is too large.")
            payload = json.loads(bytes(body))
    info = _normalize_civitai_info(payload)
    if not info:
        return {"found": False}
    save_civitai_sidecar(name, payload)
    return info


def register_lora_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None or getattr(prompt_server, "_ausboss_lora_routes", False):
        return
    prompt_server._ausboss_lora_routes = True

    @prompt_server.routes.get("/ausboss/lora/list")
    async def ausboss_lora_list(request):
        return web.json_response({"loras": list_loras()})

    @prompt_server.routes.get("/ausboss/lora/thumb")
    async def ausboss_lora_thumb(request):
        thumb = find_thumbnail(request.query.get("name", ""))
        if thumb is None:
            return web.json_response({"error": "no preview image"}, status=404)
        return web.FileResponse(thumb, headers={"Cache-Control": "max-age=3600"})

    @prompt_server.routes.get("/ausboss/lora/info")
    async def ausboss_lora_info(request):
        try:
            info = await asyncio_run_in_executor(lora_info, request.query.get("name", ""))
            return web.json_response({"ok": True, "info": info})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @prompt_server.routes.post("/ausboss/lora/civitai")
    async def ausboss_lora_civitai(request):
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("Request body must be a JSON object.")
            info = await fetch_civitai_info(str(body.get("name", "")))
            return web.json_response({"ok": True, "info": info})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @prompt_server.routes.post("/ausboss/lora/triggers")
    async def ausboss_lora_triggers(request):
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("Request body must be a JSON object.")
            name = str(body.get("name", ""))
            resolve_lora_path(name)
            words = body.get("words", [])
            if not isinstance(words, list):
                raise ValueError("words must be a list.")
            bounds = {"min": body.get("min"), "max": body.get("max")}
            saved = await asyncio_run_in_executor(save_custom_lora_data, name, words, bounds)
            return web.json_response({"ok": True, **saved})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)


async def asyncio_run_in_executor(func, *args):
    import asyncio

    return await asyncio.get_running_loop().run_in_executor(None, func, *args)
