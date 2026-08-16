"""A repeated key silently drops the earlier class."""


class LeftNode:
    pass


class RightNode:
    pass


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_Dup": LeftNode, "AUSBOSS_NODES_Dup": RightNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Dup": "Dup (AusBoss)"}
