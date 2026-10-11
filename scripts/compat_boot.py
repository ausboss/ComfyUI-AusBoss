#!/usr/bin/env python3
"""Check a running ComfyUI that has the pack: every node is offered, and every
example workflow still fits the nodes this ComfyUI has.

    python scripts/compat_boot.py --url http://127.0.0.1:8188 [--log comfyui.log]

It asks the server what nodes it offers (GET /object_info) and compares:

1. Every public node of the pack is there (the list in validate_nodes.py).
2. For every node in every example workflow, subgraphs included: this
   ComfyUI offers a node of that type, and the example gives a value or a
   socket for each input the node requires today. A core node that was
   renamed, dropped, or given a new required input shows up here by name.
3. With --log: the pack's banner in ComfyUI's log names no module that
   failed to load.

Nothing is queued and no model is loaded. Standard library only; it talks to
the address it is given and nothing else. Exit code 1 lists the problems.
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
# Node types the page draws by itself; the server does not list them.
FRONTEND_ONLY = {"Note", "MarkdownNote", "PrimitiveNode", "Reroute"}
SUBGRAPH = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def public_node_ids() -> set[str]:
    """PUBLIC_NODE_IDS, read out of validate_nodes.py without running it."""
    tree = ast.parse((ROOT / "scripts" / "validate_nodes.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "PUBLIC_NODE_IDS" for target in node.targets):
            return set(ast.literal_eval(node.value))
    raise ValueError("validate_nodes.py has no PUBLIC_NODE_IDS")


def example_nodes(data: dict):
    """(where, node) for every node of a workflow, subgraphs included."""
    for node in data.get("nodes") or []:
        yield "", node
    for graph in (data.get("definitions") or {}).get("subgraphs") or []:
        for node in graph.get("nodes") or []:
            yield f" in subgraph '{graph.get('name') or graph.get('id')}'", node


def given_names(node: dict) -> set[str]:
    """The inputs a saved node has a socket or a named value for."""
    names = {entry.get("name") for entry in node.get("inputs") or [] if isinstance(entry, dict)}
    named = node.get("widgets_values_named")
    if isinstance(named, dict):
        names.update(named)
    return {name for name in names if name}


def required_of(info: dict, name: str):
    return ((info.get("input") or {}).get("required") or {}).get(name)


def _grows(spec) -> bool:
    """True for an input whose sockets are made as links are added."""
    kind = spec[0] if isinstance(spec, (list, tuple)) and spec else spec
    return isinstance(kind, str) and ("AUTOGROW" in kind or "DYNAMIC" in kind)


def example_problems(directory: Path, offered: dict) -> list[str]:
    problems = []
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            problems.append(f"{path.name}: cannot be read ({exc})")
            continue
        if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
            continue
        for where, node in example_nodes(data):
            kind = str(node.get("type"))
            if kind in FRONTEND_ONLY or SUBGRAPH.match(kind):
                continue
            info = offered.get(kind)
            if info is None:
                problems.append(f"{path.name}: this ComfyUI has no node '{kind}' (#{node.get('id')}{where})")
                continue
            required = set((info.get("input") or {}).get("required") or {})
            # A saved node without named values (an older save) cannot be
            # checked by name; its sockets alone would raise false alarms.
            if not isinstance(node.get("widgets_values_named"), dict) and node.get("widgets_values"):
                continue
            given = given_names(node)
            # An input that grows (values.a, values.b, ...) is saved under
            # its parts' names, and may have none of them filled.
            roots = given | {name.split(".", 1)[0] for name in given}
            for name in sorted(required - roots):
                if _grows(required_of(info, name)):
                    continue
                problems.append(f"{path.name}: '{kind}' (#{node.get('id')}{where}) now requires '{name}', and the example has no value for it")
    return problems


def log_problems(text: str) -> list[str]:
    problems = []
    for line in text.splitlines():
        plain = re.sub(r"\x1b\[[0-9;]*m", "", line)
        if "Failed to load:" in plain:
            problems.append("the pack's banner says: " + plain.strip())
        elif "IMPORT FAILED" in plain and "ausboss" in plain.lower():
            problems.append("ComfyUI's log says: " + plain.strip())
    return problems


def fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--url", default="http://127.0.0.1:8188", help="the ComfyUI to ask")
    parser.add_argument("--log", help="ComfyUI's log file, to read the pack's banner from")
    args = parser.parse_args(argv)
    base = args.url.rstrip("/")
    try:
        stats = fetch(base + "/system_stats")
        offered = fetch(base + "/object_info")
    except (OSError, ValueError, urllib.error.URLError) as exc:
        print(f"ERROR could not ask {base}: {exc}")
        return 1
    system = stats.get("system") or {}
    print(f"ComfyUI {system.get('comfyui_version', '?')}, frontend {system.get('required_frontend_version', '?')}, {len(offered)} nodes offered.")

    problems = [f"the pack's node '{key}' is not offered" for key in sorted(public_node_ids() - set(offered))]
    problems += example_problems(ROOT / "example_workflows", offered)
    if args.log:
        try:
            problems += log_problems(Path(args.log).read_text(encoding="utf-8", errors="replace"))
        except OSError as exc:
            problems.append(f"could not read the log {args.log}: {exc}")
    for problem in problems:
        print("ERROR " + problem)
    if problems:
        print(f"\n{len(problems)} problem(s) found.")
        return 1
    print("OK - every public node is offered and every example fits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
