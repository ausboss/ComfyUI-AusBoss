"""Offline checks for the saved example graphs (no ComfyUI dependency)."""

from __future__ import annotations

import json
from pathlib import Path


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
