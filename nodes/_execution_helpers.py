"""Fail-soft seams onto ComfyUI's execution loop for the video nodes.

The decode and encode loops run on a worker thread (asyncio.to_thread), which
copies the caller's context variables - the same ones ComfyUI reads to
attribute an interrupt or a progress update to the node being executed - so
these seams work unchanged from there. Every import is deferred and optional,
so offline tests and older cores simply run the loops uninstrumented.
"""

from __future__ import annotations


def raise_if_interrupted() -> None:
    """Abort the running node as soon as the queue is cancelled.

    ComfyUI raises InterruptProcessingException, which derives from
    BaseException rather than Exception, so it passes straight through
    ordinary `except Exception` handling on its way out of a loop.
    """
    try:
        from comfy.model_management import throw_exception_if_processing_interrupted
    except ImportError:  # Offline tests run without ComfyUI.
        return
    throw_exception_if_processing_interrupted()


__all__ = ["raise_if_interrupted"]
