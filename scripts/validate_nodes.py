#!/usr/bin/env python
"""Offline sanity checks for the node pack — no ComfyUI required.

Run from anywhere:  python scripts/validate_nodes.py

Checks:
  1. Every .py file in the pack compiles.
  2. Every nodes/node_*.py keeps the registry contract from
     scripts/registry_contract.py: both mappings assigned exactly once, at
     module level, to a dictionary literal with string-literal keys, never
     mutated afterwards, and carrying the same keys as each other. Registry
     scanners parse the source rather than importing it, so anything they
     cannot read statically makes the node invisible to them.
  3. Every module listed in NODE_MODULES in __init__.py has a file on
     disk, every node file is listed in NODE_MODULES (no orphans), and no
     mapping key is claimed by two modules.
  4. Permanent public node IDs exist once their modules are present, and
     each public transform node declares exactly IMAGE then MASK outputs.

Exit code 0 = all good, 1 = problems printed below.
"""

import ast
import pathlib
import py_compile
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from registry_contract import (
    class_mapping_keys,
    duplicate_key_problems,
    mapping_problems,
)

errors = []
warnings = []

PUBLIC_NODE_IDS = {
    "AUSBOSS_NODES_Compare",
    "AUSBOSS_NODES_CropForInpaint",
    "AUSBOSS_NODES_FrameChooser",
    "AUSBOSS_NODES_ImageCropRotatePad",
    "AUSBOSS_NODES_LaMaInpaint",
    "AUSBOSS_NODES_LoadVideo",
    "AUSBOSS_NODES_LoraLoader",
    "AUSBOSS_NODES_RefineMask",
    "AUSBOSS_NODES_SaveVideo",
    "AUSBOSS_NODES_SelectFrame",
    "AUSBOSS_NODES_SelectFrameRange",
    "AUSBOSS_NODES_VideoBundle",
    "AUSBOSS_NODES_VideoBundleEdit",
    "AUSBOSS_NODES_StitchInpaint",
    "AUSBOSS_NODES_VideoCropRotatePad",
    "AUSBOSS_NODES_VideoUnbundle",
}

# --- 1. everything compiles --------------------------------------------------
for path in sorted(ROOT.rglob("*.py")):
    if "__pycache__" in path.parts:
        continue
    try:
        py_compile.compile(str(path), doraise=True)
    except py_compile.PyCompileError as exc:
        errors.append(f"syntax error: {path.relative_to(ROOT)}\n    {exc.msg}")

# --- 2. the registry contract each node module must keep --------------------
node_files = sorted((ROOT / "nodes").glob("node_*.py"))
keys_by_module = {}
for path in node_files:
    source = path.read_text(encoding="utf-8")
    errors.extend(mapping_problems(source, path.name))
    keys_by_module[path.name] = class_mapping_keys(source)

# Two modules claiming one key is a silent drop: the last import wins.
errors.extend(duplicate_key_problems(keys_by_module))

# --- 3. NODE_MODULES list matches the files on disk --------------------------
init_text = (ROOT / "__init__.py").read_text(encoding="utf-8")
listed = set(re.findall(r'"(node_\w+)"', init_text))
on_disk = {path.stem for path in node_files}

for missing in sorted(listed - on_disk):
    errors.append(f"__init__.py lists {missing} but nodes/{missing}.py does not exist")
for orphan in sorted(on_disk - listed):
    warnings.append(f"nodes/{orphan}.py exists but is not listed in NODE_MODULES")

# --- 4. permanent transform contracts ---------------------------------------
mapping_keys = set()
for path in node_files:
    text = path.read_text(encoding="utf-8")
    mapping_keys.update(re.findall(r'"(AUSBOSS_NODES_\w+)"', text))
    if path.stem in {"node_image_crop_rotate_pad", "node_video_crop_rotate_pad"}:
        tree = ast.parse(text)
        return_types = None
        return_names = None
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {"RETURN_TYPES", "RETURN_NAMES"}:
                    try:
                        value = ast.literal_eval(node.value)
                    except Exception:
                        value = None
                    if target.id == "RETURN_TYPES":
                        return_types = value
                    else:
                        return_names = value
        if return_types != ("IMAGE", "MASK"):
            errors.append(f"{path.name}: RETURN_TYPES must be exactly ('IMAGE', 'MASK')")
        if return_names != ("image", "mask"):
            errors.append(f"{path.name}: RETURN_NAMES must be exactly ('image', 'mask')")

for missing_id in sorted(PUBLIC_NODE_IDS - mapping_keys):
    errors.append(f"missing permanent mapping key: {missing_id}")

# --- report ------------------------------------------------------------------
for warning in warnings:
    print(f"WARN  {warning}")
for error in errors:
    print(f"ERROR {error}")

if errors:
    print(f"\n{len(errors)} problem(s) found.")
    sys.exit(1)

print(f"OK - {len(node_files)} node file(s) validated.")
