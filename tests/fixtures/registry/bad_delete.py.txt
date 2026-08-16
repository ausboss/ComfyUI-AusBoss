"""A del that retires a node the scanner still advertises.

The literal keeps both keys, so Manager offers a workflow the pack no longer
registers - the mirror image of the update() case.
"""


class KeptNode:
    pass


class RetiredNode:
    pass


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_Kept": KeptNode,
    "AUSBOSS_NODES_Retired": RetiredNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_Kept": "Kept (AusBoss)",
    "AUSBOSS_NODES_Retired": "Retired (AusBoss)",
}

del NODE_CLASS_MAPPINGS["AUSBOSS_NODES_Retired"]
del NODE_DISPLAY_NAME_MAPPINGS["AUSBOSS_NODES_Retired"]
