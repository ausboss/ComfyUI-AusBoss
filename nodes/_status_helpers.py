"""Live per-node status pushed to the browser while a node is running.

Decoration only: the badge is nice to have, so every failure path here is a
silent no-op. Nothing in this module may raise into a node's execution path.
"""

from __future__ import annotations

import math


EVENT_NAME = "ausboss-node-status"


def _fraction(progress) -> float | None:
    """Clamp a progress value to 0.0-1.0; anything unusable becomes None."""
    try:
        value = float(progress)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return min(1.0, max(0.0, value))


def push_node_status(node_id, text, progress=None) -> None:
    """Show one status line on this node's badge in the open browser tabs.

    `node_id` is the node's UNIQUE_ID hidden input; None (a node that does
    not request one, or an offline call) skips the send. Empty `text`
    retracts the badge. Missing ComfyUI server module, no live PromptServer,
    and any transport failure are all silent no-ops.
    """
    if node_id is None:
        return
    try:
        from server import PromptServer

        server = getattr(PromptServer, "instance", None)
        if server is None:
            return
        server.send_sync(
            EVENT_NAME,
            {
                "node_id": str(node_id),
                "text": str(text),
                "progress": _fraction(progress),
            },
        )
    except Exception:
        # ImportError offline, a server torn down mid-run, a closed socket:
        # a status update is never worth failing the node that reports it.
        return


__all__ = ["EVENT_NAME", "push_node_status"]
