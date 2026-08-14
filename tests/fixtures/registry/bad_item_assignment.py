"""Item assignment is invisible to a scanner."""


class ItemNode:
    pass


NODE_CLASS_MAPPINGS = {}
NODE_CLASS_MAPPINGS["AUSBOSS_NODES_Item"] = ItemNode
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Item": "Item (AusBoss)"}
