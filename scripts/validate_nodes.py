#!/usr/bin/env python
"""Offline sanity checks for the node pack — no ComfyUI required.

Run from anywhere:  python scripts/validate_nodes.py

Checks:
  1. Every .py file in the pack compiles.
  2. Every nodes/node_*.py keeps the registry contract from
     scripts/registry_contract.py: both mappings assigned exactly once, at
     module level, to a non-empty dictionary literal with string-literal
     keys, never mentioned again afterwards, and carrying the same keys as
     each other. Registry scanners parse the source rather than importing
     it, so anything they cannot read statically makes the node invisible.
  3. NODE_MODULES in __init__.py is parsed (not grepped) and matched
     against the files on disk both ways - a listed module with no file and
     a node file nobody imports are both errors - and no mapping key is
     claimed by two modules.
  5. No file outside nodes/ declares mapping keys. Registry scanners read
     the whole checkout, so a fixture or sample that names AUSBOSS_NODES_*
     in a mapping literal is advertised as an installable node.
  4. Permanent public node IDs are still registered - measured against the
     mapping keys parsed in check 2, not against the text of the file - and
     each public transform node declares exactly IMAGE then MASK outputs.

Exit code 0 = all good, 1 = problems printed below.
"""

import ast
import pathlib
import py_compile
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from registry_contract import (
    class_mapping_keys,
    duplicate_key_problems,
    mapping_problems,
    module_list,
)

errors = []
warnings = []

PUBLIC_NODE_IDS = {
    "AUSBOSS_NODES_AlignImage",
    "AUSBOSS_NODES_ColorMatch",
    "AUSBOSS_NODES_Compare",
    "AUSBOSS_NODES_CropForInpaint",
    "AUSBOSS_NODES_Float",
    "AUSBOSS_NODES_FrameInterpolate",
    "AUSBOSS_NODES_FreeMemory",
    "AUSBOSS_NODES_ImageCropRotatePad",
    "AUSBOSS_NODES_ImageResize",
    "AUSBOSS_NODES_ImageSize",
    "AUSBOSS_NODES_Integer",
    "AUSBOSS_NODES_Krea2Encode",
    "AUSBOSS_NODES_Krea2OutpaintModelPatch",
    "AUSBOSS_NODES_LaMaInpaint",
    "AUSBOSS_NODES_LmStudioChat",
    "AUSBOSS_NODES_LoadImagePad",
    "AUSBOSS_NODES_LoadVideo",
    "AUSBOSS_NODES_LoraLoader",
    "AUSBOSS_NODES_MathExpression",
    "AUSBOSS_NODES_MergeBatches",
    "AUSBOSS_NODES_RefineMask",
    "AUSBOSS_NODES_SaveVideo",
    "AUSBOSS_NODES_SelectEveryNth",
    "AUSBOSS_NODES_SelectFrame",
    "AUSBOSS_NODES_ShowText",
    "AUSBOSS_NODES_SplitBatch",
    "AUSBOSS_NODES_StitchInpaint",
    "AUSBOSS_NODES_Text",
    "AUSBOSS_NODES_VideoCropRotatePad",
}

# Ids from before the AUSBOSS_NODES_ convention. They stay registered forever
# so workflows already published against them keep loading - the Civitai one
# included. Held in their own set, not folded into PUBLIC_NODE_IDS, so the
# next person to read this list can tell "kept for compatibility" apart from
# "part of the current lineup" and does not tidy one away as a typo.
LEGACY_NODE_IDS = {
    "SimpleWatermarkRemover",
}

RELEASED_NODE_IDS = PUBLIC_NODE_IDS | LEGACY_NODE_IDS

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
# Parsed out of the list literal, not matched anywhere in the text: a name
# left behind in a comment used to satisfy this, and because an unlisted
# module was only a warning, forgetting to register a node exited 0 with
# nothing printed at all.
init_text = (ROOT / "__init__.py").read_text(encoding="utf-8")
listed = module_list(init_text)
on_disk = {path.stem for path in node_files}

if listed is None:
    errors.append(
        "__init__.py: NODE_MODULES must be a module-level list literal of "
        "module names; this checker reads it without importing the package"
    )
else:
    for missing in sorted(listed - on_disk):
        errors.append(f"__init__.py lists {missing} but nodes/{missing}.py does not exist")
    for orphan in sorted(on_disk - listed):
        # Not a warning: an unlisted module is never imported, so the node
        # simply does not exist in ComfyUI.
        errors.append(
            f"nodes/{orphan}.py is not listed in NODE_MODULES, so it is never imported"
        )

# --- 4. permanent transform contracts ---------------------------------------
# The keys parsed out of NODE_CLASS_MAPPINGS in check 2, not every
# AUSBOSS_NODES_* string in the file: a docstring, a comment or a search
# alias mentioning an id is not a registration, and matching those would let
# a node lose its mapping entry while this check kept passing.
mapping_keys = set().union(*keys_by_module.values()) if keys_by_module else set()
for path in node_files:
    text = path.read_text(encoding="utf-8")
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

for missing_id in sorted(RELEASED_NODE_IDS - mapping_keys):
    errors.append(f"missing permanent mapping key: {missing_id}")

# The same set is a gate in the OTHER direction too. A key nobody listed is a
# node that reached the public pack without anyone deciding it should ship -
# which is what the private lab repo exists to prevent, and what this catches
# on the day the lab leaks. Adding the id above is the deliberate act of
# publishing it, and after a release it can never be renamed: the key is the
# workflow-compatibility contract.
for unlisted_id in sorted(mapping_keys - RELEASED_NODE_IDS):
    errors.append(
        f"unlisted mapping key: {unlisted_id} is registered but not in "
        "PUBLIC_NODE_IDS. Add it there to publish it deliberately, or move the "
        "node to the lab repo"
    )

# --- 5. nothing outside nodes/ may declare mapping keys ----------------------
# A scanner reads the whole checkout, not just the modules __init__ imports,
# so any .py anywhere that assigns NODE_CLASS_MAPPINGS advertises those keys
# as installable nodes. Test fixtures did exactly that: they published ids no
# import ever registers, and Manager offered the pack for workflows using
# them. Fixtures live as .py.txt for this reason - real source, not a module.
for path in sorted(ROOT.rglob("*.py")):
    parts = path.relative_to(ROOT).parts
    # Scanners skip dot-directories and caches; so does this, or local
    # scratch like .claude/worktrees would answer for the shipped tree.
    if any(part.startswith(".") or part == "__pycache__" for part in parts):
        continue
    if path.parent == ROOT / "nodes":
        continue
    stray = class_mapping_keys(path.read_text(encoding="utf-8"))
    for key in sorted(stray):
        errors.append(
            f"{path.relative_to(ROOT)}: declares mapping key {key} outside "
            "nodes/, where registry scanners will advertise it as a node"
        )

# --- report ------------------------------------------------------------------
for warning in warnings:
    print(f"WARN  {warning}")
for error in errors:
    print(f"ERROR {error}")

if errors:
    print(f"\n{len(errors)} problem(s) found.")
    sys.exit(1)

print(f"OK - {len(node_files)} node file(s) validated.")
