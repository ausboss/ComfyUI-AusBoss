"""Empty mappings: the module is listed in NODE_MODULES and registers nothing.

Reads to a scanner exactly like a module with no mappings at all, and imports
without a murmur, so nothing anywhere says the node went missing.
"""


class StrandedNode:
    pass


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
