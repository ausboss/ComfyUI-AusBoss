"""Offline checks for the saved example graphs (no ComfyUI dependency)."""

from __future__ import annotations

import json
import re
from pathlib import Path

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# Below this saved zoom the frontend stops drawing widget text (about 0.57 on
# a standard display), so an example would open as unreadable boxes.
MIN_ZOOM = 0.6
# Where each save node keeps its filename prefix in a positional save.
PREFIX_SLOT = {"AUSBOSS_NODES_SaveImage": 0, "AUSBOSS_NODES_SaveVideo": 1}


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
    if isinstance(values, dict):
        pairs = [(key, named[key], values[key]) for key in named if key in values]
    elif isinstance(values, list):
        # Panel widgets the frontend saves as "" have no positional twin.
        keys = [key for key in named if not (key.startswith("ausboss_") and named[key] in ("", None))]
        pairs = [(key, named[key], value) for key, value in zip(keys, values)]
    else:
        return []
    stale = [key for key, saved, loaded in pairs if saved != loaded]
    return [f"node {node['id']} has stale named widget values: {', '.join(stale)}"] if stale else []


def workflow_problems(data: dict) -> list[str]:
    problems = []
    nodes = data.get("nodes", [])
    if not isinstance(nodes, list) or not nodes:
        return ["expected a nonempty UI workflow nodes list"]
    by_id = {n["id"]: n for n in nodes}
    if len(by_id) != len(nodes):
        problems.append("duplicate node ids")
    links = data.get("links", [])
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
        elif inputs[target_slot].get("link") != ident:
            problems.append(f"link {ident} is missing from its target input")
    for n in nodes:
        for slot, inp in enumerate(n.get("inputs", [])):
            ident = inp.get("link")
            if ident is not None and (ident not in by_link or by_link[ident][3:5] != [n["id"], slot]):
                problems.append(f"node {n['id']} input {slot} has a stale link")
        for slot, output in enumerate(n.get("outputs", [])):
            for ident in output.get("links") or []:
                if ident not in by_link or by_link[ident][1:3] != [n["id"], slot]:
                    problems.append(f"node {n['id']} output {slot} has a stale link")
    if data.get("last_node_id", -1) < max(by_id):
        problems.append("last_node_id is behind the graph")
    if by_link and data.get("last_link_id", -1) < max(by_link):
        problems.append("last_link_id is behind the graph")

    ident = data.get("id")
    if ident is not None and (not isinstance(ident, str) or not UUID.fullmatch(ident) or not ident.strip("0-")):
        problems.append("workflow id must be absent or a random UUID")
    scale = (data.get("extra") or {}).get("ds", {}).get("scale")
    if isinstance(scale, (int, float)) and scale < MIN_ZOOM:
        problems.append(f"saved zoom {scale} is below {MIN_ZOOM}; widget text would not draw")
    for n in nodes:
        problems.extend(named_copy_problems(n))
        selected = selected_files(n)
        for model in (n.get("properties") or {}).get("models") or []:
            name = model.get("name") if isinstance(model, dict) else None
            if name and name not in selected:
                problems.append(f"node {n['id']} carries download info for {name}, which it does not select")
        if n["type"] in PREFIX_SLOT:
            saved = n.get("widgets_values")
            prefix = saved.get("filename_prefix") if isinstance(saved, dict) else (
                saved[PREFIX_SLOT[n["type"]]] if isinstance(saved, list) and len(saved) > PREFIX_SLOT[n["type"]] else None)
            if isinstance(prefix, str) and "/" in prefix.replace("\\", "/"):
                problems.append(f"node {n['id']} saves into a folder ({prefix}); examples save to the output folder itself")

    groups = data.get("groups", [])
    if not groups:
        problems.append("no stage groups")
    notes = [n for n in nodes if n["type"] == "AUSBOSS_NODES_WorkflowNote"]
    if not notes:
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
        if n not in notes and not any(
            gx <= x and gy <= y - 30 and x + width <= gx + gw + 1 and y + height <= gy + gh + 1
            for gx, gy, gw, gh in (g["bounding"] for g in groups)
        ):
            problems.append(f"node {n['id']} is outside its stage group")
    for i, (ident, x0, y0, x1, y1) in enumerate(rectangles):
        for other, ox0, oy0, ox1, oy1 in rectangles[i + 1:]:
            if min(x1, ox1) > max(x0, ox0) + 1 and min(y1, oy1) > max(y0, oy0) + 1:
                problems.append(f"nodes {ident} and {other} overlap (including title bars)")
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
