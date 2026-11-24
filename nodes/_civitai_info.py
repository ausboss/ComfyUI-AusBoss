"""The Civitai line: an A1111-style ``parameters`` text for Save Image 🆎.

civitai.com reads a ComfyUI picture's prompt out of the embedded graph, and
only for the nodes it knows: a prompt typed into a node it does not know
(Krea 2 Encode 🆎, core's Qwen Image 2.1 encoder, a prompt inside a
subgraph) reads as no prompt at all, and the upload is flagged "Unable to
Verify AI Generation". It also never matches a ComfyUI picture's models,
because it matches models by file hash and the graph holds only file names.

This module writes the line A1111 puts in its pictures, which Civitai reads
first: the prompt, the sampler settings, and the model and LoRA hashes
(AutoV2, the first ten hex digits of the file's SHA256). It is built from the
run's own graph (the hidden PROMPT input), walking up from the save node, so
a second sampler on another branch is not mistaken for this picture's.

Everything here is best effort and never raises into a save: a graph it
cannot read gives no line, and the file saves as it always did.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

# How far a walk follows links before it gives up (cycles, odd graphs).
MAX_DEPTH = 40

# Inputs that hold a prompt's words, in the order they are tried.
TEXT_KEYS = ("text", "prompt", "populated_text", "text_g", "string", "value")
# Inputs that pass conditioning through from an earlier node.
CONDITIONING_KEYS = ("conditioning", "conditioning_1", "conditioning_to", "cond", "positive")

# Which model folder each loader input names a file in. Text encoders, VAEs
# and the like are left out: Civitai never credits a picture to one.
MODEL_KEYS = {
    "ckpt_name": ("checkpoints",),
    "unet_name": ("diffusion_models", "unet_gguf"),
}
LORA_FOLDERS = ("loras",)

LORA_LOADER = "AUSBOSS_NODES_LoraLoader"


def _is_link(value: Any) -> bool:
    return (
        isinstance(value, list) and len(value) == 2
        and isinstance(value[0], (str, int)) and isinstance(value[1], int)
    )


class _Graph:
    def __init__(self, prompt: dict):
        self.nodes = {str(key): node for key, node in prompt.items() if isinstance(node, dict)}

    def node(self, link) -> dict | None:
        return self.nodes.get(str(link[0])) if _is_link(link) else None

    @staticmethod
    def inputs(node: dict | None) -> dict:
        values = (node or {}).get("inputs")
        return values if isinstance(values, dict) else {}

    def upstream(self, start: str | None) -> list[str]:
        """Node ids feeding ``start``, nearest first (breadth first)."""
        if start is None or str(start) not in self.nodes:
            return list(self.nodes)
        order: list[str] = []
        seen = {str(start)}
        queue = [str(start)]
        while queue:
            current = queue.pop(0)
            for value in self.inputs(self.nodes.get(current)).values():
                if _is_link(value) and str(value[0]) in self.nodes and str(value[0]) not in seen:
                    seen.add(str(value[0]))
                    order.append(str(value[0]))
                    queue.append(str(value[0]))
        return order

    def literal(self, value: Any, keys: tuple[str, ...], depth: int = 0):
        """A typed value, or the value a linked primitive node holds."""
        if not _is_link(value):
            return value
        if depth > MAX_DEPTH:
            return None
        inputs = self.inputs(self.node(value))
        for key in keys:
            if key in inputs:
                return self.literal(inputs[key], keys, depth + 1)
        return None

    def words(self, value: Any, depth: int = 0) -> str | None:
        """The text a STRING input carries: typed, or from a text node."""
        if isinstance(value, str):
            return value
        if not _is_link(value) or depth > MAX_DEPTH:
            return None
        inputs = self.inputs(self.node(value))
        for key in TEXT_KEYS:
            if key in inputs:
                found = self.words(inputs[key], depth + 1)
                if found is not None:
                    return found
        if "string_a" in inputs or "string_b" in inputs:
            parts = [self.words(inputs.get(key), depth + 1) for key in ("string_a", "string_b")]
            delimiter = inputs.get("delimiter") if isinstance(inputs.get("delimiter"), str) else ""
            return delimiter.join(part for part in parts if part)
        return None

    def conditioning_text(self, link: Any, depth: int = 0) -> str | None:
        """The prompt behind a CONDITIONING link, through encoders and the
        nodes that pass conditioning on (ControlNet, guidance, inpaint)."""
        node = self.node(link)
        if node is None or depth > MAX_DEPTH:
            return None
        inputs = self.inputs(node)
        slot = link[1]
        # An encoder with both prompts (Krea 2 Encode 🆎, Qwen Image 2.1):
        # its second output is the negative.
        if "negative_prompt" in inputs and slot == 1:
            return self.words(inputs["negative_prompt"])
        for key in TEXT_KEYS[:4]:
            if key in inputs:
                found = self.words(inputs[key])
                if found is not None:
                    return found
        # A node that takes and returns a positive/negative pair.
        if _is_link(inputs.get("positive")) and _is_link(inputs.get("negative")):
            return self.conditioning_text(inputs["negative" if slot == 1 else "positive"], depth + 1)
        for key in CONDITIONING_KEYS:
            if _is_link(inputs.get(key)):
                return self.conditioning_text(inputs[key], depth + 1)
        return None


def _sampler(graph: _Graph, order: list[str]) -> dict | None:
    """The settings of the nearest sampler upstream of the save node."""
    for node_id in order:
        node = graph.nodes[node_id]
        inputs = graph.inputs(node)
        settings: dict[str, Any] = {}
        if "positive" in inputs and "negative" in inputs and ("steps" in inputs or "sigmas" in inputs):
            # KSampler, KSamplerAdvanced, SamplerCustom and look-alikes.
            positive, negative = inputs["positive"], inputs["negative"]
            settings["seed"] = graph.literal(inputs.get("seed", inputs.get("noise_seed")), ("seed", "noise_seed", "value", "int"))
            settings["cfg"] = graph.literal(inputs.get("cfg"), ("cfg", "value", "float"))
            settings["sampler"] = graph.literal(inputs.get("sampler_name"), ("sampler_name", "value"))
            settings["scheduler"] = graph.literal(inputs.get("scheduler"), ("scheduler", "value"))
            settings["steps"] = graph.literal(inputs.get("steps"), ("steps", "value", "int"))
            settings["denoise"] = graph.literal(inputs.get("denoise"), ("denoise", "value", "float"))
            sampler_link, sigmas_link = inputs.get("sampler"), inputs.get("sigmas")
            model_link = inputs.get("model")
        elif "guider" in inputs and ("sigmas" in inputs or "noise" in inputs):
            # SamplerCustomAdvanced: the settings sit on the nodes it takes.
            guider = graph.inputs(graph.node(inputs["guider"]))
            if "positive" in guider:
                positive, negative = guider.get("positive"), guider.get("negative")
            else:
                positive, negative = guider.get("conditioning"), None
            settings["cfg"] = graph.literal(guider.get("cfg"), ("cfg", "value", "float"))
            noise = graph.inputs(graph.node(inputs.get("noise")))
            settings["seed"] = graph.literal(noise.get("noise_seed", noise.get("seed")), ("noise_seed", "seed", "value", "int"))
            sampler_link, sigmas_link = inputs.get("sampler"), inputs.get("sigmas")
            model_link = guider.get("model")
        else:
            continue
        sampler_inputs = graph.inputs(graph.node(sampler_link))
        if settings.get("sampler") is None and "sampler_name" in sampler_inputs:
            settings["sampler"] = graph.literal(sampler_inputs["sampler_name"], ("sampler_name", "value"))
        sigmas = graph.inputs(graph.node(sigmas_link))
        for key in ("steps", "scheduler", "denoise"):
            if settings.get(key) is None and key in sigmas:
                settings[key] = graph.literal(sigmas[key], (key, "value"))
        settings["positive"] = graph.conditioning_text(positive) or ""
        settings["negative"] = graph.conditioning_text(negative) or ""
        settings["model_link"] = model_link
        settings["latent_link"] = inputs.get("latent_image")
        return settings
    return None


def _lora_rows(graph: _Graph, node: dict) -> list[tuple[str, Any]]:
    """(file name, strength) of every LoRA a loader node applies."""
    inputs = graph.inputs(node)
    rows: list[tuple[str, Any]] = []
    if node.get("class_type") == LORA_LOADER and isinstance(inputs.get("loras"), str):
        try:
            from ._lora_helpers import parse_lora_stack

            for row in parse_lora_stack(inputs["loras"]):
                if row["enabled"] and row["strength"]:
                    rows.append((row["name"], row["strength"]))
        except Exception:
            pass
        return rows
    if isinstance(inputs.get("lora_name"), str):
        strength = graph.literal(inputs.get("strength_model", inputs.get("strength", 1.0)), ("value", "float"))
        if strength != 0:
            rows.append((inputs["lora_name"], strength))
    # Stack loaders that keep one entry per row: {"on", "lora", "strength"}.
    for value in inputs.values():
        if isinstance(value, dict) and isinstance(value.get("lora"), str) and value.get("on", True):
            if value.get("strength", 1.0) != 0:
                rows.append((value["lora"], value.get("strength", 1.0)))
    return [(name, strength) for name, strength in rows if name and name.lower() != "none"]


def _starts_from_a_picture(graph: _Graph, latent_link: Any, denoise: Any) -> bool:
    """True when the sampler reworks an existing picture rather than noise."""
    if isinstance(denoise, (int, float)) and denoise < 1:
        return True
    start = graph.node(latent_link)
    if start is None:
        return False
    first = str(latent_link[0])
    for node_id in [first] + graph.upstream(first):
        kind = str(graph.nodes[node_id].get("class_type", ""))
        if "VAEEncode" in kind or "Inpaint" in kind:
            return True
    return False


def _short_name(name: str) -> str:
    return Path(str(name).replace("\\", "/")).stem


def _quote(value: str) -> str:
    """An A1111 value: quoted when a comma, colon or quote would split it."""
    return json.dumps(value) if any(mark in value for mark in ',:"\n') else value


def civitai_parameters(
    prompt: dict | None,
    save_node_id: str | None,
    width: int,
    height: int,
    find_file: Callable[[tuple[str, ...], str], Path | None],
    file_hash: Callable[[Path], str],
) -> str | None:
    """The A1111-style line for one save, or None when the graph holds no
    sampler to describe. ``find_file(folders, name)`` resolves a model file;
    ``file_hash(path)`` returns its SHA256 (cached by the caller)."""
    if not isinstance(prompt, dict):
        return None
    try:
        graph = _Graph(prompt)
        order = graph.upstream(save_node_id)
        settings = _sampler(graph, order)
        if settings is None or settings.get("steps") is None:
            return None

        def autov2(folders, name) -> str | None:
            try:
                path = find_file(folders, name)
                return file_hash(path)[:10] if path is not None else None
            except Exception:
                return None

        # Models and LoRAs are looked for up the sampler's model input, so a
        # loader that only feeds another branch (a mask model, an upscaler
        # pass) is not credited; a graph without that link falls back to
        # everything upstream of the save.
        model_node = graph.node(settings["model_link"])
        model_order = order
        if model_node is not None:
            start = str(settings["model_link"][0])
            model_order = [start] + graph.upstream(start)
        model_name = model_hash = None
        loras: list[tuple[str, Any, str]] = []
        seen_loras: set[str] = set()
        for node_id in model_order:
            node = graph.nodes[node_id]
            inputs = graph.inputs(node)
            if model_name is None:
                for key, folders in MODEL_KEYS.items():
                    name = inputs.get(key)
                    if isinstance(name, str) and name:
                        model_name, model_hash = name, autov2(folders, name)
                        break
            for name, strength in _lora_rows(graph, node):
                if name in seen_loras:
                    continue
                seen_loras.add(name)
                found = autov2(LORA_FOLDERS, name)
                if found:
                    loras.append((name, strength, found))

        if not settings["positive"].strip() and not model_hash and not loras:
            return None
        lines = [settings["positive"].strip()]
        if settings["negative"].strip():
            lines.append("Negative prompt: " + settings["negative"].strip())
        details = [f"Steps: {settings['steps']}"]
        for label, key in (("Sampler", "sampler"), ("Schedule type", "scheduler"), ("CFG scale", "cfg"), ("Seed", "seed")):
            value = settings.get(key)
            if value is not None and not _is_link(value):
                details.append(f"{label}: {_quote(str(value))}")
        details.append(f"Size: {int(width)}x{int(height)}")
        hashes: dict[str, str] = {}
        if model_name:
            if model_hash:
                details.append(f"Model hash: {model_hash}")
                hashes["model"] = model_hash
            details.append(f"Model: {_quote(_short_name(model_name))}")
        denoise = settings.get("denoise")
        if isinstance(denoise, (int, float)) and denoise < 1:
            details.append(f"Denoising strength: {denoise}")
        if loras:
            listed = ", ".join(f"{_short_name(name)}: {digest}" for name, _strength, digest in loras)
            details.append(f"Lora hashes: {json.dumps(listed)}")
            for name, _strength, digest in loras:
                hashes[f"lora:{_short_name(name)}"] = digest
        if hashes:
            details.append("Hashes: " + json.dumps(hashes, separators=(",", ":")))
        details.append("Version: ComfyUI")
        # Lower-case keys Civitai keeps as they are: "engine" tags the post
        # with the ComfyUI tool, "process" picks its technique.
        details.append("engine: ComfyUI")
        img2img = _starts_from_a_picture(graph, settings.get("latent_link"), denoise)
        details.append("process: " + ("img2img" if img2img else "txt2img"))
        lines.append(", ".join(details))
        return "\n".join(lines)
    except Exception:
        return None


__all__ = ["civitai_parameters"]
