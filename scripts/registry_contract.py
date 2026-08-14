"""The node registry contract, as a checkable rule set. Stdlib only.

ComfyUI-Manager and the Registry discover a pack's nodes by parsing its
source with an AST walk -- they never import it. Anything they cannot read
statically makes the node invisible: the pack still loads and works locally
while "install missing custom nodes" silently stops offering it for a shared
workflow. That failure is invisible from inside ComfyUI, so it is checked here
instead.

The rule is deliberately narrow: each node module assigns each mapping exactly
once, at module level, to a dictionary literal whose keys are string literals,
and never mutates it afterwards. `dict(...)`, a helper's return value, a later
`update()` or an item assignment all read as "no keys" to a scanner.

`mapping_problems` takes source text so it is testable against fixtures;
`duplicate_key_problems` compares the keys collected across modules.
"""

from __future__ import annotations

import ast

MAPPING_NAMES = ("NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS")
# Methods that would change a mapping after its literal assignment.
_MUTATORS = frozenset({"update", "setdefault", "pop", "popitem", "clear", "__setitem__"})


def _describe(node: ast.AST) -> str:
    """A short, human-readable label for an unreadable key or value."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Call):
        function = node.func
        name = getattr(function, "id", None) or getattr(function, "attr", None)
        return f"{name}(...)" if name else "a call"
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Constant):
        return repr(node.value)
    return type(node).__name__


def _mapping_targets(node: ast.AST) -> set[str]:
    """Mapping names a statement writes to, however it writes to them."""
    written: set[str] = set()
    targets: list[ast.AST] = []
    if isinstance(node, ast.Assign):
        targets = list(node.targets)
    elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
        targets = [node.target]
    for target in targets:
        if isinstance(target, ast.Name) and target.id in MAPPING_NAMES:
            written.add(target.id)
        # NODE_CLASS_MAPPINGS["x"] = ... and tuple unpacking into it
        elif isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name):
            if target.value.id in MAPPING_NAMES:
                written.add(target.value.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                if isinstance(element, ast.Name) and element.id in MAPPING_NAMES:
                    written.add(element.id)
    return written


def mapping_problems(source: str, label: str) -> list[str]:
    """Every way ``source`` breaks the registry contract, newest rule last."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"{label}: cannot be parsed: {exc}"]

    problems: list[str] = []
    literals: dict[str, ast.Dict] = {}

    for name in MAPPING_NAMES:
        # A conforming assignment: module level, single Name target, dict literal.
        direct = [
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == name
        ]
        if len(direct) != 1:
            problems.append(
                f"{label}: {name} must be assigned exactly once at module level "
                f"as a dictionary literal (found {len(direct)})"
            )
        for extra in direct[1:]:
            problems.append(f"{label}:{extra.lineno}: {name} is reassigned here")

        if direct:
            value = direct[0].value
            if not isinstance(value, ast.Dict):
                problems.append(
                    f"{label}:{direct[0].lineno}: {name} must be a dictionary "
                    f"literal, not {_describe(value)} - a scanner reads the "
                    "literal, it does not run the module"
                )
            else:
                literals[name] = value
                seen: set[str] = set()
                for key in value.keys:
                    if key is None:  # {**other}
                        problems.append(
                            f"{label}:{direct[0].lineno}: {name} unpacks another "
                            "mapping; a scanner cannot resolve those keys"
                        )
                        continue
                    if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                        problems.append(
                            f"{label}:{getattr(key, 'lineno', direct[0].lineno)}: "
                            f"{name} key {_describe(key)} must be a string literal "
                            "so registry scanners can find it"
                        )
                        continue
                    if key.value in seen:
                        problems.append(
                            f"{label}:{key.lineno}: {name} lists {key.value!r} twice"
                        )
                    seen.add(key.value)

        # Any later write, anywhere in the module, including inside a function.
        for node in ast.walk(tree):
            if node in direct:
                continue
            if name in _mapping_targets(node):
                problems.append(
                    f"{label}:{node.lineno}: {name} is modified after assignment; "
                    "a scanner only sees the literal"
                )
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in _MUTATORS
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == name
            ):
                problems.append(
                    f"{label}:{node.lineno}: {name}.{node.func.attr}() changes the "
                    "mapping after assignment; a scanner only sees the literal"
                )

    # The two mappings describe the same nodes, so they carry the same keys.
    if len(literals) == 2:
        keys = {
            name: {
                key.value
                for key in literal.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
            for name, literal in literals.items()
        }
        classes, names = keys["NODE_CLASS_MAPPINGS"], keys["NODE_DISPLAY_NAME_MAPPINGS"]
        for missing in sorted(classes - names):
            problems.append(f"{label}: {missing} has no NODE_DISPLAY_NAME_MAPPINGS entry")
        for missing in sorted(names - classes):
            problems.append(f"{label}: {missing} has no NODE_CLASS_MAPPINGS entry")

    return problems


def class_mapping_keys(source: str) -> set[str]:
    """The NODE_CLASS_MAPPINGS keys a conforming module declares."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "NODE_CLASS_MAPPINGS"
            and isinstance(node.value, ast.Dict)
        ):
            return {
                key.value
                for key in node.value.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
    return set()


def duplicate_key_problems(keys_by_label: dict[str, set[str]]) -> list[str]:
    """Mapping keys claimed by more than one module.

    The last module imported wins the registration, so a collision silently
    drops a node instead of failing.
    """
    owners: dict[str, list[str]] = {}
    for label, keys in keys_by_label.items():
        for key in keys:
            owners.setdefault(key, []).append(label)
    return [
        f"mapping key {key} is declared by {', '.join(sorted(labels))}"
        for key, labels in sorted(owners.items())
        if len(labels) > 1
    ]
