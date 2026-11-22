"""Turn off an old copy of the pack before ComfyUI loads any pack.

ComfyUI runs every pack's prestartup_script.py before it imports a single
pack. A copy of AusBoss from before 2.24.0 cannot step aside, so if one is
installed beside this copy (an old git clone in custom_nodes/ComfyUI-AusBoss
next to the Manager's custom_nodes/ausboss-nodes), the old nodes would keep
loading and the new ones would show as missing. Here that old folder is
renamed <folder>.disabled, so it never loads. Nothing is deleted.

This file is run on its own, not as part of the package, so it loads the
helper under a private package name to keep the helper's relative imports
working.
"""

import importlib
import os
import sys
import traceback
import types


def _retire_old_copies():
    here = os.path.dirname(os.path.abspath(__file__))
    name = "_ausboss_prestartup_" + str(abs(hash(here)))
    package = types.ModuleType(name)
    package.__path__ = [os.path.join(here, "nodes")]
    sys.modules[name] = package
    try:
        helper = importlib.import_module(f"{name}._single_copy")
        return helper.retire_old_copies(here)
    finally:
        for key in [k for k in sys.modules if k == name or k.startswith(name + ".")]:
            del sys.modules[key]


try:
    for _copy in _retire_old_copies():
        _old = os.path.basename(_copy["entry"])
        if _copy.get("disabled"):
            print(
                f"AusBoss: turned off an old copy, custom_nodes/{_old} (v{_copy['version']}). "
                f"It is now custom_nodes/{os.path.basename(_copy['disabled'])}; delete it whenever you like."
            )
        else:
            print(
                f"AusBoss: could not turn off the old copy in custom_nodes/{_old} "
                f"(v{_copy['version']}): {_copy.get('error')}. Delete that folder, then restart ComfyUI."
            )
except Exception:
    traceback.print_exc()
