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


def frame_progress(total: int):
    """A progress bar for a known frame total; None when there is nothing to track.

    A total of zero or less means the source never said how many frames are
    coming, so there is no honest fraction to report and the loop runs
    untracked rather than inventing one.
    """
    if int(total) <= 0:
        return None
    try:
        from comfy.utils import ProgressBar
    except ImportError:  # Offline tests run without ComfyUI.
        return None
    try:
        return ProgressBar(int(total))
    except Exception:
        return None


def advance_progress(progress, value: int, total: int) -> None:
    """Report frame `value` of `total`; a reporting failure never stops the work.

    No preview image is attached - both video nodes already show the clip in
    their own player, so a second stream of frames would only cost bandwidth.
    Only Exception is swallowed: an interrupt raised by ComfyUI's progress
    hook is a BaseException and has to keep travelling.
    """
    if progress is None:
        return
    try:
        progress.update_absolute(int(value), int(total))
    except Exception:
        pass


__all__ = ["advance_progress", "frame_progress", "raise_if_interrupted"]
