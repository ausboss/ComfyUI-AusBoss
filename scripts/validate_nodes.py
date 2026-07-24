#!/usr/bin/env python
"""Offline sanity checks for the node pack — no ComfyUI required.

Run from anywhere:  python scripts/validate_nodes.py

Checks:
  1. Every .py file in the pack compiles.
  2. Every nodes/node_*.py defines NODE_CLASS_MAPPINGS and
     NODE_DISPLAY_NAME_MAPPINGS.
  3. Every module listed in NODE_MODULES in __init__.py has a file on
     disk, and every node file is listed in NODE_MODULES (no orphans).

Exit code 0 = all good, 1 = problems printed below.
"""

import ast
import pathlib
import py_compile
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
errors = []
warnings = []

# --- 1. everything compiles --------------------------------------------------
for path in sorted(ROOT.rglob("*.py")):
    if "__pycache__" in path.parts:
        continue
    try:
        py_compile.compile(str(path), doraise=True)
    except py_compile.PyCompileError as exc:
        errors.append(f"syntax error: {path.relative_to(ROOT)}\n    {exc.msg}")

# --- 2. node files export their mappings -------------------------------------
node_files = sorted((ROOT / "nodes").glob("node_*.py"))
for path in node_files:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    assigned = {
        target.id
        for node in ast.walk(tree)
        for target in getattr(node, "targets", [])
        if isinstance(target, ast.Name)
    }
    for required in ("NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"):
        if required not in assigned:
            errors.append(f"{path.name}: missing {required}")

# --- 3. NODE_MODULES list matches the files on disk --------------------------
init_text = (ROOT / "__init__.py").read_text(encoding="utf-8")
listed = set(re.findall(r'"(node_\w+)"', init_text))
on_disk = {path.stem for path in node_files}

for missing in sorted(listed - on_disk):
    errors.append(f"__init__.py lists {missing} but nodes/{missing}.py does not exist")
for orphan in sorted(on_disk - listed):
    warnings.append(f"nodes/{orphan}.py exists but is not listed in NODE_MODULES")

# --- report ------------------------------------------------------------------
for warning in warnings:
    print(f"WARN  {warning}")
for error in errors:
    print(f"ERROR {error}")

if errors:
    print(f"\n{len(errors)} problem(s) found.")
    sys.exit(1)

print(f"OK - {len(node_files)} node file(s) validated.")
