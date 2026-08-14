"""A helper's return value is opaque to a scanner."""


class HelperNode:
    pass


def _build():
    return {"AUSBOSS_NODES_Helper": HelperNode}


NODE_CLASS_MAPPINGS = _build()
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Helper": "Helper (AusBoss)"}
