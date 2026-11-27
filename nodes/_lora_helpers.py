"""Shared backend logic for the LoRA Loader node.

Pure stack parsing and trigger-word logic live at the top so they stay
testable without torch or a running ComfyUI; everything that needs comfy or
the web server imports lazily and fails soft.
"""

from __future__ import annotations

import json
import os
import re
from collections import OrderedDict
from pathlib import Path
from typing import Any

from ._route_errors import error_detail

try:
    import folder_paths
except ImportError:  # pragma: no cover - only outside ComfyUI
    folder_paths = None

STRENGTH_LIMIT = 10.0
_THUMB_SUFFIXES = (".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                   ".png", ".jpg", ".jpeg", ".webp")
# The node shows a preview at 180 px at most; twice that keeps it sharp.
THUMB_EDGE = 360


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
        # A row in a group that is switched off does not run; its own
        # "enabled" is kept for when the group comes back on.
        enabled = bool(entry.get("enabled", True)) and entry.get("group_off") is not True
        rows.append(
            {
                "id": str(entry.get("id") or ""),
                "name": name,
                "strength": strength,
                "strength_clip": clamp_strength(entry.get("strength_clip", strength), strength),
                "enabled": enabled,
                "triggers": str(entry.get("triggers") or "").strip(),
                # The row follows the node's strength curve when one is linked.
                "curve": entry.get("curve") is True,
            }
        )
    return rows


# A row's strength can come in on a link: the node then has an input named
# strength_<row id>, made by the frontend when a value is dropped on the row.
ROW_STRENGTH_PREFIX = "strength_"
_ROW_INPUT = re.compile(r"^strength_[A-Za-z0-9_-]{1,64}$")


def is_row_strength_input(name: Any) -> bool:
    return isinstance(name, str) and bool(_ROW_INPUT.match(name))


def apply_linked_strengths(rows: list[dict[str, Any]], linked: dict[str, Any]) -> list[dict[str, Any]]:
    """Rows with each linked value as the model strength.

    The CLIP strength keeps the ratio the row had to its model strength, so
    one slider moves the whole LoRA. A row at model strength 0 has no ratio
    to keep; its CLIP strength then follows the slider one for one.
    """
    values = {
        name[len(ROW_STRENGTH_PREFIX):]: value
        for name, value in linked.items()
        if is_row_strength_input(name) and value is not None
    }
    if not values:
        return rows
    out = []
    for row in rows:
        row_id = row.get("id")
        if not row_id or row_id not in values:
            out.append(row)
            continue
        strength = clamp_strength(values[row_id], row["strength"])
        ratio = row["strength_clip"] / row["strength"] if row["strength"] else 1.0
        out.append({**row, "strength": strength, "strength_clip": clamp_strength(strength * ratio, strength)})
    return out


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


_LORA_EXTENSIONS = (".safetensors", ".sft", ".ckpt", ".pt")


def _lora_basename(name: str) -> str:
    stem = str(name).replace("\\", "/").rsplit("/", 1)[-1].lower()
    for extension in _LORA_EXTENSIONS:
        if stem.endswith(extension):
            return stem[: -len(extension)]
    return stem


def match_lora_name(name: str, available: list[str]) -> tuple[str, str]:
    """Fit a stored LoRA path to this install's list; mirrors the frontend.

    Exact wins; then a unique case-insensitive full-path match; then a unique
    basename match ignoring folders and extension - which is what lets a
    workflow whose files were reorganized (or saved on another machine's
    layout) land on the same file here. Returns (best name, status) with
    status one of exact | remapped | ambiguous | missing.
    """
    if name in available:
        return name, "exact"
    lowered = str(name).lower()
    full_matches = [entry for entry in available if entry.lower() == lowered]
    if len(full_matches) == 1:
        return full_matches[0], "remapped"
    wanted = _lora_basename(name)
    base_matches = [entry for entry in available if _lora_basename(entry) == wanted]
    if len(base_matches) == 1:
        return base_matches[0], "remapped"
    return name, ("ambiguous" if base_matches else "missing")


_remap_noted: set[str] = set()


def resolve_lora_path(name: str) -> Path:
    if folder_paths is None:
        raise ValueError("folder_paths is unavailable outside ComfyUI.")
    # Only a name on ComfyUI's own LoRA list reaches the disk. A route's
    # name or a widget value is never joined to a folder as given: it is
    # matched against the list first, and anything else is refused here.
    candidate, status = match_lora_name(str(name), list_loras())
    if status == "remapped":
        # The saved path is stale; a moved file should just keep working.
        if name not in _remap_noted:
            _remap_noted.add(name)
            print(
                f"[AusBoss] LoRA Loader: '{name}' is not at its saved "
                f"path; using '{candidate}'."
            )
    elif status == "ambiguous":
        raise ValueError(
            f"LoRA name matches several files in models/loras: {name}"
        )
    elif status != "exact":
        raise ValueError(f"LoRA file not found in models/loras: {name}")
    full = folder_paths.get_full_path("loras", candidate)
    if not full:
        raise ValueError(f"LoRA file not found in models/loras: {name}")
    # The listed file must also sit below one of the loras folders, read
    # from the path as ComfyUI built it, with ".." folded.
    path = Path(os.path.abspath(full))
    roots = [Path(os.path.abspath(root)) for root in folder_paths.get_folder_paths("loras")]
    if not any(root in path.parents for root in roots):
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


_missing_warned: set[str] = set()


def _warn_missing(row_name: str, reason: str) -> None:
    """Warn once per LoRA that could not be found anywhere in models/loras.

    Only reached in skip mode (on_missing="skip"): the row is dropped, the rest
    of the stack still applies, and the panel marks the row so the miss is
    visible. The default, "error", stops the run before sampling instead.
    """
    if row_name in _missing_warned:
        return
    _missing_warned.add(row_name)
    print(
        f"[AusBoss] LoRA Loader: skipping '{row_name}' - {reason} The rest "
        "of the stack still applies; fix or remove the row to clear this."
    )


MISSING_MODES = ("skip", "error")


def missing_lora_rows(rows: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(name, reason) for every enabled, non-zero row whose file does not resolve.

    Shared by validation and execution so a strict stack fails before sampling
    with the same message it would otherwise have failed with mid-run.
    """
    missing: list[tuple[str, str]] = []
    for row in rows:
        if not row.get("enabled", True):
            continue
        if row.get("strength", 0) == 0 and row.get("strength_clip", 0) == 0:
            continue
        try:
            resolve_lora_path(row["name"])
        except ValueError as exc:
            missing.append((row["name"], str(exc)))
    return missing


_REDOWNLOAD = "Download the file again and use the .safetensors file."


def unreadable_lora_reason(path: Path) -> str:
    """Why this file cannot be a LoRA, in plain words; "" when its start looks fine.

    Reads 64 bytes, so validation can run it on every row before a model
    loads. Each check wants a whole signature: one byte proves nothing, a
    .safetensors file opens with its header length, which can be any byte.
    """
    try:
        with path.open("rb") as handle:
            head = handle.read(64)
    except OSError:
        return ""
    if not head:
        return f"The file is empty, so its download never finished. {_REDOWNLOAD}"
    if head.startswith(b"SQLite format 3"):
        return (
            "It looks like a Draw Things file. Draw Things turns a LoRA into its own "
            "kind of file when you import it, and ComfyUI cannot open that kind. "
            "Pick the original .safetensors file in this row."
        )
    if head.startswith(b"version https://git-lfs"):
        return f"It is a small text pointer to the LoRA, not the LoRA itself. {_REDOWNLOAD}"
    if head.lstrip().lower().startswith((b"<!doctype", b"<html", b"<?xml")):
        return (
            "It is a web page saved under the LoRA's name, which happens when a "
            f"download needs a login or fails. {_REDOWNLOAD}"
        )
    return ""


def unreadable_lora_rows(rows: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(name, reason) for every enabled, non-zero row whose file is plainly not a LoRA.

    A row whose file is missing is left to missing_lora_rows.
    """
    unreadable: list[tuple[str, str]] = []
    for row in rows:
        if not row.get("enabled", True):
            continue
        if row.get("strength", 0) == 0 and row.get("strength_clip", 0) == 0:
            continue
        try:
            reason = unreadable_lora_reason(resolve_lora_path(row["name"]))
        except ValueError:
            continue
        if reason:
            unreadable.append((row["name"], reason))
    return unreadable


def unreadable_lora_message(name: str, reason: str, detail: str = "") -> str:
    message = f"LoRA Loader: '{name}' is not a LoRA file ComfyUI can open. " + (
        reason
        or "It may be broken, only partly downloaded, or another kind of file "
        f"under a LoRA's name. {_REDOWNLOAD}"
    )
    return f"{message} Technical details: {detail}" if detail else message


CURVE_WRAPPER_KEY = "ausboss_lora_curve"


class LoraCurve:
    """Moves the curve rows' strength from step to step.

    The rows are loaded the way core's bypass LoRA loads them: the LoRA is
    added to each layer's output as the layer runs, and the model's weights
    are never rewritten. That works on every model file (full size, fp8, fp8
    scaled, int8) and costs no extra memory. Core reads each adapter's
    ``multiplier`` while the layer runs, so this wrapper, called before the
    model at every step, sets it to the row's strength times the curve.
    "Where in the run" is the step's noise level, read the way core reads hook
    keyframes, so the LoRA curve and Krea 2's reference curve line up.
    """

    def __init__(self, curve: list[float]):
        from ._curve_helpers import keyframe_plan

        self.plan = keyframe_plan(curve)
        self.rows: list[tuple[float, list]] = []
        self._starts = None
        self._sampling = None

    def add_row(self, strength: float, adapters: list):
        self.rows.append((strength, adapters))

    def set_strength(self, value: float):
        for strength, adapters in self.rows:
            for adapter in adapters:
                adapter.multiplier = strength * value

    def strength_for(self, model_sampling, sigma, first: bool) -> float:
        """The curve at this step. ``sigma`` is the step's noise level as the model gets it (a tensor)."""
        import torch

        from ._curve_helpers import noise_plan, strength_at_noise

        dtype = getattr(sigma, "dtype", torch.float64)
        if self._starts is None or self._sampling != (model_sampling, dtype):
            # Core compares keyframe starts with the step's noise level in the
            # step's own number type; rounding the starts to it reads every
            # step the same way, keyframe edges included.
            self._starts = [(torch.tensor(start, dtype=dtype).item(), value)
                            for start, value in noise_plan(self.plan, model_sampling.percent_to_sigma)]
            self._sampling = (model_sampling, dtype)
        level = float(sigma.flatten()[0]) if hasattr(sigma, "flatten") else float(sigma)
        return strength_at_noise(self._starts, level, first)

    def __call__(self, executor, x, t, c_concat, c_crossattn, control, transformer_options, **kwargs):
        level = float(t.flatten()[0]) if hasattr(t, "flatten") else float(t)
        sigmas = (transformer_options or {}).get("sample_sigmas")
        first = sigmas is not None and len(sigmas) > 0 and level >= float(sigmas.max())
        self.set_strength(self.strength_for(executor.class_obj.model_sampling, t, first))
        return executor(x, t, c_concat, c_crossattn, control, transformer_options, **kwargs)


def _curve_hook_class():
    """Core's bypass layer wrapper, made safe to take off in any order.

    Core wraps a layer by replacing its ``forward`` and takes it off by putting
    back the ``forward`` it found. Two rows on one layer (two marked rows, or
    two LoRA Loaders in a chain) stack two wrappers, and core takes them off
    in the order it put them on, so the first row's wrapper used to stay
    behind with nothing under it and broke the next run. Taken off, a wrapper
    here only passes the layer through, and every wrapper that is no longer on
    top of another is removed for good.
    """
    global _CURVE_HOOK
    if _CURVE_HOOK is None:
        import comfy.weight_adapter.bypass as bypass

        class CurveHook(bypass.BypassForwardHook):
            active = False

            def _bypass_forward(self, x, *args, **kwargs):
                if not self.active:
                    return self.original_forward(x, *args, **kwargs)
                return super()._bypass_forward(x, *args, **kwargs)

            def put_on(self):
                if self.original_forward is None:
                    self.inject()
                self.active = True

            def take_off(self):
                self.active = False
                module = self.module
                while True:
                    top = getattr(module.forward, "__self__", None)
                    if not isinstance(top, CurveHook) or top.active or top.original_forward is None:
                        return
                    top.eject()

        _CURVE_HOOK = CurveHook
    return _CURVE_HOOK


_CURVE_HOOK = None


def _curve_row(model, lora_sd: Any, strength: float, curve: LoraCurve):
    """Load a row that follows the curve onto the model in core's bypass mode.

    Returns (model, parts): how many of the LoRA's parts reached the model.
    The few parts that are not low-rank adapters (a plain weight or bias
    difference) cannot change per step; they stay at the row's strength.
    """
    import comfy.lora
    import comfy.lora_convert
    import comfy.patcher_extension
    import comfy.weight_adapter

    key_map = comfy.lora.model_lora_keys_unet(model.model, {})
    loaded = comfy.lora.load_lora(comfy.lora_convert.convert_lora(lora_sd), key_map, log_missing=False)
    model = model.clone()
    model_keys = set(model.model.state_dict().keys())
    hook_class = _curve_hook_class()
    hooks = []
    adapters = []
    steady = {}
    for key, part in loaded.items():
        if isinstance(part, comfy.weight_adapter.WeightAdapterBase) and isinstance(key, str) and key in model_keys:
            layer = key[:-len(".weight")] if key.endswith(".weight") else key
            try:
                module = model.model.get_submodule(layer)
            except AttributeError:
                module = None
            if module is not None and getattr(module, "weight", None) is not None:
                hooks.append(hook_class(module, part, multiplier=strength))
                adapters.append(part)
                continue
        steady[key] = part
    parts = len(model.add_patches(steady, strength)) if steady else 0
    if hooks:
        def put_on(patcher, hooks=hooks):
            for hook in hooks:
                hook.put_on()

        def take_off(patcher, hooks=hooks):
            for hook in hooks:
                hook.take_off()

        # One key per row across the whole chain: a second LoRA Loader with a
        # curve must not replace the first one's rows.
        taken = sum(1 for key in getattr(model, "injections", {}) if key.startswith(f"{CURVE_WRAPPER_KEY}_"))
        model.set_injections(f"{CURVE_WRAPPER_KEY}_{taken}",
                             [comfy.patcher_extension.PatcherInjection(inject=put_on, eject=take_off)])
        curve.add_row(strength, adapters)
        parts += len(hooks)
    return model, parts


def _patch_clip_only(clip, lora_sd: Any, strength_clip: float):
    """The CLIP half of a LoRA, applied as usual: the prompt is encoded once."""
    import comfy.lora
    import comfy.lora_convert

    key_map = comfy.lora.model_lora_keys_clip(clip.cond_stage_model, {})
    loaded = comfy.lora.load_lora(comfy.lora_convert.convert_lora(lora_sd), key_map, log_missing=False)
    clip = clip.clone()
    clip.add_patches(loaded, strength_clip)
    return clip


def apply_lora_stack(
    model, clip, rows: list[dict[str, Any]], on_missing: str = "error", missing: list | None = None,
    curve: list[float] | None = None,
):
    """Apply the enabled, non-zero rows in order and return (model, clip).

    In skip mode a row whose file cannot be found is warned about and left
    out; pass a list as ``missing`` to collect those rows, which is how the
    node keeps a LoRA that never loaded from adding its trigger words.

    With a ``curve`` (a schedule from _curve_helpers), a row marked to follow
    it is loaded in core's bypass mode and its strength moves with the curve
    step by step (``LoraCurve``). The row's CLIP half is applied as usual.
    """
    import comfy.sd

    follower = None
    effective = rows
    if curve is not None and any(row.get("curve") and row["enabled"] for row in rows):
        from ._curve_helpers import keyframe_plan

        plan = keyframe_plan(curve)
        if len(plan) == 1:
            # A flat curve is a plain strength: nothing to schedule.
            # Scaled copies; ``missing`` still gets the caller's own rows, which
            # the node matches by identity to keep a skipped row's words out.
            effective = [{**row, "strength": clamp_strength(row["strength"] * plan[0][1])}
                         if row.get("curve") else row for row in rows]
        else:
            follower = LoraCurve(curve)

    for given, row in zip(rows, effective):
        if not row["enabled"]:
            continue
        strength_clip = row["strength_clip"] if clip is not None else 0.0
        if row["strength"] == 0 and strength_clip == 0:
            continue
        try:
            path = resolve_lora_path(row["name"])
        except ValueError as exc:
            if on_missing != "skip":
                # Strict is the default: rendering without a LoRA the graph
                # asked for is worse than not rendering, above all for scripted
                # and agent-driven runs that would happily judge the result.
                raise ValueError(
                    f"LoRA Loader: '{row['name']}' - {exc} Stop on missing LoRA is on "
                    "(the default), so the run stopped instead of rendering without it. "
                    "Fix or remove the row, or turn 'Stop on missing LoRA' off in the "
                    "node's settings menu (the gear icon on the node) to warn and skip "
                    "instead; in API graphs that is on_missing: skip."
                )
            _warn_missing(row["name"], str(exc))
            if missing is not None:
                missing.append(given)
            continue
        try:
            lora_sd = _load_lora_file(path)
        except MemoryError:
            raise
        except Exception as exc:
            # ComfyUI can add the file's path; error_detail drops words that name one.
            detail = error_detail(exc)
            raise ValueError(
                unreadable_lora_message(row["name"], unreadable_lora_reason(path), detail)
            ) from exc
        if follower is not None and row.get("curve"):
            parts, known = 0, True
            if row["strength"] != 0:
                model, parts = _curve_row(model, lora_sd, row["strength"], follower)
            if strength_clip != 0:
                before = patch_total(None, clip)
                clip = _patch_clip_only(clip, lora_sd, strength_clip)
                after = patch_total(None, clip)
                if before is None or after is None:
                    known = False
                else:
                    parts += after - before
            if known and parts == 0:
                _warn_no_effect(row["name"], base_model_family(read_safetensors_metadata(path)))
            continue
        before = patch_total(model, clip)
        model, clip = comfy.sd.load_lora_for_models(
            model, clip, lora_sd, row["strength"], strength_clip
        )
        after = patch_total(model, clip)
        # Measured, not guessed: this holds for every model family, present
        # and future, and never fires on a LoRA that actually did something.
        if before is not None and after is not None and after == before:
            _warn_no_effect(row["name"], base_model_family(read_safetensors_metadata(path)))
    if follower is not None and follower.rows:
        from comfy.patcher_extension import WrappersMP

        model = model.clone()
        model.add_wrapper_with_key(WrappersMP.APPLY_MODEL, CURVE_WRAPPER_KEY, follower)
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
            + ("|curve" if row.get("curve") else "")
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
    """The standard Civitai metadata sidecar beside the LoRA file. Other
    tools write it, and so does this pack when the user clicks Fetch
    Civitai info (the browser does the lookup; this server never
    contacts Civitai)."""
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


def _hash_cache_path() -> Path | None:
    base = _user_store_dir()
    return None if base is None else base / "lora_hashes.json"


def file_sha256(path: Path) -> str:
    """SHA256 of the file, cached by (mtime, size) - LoRAs are hundreds of MB."""
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


def lora_sha256(name: str) -> str:
    """SHA256 of a LoRA file, for the browser's Civitai lookup."""
    return file_sha256(resolve_lora_path(name))


# A real answer is ~150 KB of JSON; this only stops absurd bodies.
MAX_CIVITAI_BYTES = 1024 * 1024


def _hashes_in(payload: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    files = payload.get("files")
    for entry in files if isinstance(files, list) else []:
        hashes = entry.get("hashes") if isinstance(entry, dict) else None
        value = hashes.get("SHA256") if isinstance(hashes, dict) else None
        if isinstance(value, str):
            found.add(value.strip().lower())
    return found


def save_civitai_sidecar(name: str, payload: Any) -> dict[str, Any]:
    """Save Civitai's answer beside the LoRA as the standard sidecar.

    The browser fetched the answer, so it is untrusted: it must be a JSON
    object of sane size, in the standard shape, and describe a file whose
    SHA256 is this LoRA's own. Only then is it written, to the fixed
    <model>.civitai.info name next to the resolved LoRA file.
    """
    if not isinstance(payload, dict):
        raise ValueError("Civitai response must be a JSON object.")
    if len(json.dumps(payload)) > MAX_CIVITAI_BYTES:
        raise ValueError("Civitai response is too large.")
    path = resolve_lora_path(name)
    if file_sha256(path).lower() not in _hashes_in(payload):
        raise ValueError("That Civitai answer is for a different file.")
    info = _normalize_civitai_info(payload)
    if not info:
        raise ValueError("That Civitai answer has no model information.")
    _atomic_write_json(_civitai_sidecar_path(name), payload)
    return info


# Civitai's preview picture, saved beside the LoRA so the hover preview finds
# it. The browser downloads it; this server only checks and writes it.
MAX_PICTURE_BYTES = 8 * 1024 * 1024
MAX_PICTURE_PIXELS = 40_000_000
PICTURE_EDGE = 768


def save_civitai_picture(name: str, data: bytes) -> Path:
    """Save a picture as <model>.preview.jpg next to the LoRA.

    The bytes come from the browser, so they are decoded here and written
    again as a small JPEG with no metadata. A LoRA that already has any
    preview picture keeps it: nothing is replaced, even in a race.
    """
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise ValueError("No picture was sent.")
    if len(data) > MAX_PICTURE_BYTES:
        raise ValueError("The picture is too large.")
    path = resolve_lora_path(name)
    if find_thumbnail(name) is not None:
        raise ValueError("This LoRA already has a preview picture.")
    from io import BytesIO

    from PIL import Image

    try:
        with Image.open(BytesIO(data)) as picture:
            width, height = picture.size
            if width * height > MAX_PICTURE_PIXELS:
                raise ValueError("The picture is too large.")
            picture = picture.convert("RGB")
            picture.thumbnail((PICTURE_EDGE, PICTURE_EDGE))
            out = BytesIO()
            picture.save(out, "JPEG", quality=88)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("That is not a picture.") from exc
    target = Path(str(path.with_suffix("")) + ".preview.jpg")
    try:
        with open(target, "xb") as handle:
            handle.write(out.getvalue())
    except FileExistsError as exc:
        raise ValueError("This LoRA already has a preview picture.") from exc
    return target


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
    from ._route_errors import safe_route_error

    @prompt_server.routes.get("/ausboss/lora/list")
    async def ausboss_lora_list(request):
        return web.json_response({"loras": list_loras()})

    @prompt_server.routes.get("/ausboss/lora/thumb")
    async def ausboss_lora_thumb(request):
        # A small copy of the picture, never the file itself: whatever a
        # preview's name leads to, only a picture decoded here is sent.
        thumb = find_thumbnail(request.query.get("name", ""))
        if thumb is None:
            return web.json_response({"error": "no preview image"}, status=404)
        try:
            from ._image_folder_helpers import thumbnail

            body = await asyncio_run_in_executor(thumbnail, thumb, THUMB_EDGE)
        except Exception:
            return web.json_response({"error": "no preview image"}, status=404)
        return web.Response(
            body=body, content_type="image/jpeg", headers={"Cache-Control": "max-age=3600"}
        )

    @prompt_server.routes.get("/ausboss/lora/info")
    async def ausboss_lora_info(request):
        try:
            info = await asyncio_run_in_executor(lora_info, request.query.get("name", ""))
            return web.json_response({"ok": True, "info": info})
        except Exception as exc:
            return web.json_response({"ok": False, "error": safe_route_error(exc)}, status=400)

    @prompt_server.routes.get("/ausboss/lora/hash")
    async def ausboss_lora_hash(request):
        try:
            sha = await asyncio_run_in_executor(lora_sha256, request.query.get("name", ""))
            return web.json_response({"ok": True, "sha256": sha})
        except Exception as exc:
            return web.json_response({"ok": False, "error": safe_route_error(exc)}, status=400)

    @prompt_server.routes.post("/ausboss/lora/civitai")
    async def ausboss_lora_civitai(request):
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("Request body must be a JSON object.")
            info = await asyncio_run_in_executor(
                save_civitai_sidecar, str(body.get("name", "")), body.get("info")
            )
            return web.json_response({"ok": True, "info": info})
        except Exception as exc:
            return web.json_response({"ok": False, "error": safe_route_error(exc)}, status=400)

    @prompt_server.routes.post("/ausboss/lora/picture")
    async def ausboss_lora_picture(request):
        try:
            if (request.content_length or 0) > MAX_PICTURE_BYTES:
                raise ValueError("The picture is too large.")
            data = await request.read()
            await asyncio_run_in_executor(
                save_civitai_picture, request.query.get("name", ""), data
            )
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"ok": False, "error": safe_route_error(exc)}, status=400)

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
            return web.json_response({"ok": False, "error": safe_route_error(exc)}, status=400)


async def asyncio_run_in_executor(func, *args):
    import asyncio

    return await asyncio.get_running_loop().run_in_executor(None, func, *args)
