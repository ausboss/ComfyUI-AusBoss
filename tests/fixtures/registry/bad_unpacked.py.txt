"""Unpacking another mapping hides its keys from a scanner."""

OTHER = {"AUSBOSS_NODES_Other": object}


class UnpackNode:
    pass


NODE_CLASS_MAPPINGS = {**OTHER, "AUSBOSS_NODES_Unpack": UnpackNode}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Unpack": "Unpack (AusBoss)"}
