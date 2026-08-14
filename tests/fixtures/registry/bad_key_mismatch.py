"""A node with no display name loses its label in the menu."""


class OneNode:
    pass


class TwoNode:
    pass


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_One": OneNode, "AUSBOSS_NODES_Two": TwoNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_One": "One (AusBoss)"}
