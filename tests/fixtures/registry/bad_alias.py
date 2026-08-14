"""An alias doing the mutating, one step removed from the mapping name.

`_registry.update(...)` never mentions NODE_CLASS_MAPPINGS, so a check that
only watched that name would pass this. The alias is refused where it is
made - the last point anything static can still see what is happening.
"""


class BaseNode:
    pass


class ExtraNode:
    pass


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Base": BaseNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Base": "Base (AusBoss)"}

_registry = NODE_CLASS_MAPPINGS
_registry.update({"AUSBOSS_NODES_Extra": ExtraNode})

_labels = NODE_DISPLAY_NAME_MAPPINGS
_labels["AUSBOSS_NODES_Extra"] = "Extra (AusBoss)"
