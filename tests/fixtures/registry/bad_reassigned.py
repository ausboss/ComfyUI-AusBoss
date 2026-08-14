"""A second assignment wins at runtime but not in a scanner."""


class FirstNode:
    pass


class SecondNode:
    pass


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_First": FirstNode}
NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Second": SecondNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Second": "Second (AusBoss)"}
