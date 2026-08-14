"""A later update() adds nodes a scanner never sees."""


class BaseNode:
    pass


class ExtraNode:
    pass


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Base": BaseNode}
NODE_CLASS_MAPPINGS.update({"AUSBOSS_NODES_Extra": ExtraNode})
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Base": "Base (AusBoss)"}
