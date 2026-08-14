"""The original bug: a variable key resolves to nothing in a scanner."""

NODE_ID = "AUSBOSS_NODES_Variable"


class VariableNode:
    pass


NODE_CLASS_MAPPINGS = {NODE_ID: VariableNode}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_ID: "Variable (AusBoss)"}
