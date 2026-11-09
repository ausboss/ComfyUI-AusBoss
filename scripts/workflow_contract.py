"""Offline checks for the saved example graphs (no ComfyUI dependency)."""

from __future__ import annotations

import ast
from functools import lru_cache
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from registry_contract import class_mapping_keys, registered_class

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# Below this saved zoom the frontend stops drawing widget text (about 0.57 on
# a standard display), so an example would open as unreadable boxes.
MIN_ZOOM = 0.6
# Where each save node keeps its filename prefix in a positional save.
PREFIX_SLOT = {"AUSBOSS_NODES_SaveImage": 0, "AUSBOSS_NODES_SaveVideo": 1}


# The pack ships its own LoRA Loader; examples show it off rather than the core
# loaders (its CLIP toggle covers the model-only case).
CORE_LORA_LOADERS = {"LoraLoader", "LoraLoaderModelOnly"}

# Serialized widget slots for the core/frontend nodes used by the examples.
# Keep this independent of each saved object's named-copy insertion order.
CORE_WIDGETS = {
    "UNETLoader": "unet_name weight_dtype",
    "CLIPLoader": "clip_name type device",
    "DualCLIPLoader": "clip_name1 clip_name2 type device",
    "VAELoader": "vae_name",
    "CheckpointLoaderSimple": "ckpt_name",
    "MarkdownNote": "text",
    "Note": "text",
    "ImageScaleToMaxDimension": "upscale_method largest_size",
    "TextGenerate": "prompt max_length sampling_mode sampling_mode.temperature sampling_mode.top_k sampling_mode.top_p sampling_mode.min_p sampling_mode.repetition_penalty sampling_mode.seed sampling_mode.presence_penalty thinking use_default_template mtp",
    "StringConcatenate": "string_a string_b delimiter",
    "StringFormat": "f_string",
    "CLIPTextEncode": "text",
    "KSampler": "seed control_after_generate steps cfg sampler_name scheduler denoise",
    "LoadImage": "image upload",
    "EmptyImage": "width height batch_size color",
    "ImageCompositeMasked": "x y resize_source",
    "GrowMask": "expand tapered_corners",
    "LTXVPreprocess": "img_compression",
    "LTXVConditioning": "frame_rate",
    "EmptyLTXVLatentVideo": "width height length batch_size",
    "LTXVAddGuide": "frame_idx strength",
    "VAEDecodeTiled": "tile_size overlap temporal_size temporal_overlap",
    "TextEncodeQwenImage21": "prompt negative_prompt resolution",
    "QwenImage21Cache": "device dtype",
    "SAM3_Detect": "threshold refine_iterations individual_masks",
}


@lru_cache(maxsize=1)
def pack_widget_names() -> dict[str, list[str]]:
    """Read the pack's widget order without importing any node or library."""
    result = {}
    for path in sorted((Path(__file__).resolve().parent.parent / "nodes").glob("node_*.py")):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for key in class_mapping_keys(source):
            cls = registered_class(tree, key)
            if cls is None:
                continue
            names = []
            upload = False
            for fn in cls.body:
                if not isinstance(fn, ast.FunctionDef) or fn.name != "INPUT_TYPES":
                    continue
                returned = [n.value for n in ast.walk(fn) if isinstance(n, ast.Return)]
                if len(returned) != 1 or not isinstance(returned[0], ast.Dict):
                    continue
                groups = {k.value: v for k, v in zip(returned[0].keys, returned[0].values) if isinstance(k, ast.Constant)}
                for group in ("required", "optional"):
                    inputs = groups.get(group)
                    if not isinstance(inputs, ast.Dict):
                        continue
                    for name, spec in zip(inputs.keys, inputs.values):
                        if not isinstance(name, ast.Constant) or not isinstance(spec, ast.Tuple) or not spec.elts:
                            continue
                        kind = spec.elts[0]
                        options = spec.elts[1] if len(spec.elts) > 1 else None
                        flags = {k.value: v.value for k, v in zip(options.keys, options.values)
                                 if isinstance(k, ast.Constant) and isinstance(v, ast.Constant)} if isinstance(options, ast.Dict) else {}
                        primitive = isinstance(kind, ast.Constant) and kind.value in ("INT", "FLOAT", "BOOLEAN", "STRING")
                        combo = isinstance(kind, (ast.List, ast.Call)) or isinstance(kind, ast.Name) and kind.id != "WILDCARD"
                        if flags.get("forceInput") or not (primitive or combo):
                            continue
                        names.append(name.value)
                        if flags.get("control_after_generate"):
                            names.append("control_after_generate")
                        if flags.get("image_upload") or flags.get("video_upload") or flags.get("audio_upload"):
                            upload = True
            if upload:
                names.append("upload")
            result[key] = names
    return result


def serialized_widget_names(node: dict) -> list[str] | None:
    kind = node.get("type")
    if kind in CORE_WIDGETS:
        return CORE_WIDGETS[kind].split()
    if kind in pack_widget_names():
        return pack_widget_names()[kind]
    if isinstance(kind, str) and UUID.fullmatch(kind):
        return [entry["widget"]["name"] for entry in node.get("inputs", []) if isinstance(entry.get("widget"), dict)]
    return None


def widget_value_list(node: dict) -> list:
    values = node.get("widgets_values")
    if isinstance(values, dict):
        return list(values.values())
    return values if isinstance(values, list) else []


def selected_files(node: dict) -> set[str]:
    """Every file name a node selects: its string widget values, plus the rows
    of a LoRA Loader stack, which saves them as one JSON string."""
    names = set()
    for value in widget_value_list(node):
        if not isinstance(value, str):
            continue
        names.add(value)
        if value.startswith("["):
            try:
                rows = json.loads(value)
            except ValueError:
                continue
            names.update(row["name"] for row in rows if isinstance(row, dict) and isinstance(row.get("name"), str))
    return names


def named_copy_problems(node: dict) -> list[str]:
    """The frontend saves widget values by position and again by name, and
    restores by name when its experimental setting is on: a stale named copy
    loads different values than the ones the example was tested with."""
    named = node.get("widgets_values_named")
    values = node.get("widgets_values")
    if not isinstance(named, dict):
        return []
    placeholders = {key for key, value in named.items() if key.startswith("ausboss_") and value in ("", None)}
    keys = set(named) - placeholders
    if isinstance(values, dict):
        # Upload buttons and old panels can have an empty named value even
        # though the frontend does not serialize them into the primary copy.
        if "upload" not in values:
            keys.discard("upload")
        pairs = [(key, named[key], values[key]) for key in named if key in values]
        unmatched = keys ^ set(values)
    elif isinstance(values, list):
        slots = serialized_widget_names(node)
        if slots is None:
            return [f"node {node['id']} has no known serialized widget slot mapping"]
        last = max((slots.index(key) for key in keys if key in slots), default=-1) + 1
        unmatched = keys - set(slots)
        unmatched.update(key for index, key in enumerate(slots[:last]) if key not in keys or index >= len(values))
        pairs = [(key, named[key], values[index]) for index, key in enumerate(slots)
                 if key in keys and index < len(values)]
        trailing = values[last:]
        if len(trailing) > len(placeholders) or any(value not in ("", None) for value in trailing):
            unmatched.add("extra positional values")
    else:
        return [f"node {node['id']} has named widgets without serialized values"]
    stale = [key for key, saved, loaded in pairs if saved != loaded]
    problems = [f"node {node['id']} has stale named widget values: {', '.join(stale)}"] if stale else []
    if unmatched:
        problems.append(f"node {node['id']} has unmatched widget values: {', '.join(sorted(unmatched))}")
    return problems


def workflow_problems(data: dict, *, _subgraph: bool = False) -> list[str]:
    problems = []
    nodes = data.get("nodes", [])
    if not isinstance(nodes, list) or not nodes:
        return ["expected a nonempty UI workflow nodes list"]
    by_id = {n["id"]: n for n in nodes}
    if len(by_id) != len(nodes):
        problems.append("duplicate node ids")
    if _subgraph:
        # Boundary nodes are stored separately, with their sockets on the
        # graph itself. Treat them like nodes for the same link checks.
        by_id[data["inputNode"]["id"]] = {
            "id": data["inputNode"]["id"],
            "outputs": [{"links": entry.get("linkIds", [])} for entry in data.get("inputs", [])],
        }
        by_id[data["outputNode"]["id"]] = {
            "id": data["outputNode"]["id"],
            "inputs": [{"boundary_links": entry.get("linkIds", [])} for entry in data.get("outputs", [])],
        }
    links = data.get("links", [])
    if _subgraph:
        fields = ("id", "origin_id", "origin_slot", "target_id", "target_slot", "type")
        links = [[link[key] for key in fields] if isinstance(link, dict) and all(key in link for key in fields) else link for link in links]
    by_link = {link[0]: link for link in links if isinstance(link, list) and len(link) == 6}
    if len(by_link) != len(links):
        problems.append("duplicate or malformed links (expected six fields)")
    for link in by_link.values():
        ident, source_id, source_slot, target_id, target_slot, _kind = link
        source, target = by_id.get(source_id), by_id.get(target_id)
        if source is None or target is None:
            problems.append(f"link {ident} refers to a missing node")
            continue
        outputs, inputs = source.get("outputs", []), target.get("inputs", [])
        if not isinstance(source_slot, int) or not 0 <= source_slot < len(outputs):
            problems.append(f"link {ident} has an invalid source slot")
        elif ident not in (outputs[source_slot].get("links") or []):
            problems.append(f"link {ident} is missing from its source output")
        if not isinstance(target_slot, int) or not 0 <= target_slot < len(inputs):
            problems.append(f"link {ident} has an invalid target slot")
        elif ident not in inputs[target_slot].get("boundary_links", [inputs[target_slot].get("link")]):
            problems.append(f"link {ident} is missing from its target input")
    for n in by_id.values():
        for slot, inp in enumerate(n.get("inputs", [])):
            for ident in inp.get("boundary_links", [inp.get("link")]):
                if ident is not None and (ident not in by_link or by_link[ident][3:5] != [n["id"], slot]):
                    problems.append(f"node {n['id']} input {slot} has a stale link")
        for slot, output in enumerate(n.get("outputs", [])):
            for ident in output.get("links") or []:
                if ident not in by_link or by_link[ident][1:3] != [n["id"], slot]:
                    problems.append(f"node {n['id']} output {slot} has a stale link")
    counters = data.get("state", {}) if _subgraph else data
    if counters.get("lastNodeId" if _subgraph else "last_node_id", -1) < max(by_id):
        problems.append("last_node_id is behind the graph")
    if by_link and counters.get("lastLinkId" if _subgraph else "last_link_id", -1) < max(by_link):
        problems.append("last_link_id is behind the graph")

    ident = data.get("id")
    if ident is not None and (not isinstance(ident, str) or not UUID.fullmatch(ident) or not ident.strip("0-")):
        problems.append("workflow id must be absent or a random UUID")
    scale = (data.get("extra") or {}).get("ds", {}).get("scale")
    if isinstance(scale, (int, float)) and scale < MIN_ZOOM:
        problems.append(f"saved zoom {scale} is below {MIN_ZOOM}; widget text would not draw")
    for n in nodes:
        problems.extend(named_copy_problems(n))
        if n["type"] in CORE_LORA_LOADERS:
            problems.append(f"node {n['id']} loads a LoRA with core {n['type']}; examples use LoRA Loader 🆎")
        selected = selected_files(n)
        for model in (n.get("properties") or {}).get("models") or []:
            name = model.get("name") if isinstance(model, dict) else None
            if not isinstance(model, dict) or any(not isinstance(model.get(key), str) or not model[key].strip() for key in ("name", "url", "directory")):
                problems.append(f"node {n['id']} download info needs nonempty name, url and directory strings")
                continue
            if name and name not in selected:
                problems.append(f"node {n['id']} carries download info for {name}, which it does not select")
            try:
                url = urlsplit(model["url"])
                valid_url = url.scheme in ("http", "https") and bool(url.netloc)
                filename = unquote(url.path.rsplit("/", 1)[-1])
            except ValueError:
                valid_url, filename = False, ""
            if not valid_url or filename != name:
                problems.append(f"node {n['id']} download URL must end with the selected filename {name}")
        if n["type"] in PREFIX_SLOT:
            saved = n.get("widgets_values")
            prefix = saved.get("filename_prefix") if isinstance(saved, dict) else (
                saved[PREFIX_SLOT[n["type"]]] if isinstance(saved, list) and len(saved) > PREFIX_SLOT[n["type"]] else None)
            if isinstance(prefix, str) and "/" in prefix.replace("\\", "/"):
                problems.append(f"node {n['id']} saves into a folder ({prefix}); examples save to the output folder itself")

    groups = data.get("groups", [])
    if not groups:
        problems.append("no stage groups")
    notes = [n for n in nodes if n["type"] in {"AUSBOSS_NODES_WorkflowNote", "AUSBOSS_NODES_WorkflowNoteTile"}]
    if not notes and not _subgraph:
        problems.append("no Workflow Note with setup instructions")
    for n in notes:
        try:
            note = json.loads(n["widgets_values"][0])
            if not note.get("title") or not note.get("body"):
                problems.append(f"note {n['id']} needs a title and instructions")
            if "\\n" in note.get("body", ""):
                problems.append(f"note {n['id']} contains escaped line breaks instead of Markdown lines")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            problems.append(f"note {n['id']} is not valid note JSON")

    note_columns = []
    for note in notes:
        size = note.get("size", [0, 0])
        note_width = size.get("0", 0) if isinstance(size, dict) else size[0]
        note_columns.append((note.get("pos", [0, 0])[0], note.get("pos", [0, 0])[0] + note_width))

    rectangles = []
    for n in nodes:
        size = n.get("size", [0, 0])
        if isinstance(size, dict):
            size = [size.get("0", 0), size.get("1", 0)]
        x, y = n.get("pos", [0, 0])
        width, height = size
        if width <= 0 or height <= 0:
            problems.append(f"node {n['id']} has no usable saved size")
        rectangles.append((n["id"], x, y - 30, x + width, y + height))
        # A Callout in the Workflow Note's own column belongs to the note, not
        # to a stage: a link to a video above it, say.
        beside_note = n["type"] in {"AUSBOSS_NODES_Callout", "AUSBOSS_NODES_CalloutTile"} and any(
            left <= x and x + width <= right + 1 for left, right in note_columns
        )
        if n not in notes and not beside_note and not any(
            gx <= x and gy <= y - 30 and x + width <= gx + gw + 1 and y + height <= gy + gh + 1
            for gx, gy, gw, gh in (g["bounding"] for g in groups)
        ):
            problems.append(f"node {n['id']} is outside its stage group")
    for i, (ident, x0, y0, x1, y1) in enumerate(rectangles):
        for other, ox0, oy0, ox1, oy1 in rectangles[i + 1:]:
            if min(x1, ox1) > max(x0, ox0) + 1 and min(y1, oy1) > max(y0, oy0) + 1:
                problems.append(f"nodes {ident} and {other} overlap (including title bars)")
    for graph in (data.get("definitions") or {}).get("subgraphs") or []:
        label = graph.get("name") or graph.get("id")
        problems.extend(f"subgraph {label}: {issue}" for issue in workflow_problems(graph, _subgraph=True))
    return problems


def example_problems(directory: Path) -> list[str]:
    problems = []
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            issues = workflow_problems(data)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            issues = [f"malformed saved workflow: {exc}"]
        problems.extend(f"{path.name}: {issue}" for issue in issues)
    return problems
