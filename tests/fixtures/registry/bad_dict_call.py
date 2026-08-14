"""dict(...) is a call; a scanner does not execute it."""


class CallNode:
    pass


NODE_CLASS_MAPPINGS = dict(AUSBOSS_NODES_Call=CallNode)
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_Call": "Call (AusBoss)"}
