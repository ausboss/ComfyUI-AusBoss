"""The wildcard wire type and the release routine for Free Memory.

Nothing in here imports ComfyUI at module level: the node must keep loading
(and its tests must keep running) on a machine with no comfy on the path, and
a core release that moves an API must degrade to "that step was skipped",
never to an import error that deletes the node from the menu.
"""

from __future__ import annotations


class _Wildcard(str):
    """A type string that matches every wire.

    ComfyUI validates a link by comparing the upstream output's type string
    against the input's with ``!=``, so a string that refuses to be unequal
    connects to anything. The comparison holds in both directions because
    this is a *subclass* of str: Python gives a subclass's reflected
    comparison priority, so even ``"IMAGE" != wildcard`` runs this __ne__.
    The frontend needs no help — LiteGraph already treats "*" as compatible
    with every slot.
    """

    __slots__ = ()

    def __ne__(self, _other) -> bool:
        return False


WILDCARD = _Wildcard("*")


def free_gpu_memory() -> list[str]:
    """Best-effort release of model VRAM and cached allocations.

    Returns the steps that succeeded, for a one-line runtime log. Every step
    is independent and fail-soft: comfy absent, an API renamed, or CUDA not
    present each just drops that entry from the list.
    """
    freed: list[str] = []
    try:
        import comfy.model_management as model_management
    except Exception:
        model_management = None
    if model_management is not None:
        try:
            model_management.unload_all_models()
            freed.append("unloaded models")
        except Exception:
            pass
        try:
            model_management.soft_empty_cache()
            freed.append("emptied comfy cache")
        except Exception:
            pass
    try:
        import gc

        gc.collect()
        freed.append("collected garbage")
    except Exception:
        pass
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            freed.append("emptied cuda cache")
    except Exception:
        pass
    return freed


__all__ = ["WILDCARD", "free_gpu_memory"]
