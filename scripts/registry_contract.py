"""The node registry contract, as a checkable rule set. Stdlib only.

ComfyUI-Manager and the Registry discover a pack's nodes by parsing its
source with an AST walk -- they never import it. Anything they cannot read
statically makes the node invisible: the pack still loads and works locally
while "install missing custom nodes" silently stops offering it for a shared
workflow. That failure is invisible from inside ComfyUI, so it is checked here
instead.

The rule is deliberately narrow. Each node module assigns each mapping exactly
once, at module level, to a non-empty dictionary literal whose keys are string
literals -- and then never mentions that name again. `dict(...)`, a helper's
return value, a later `update()`, an item assignment, a `del`, an empty
literal: every one of them reads to a scanner as "no keys here".

Not mentioning the name again is what makes the rest enforceable. A mapping
handed to something else -- `alias = NODE_CLASS_MAPPINGS` and then
`alias.update(...)`, or a helper called with the mapping as an argument --
can be changed anywhere, and no amount of static analysis will follow it. So
the alias is refused where it is created, which is the last point a checker
can still see what is happening. The one gap left is a module that reaches
its own globals by string (`globals()["NODE_CLASS_MAPPINGS"]`); that names
nothing this can read, and no node module has any reason to.

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


def _parent_map(tree: ast.AST) -> dict[int, ast.AST]:
    """Child -> parent across the module, so a mention of a mapping can be
    judged by the statement it sits in."""
    parents: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node
    return parents


def _reference_problem(name: str, ref: ast.Name, parents: dict[int, ast.AST]) -> str:
    """Why this mention of a mapping outside its own assignment is refused.

    They all end the same way -- a scanner sees only the literal -- but naming
    the shape matters, because "aliased" and "deleted from" are different
    mistakes to go and fix."""
    parent = parents.get(id(ref))
    grand = parents.get(id(parent)) if parent is not None else None
    if isinstance(parent, ast.Attribute):
        if parent.attr in _MUTATORS:
            return f"{name}.{parent.attr}() changes it after assignment"
        return f"{name}.{parent.attr} is used after assignment"
    if isinstance(parent, ast.Subscript):
        if isinstance(parent.ctx, ast.Del) or isinstance(grand, ast.Delete):
            return f"{name} has an entry deleted after assignment"
        if isinstance(parent.ctx, ast.Store):
            return f"{name} has an entry assigned after assignment"
        return f"{name} is indexed after assignment"
    if isinstance(parent, ast.Delete):
        return f"{name} is deleted after assignment"
    if isinstance(parent, ast.AugAssign):
        return f"{name} is extended after assignment"
    if isinstance(parent, (ast.Assign, ast.AnnAssign)):
        if parent.value is ref:
            return (
                f"{name} is aliased after assignment, and an alias can be "
                "changed somewhere no scanner will follow"
            )
        return f"{name} is reassigned after assignment"
    if isinstance(parent, (ast.Tuple, ast.List)) and isinstance(ref.ctx, ast.Store):
        return f"{name} is assigned by unpacking after assignment"
    return f"{name} is used after assignment"


def mapping_problems(source: str, label: str) -> list[str]:
    """Every way ``source`` breaks the registry contract, newest rule last."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"{label}: cannot be parsed: {exc}"]

    problems: list[str] = []
    literals: dict[str, ast.Dict] = {}
    parents = _parent_map(tree)

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
                if not value.keys:
                    problems.append(
                        f"{label}:{direct[0].lineno}: {name} is empty - a module "
                        "listed in NODE_MODULES must declare at least one node, "
                        "and an empty literal reads exactly like a missing one"
                    )
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

        # Every other mention of the name, anywhere in the module: a mutation,
        # a del, an alias, or a plain read that says the module has plans for
        # it. The targets of the module-level assignments are skipped - a
        # second one is already reported as a reassignment above - and one
        # complaint per line is enough to go and look.
        assigned = {id(node.targets[0]) for node in direct}
        references = sorted(
            (
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.Name)
                and node.id == name
                and id(node) not in assigned
            ),
            key=lambda node: (node.lineno, node.col_offset),
        )
        reported: set[int] = set()
        for ref in references:
            if ref.lineno in reported:
                continue
            reported.add(ref.lineno)
            problems.append(
                f"{label}:{ref.lineno}: {_reference_problem(name, ref, parents)}"
                " - a scanner reads only the literal"
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
    """The NODE_CLASS_MAPPINGS keys a conforming module declares.

    This is what a scanner would find, so it is also what the permanent-ID
    check must be measured against: a key named only in a docstring, a
    comment or a search alias is not a registration.
    """
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


def module_list(source: str, name: str = "NODE_MODULES") -> set[str] | None:
    """The module names a list literal declares, or None if it cannot be read.

    Parsed, not grepped, for the same reason as the mapping keys: a name in a
    docstring, a comment or a commented-out line is not a registration, and a
    regex would count it as one. Returns None when the assignment is missing
    or is not a literal, so the caller can say so instead of reporting an
    empty list as though nothing were registered.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == name
        ):
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                return None
            if not isinstance(value, (list, tuple, set)):
                return None
            return {item for item in value if isinstance(item, str)}
    return None


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
