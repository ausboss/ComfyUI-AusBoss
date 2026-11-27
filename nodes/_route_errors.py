"""What a route or a node says back when something fails."""

from __future__ import annotations

import re

# A whole path: a word that opens with "/", "\", "~/" or a drive letter,
# after anything but a letter, digit, "_" or "." ("and/or" and "3/4" stay).
_SERVER_PATH = re.compile(r"""(?:^|[^\w.])(?:[A-Za-z]:[\\/]|~[\\/]|[\\/])[^\s'"]""")


def safe_route_error(exc: Exception, fallback: str = "The request failed.") -> str:
    """The error text for the caller. A message that names a place on the
    server's disk is replaced whole: a decoder or the system quotes the file
    it was given, and the routes answer anyone who can reach the server."""
    text = str(exc).strip()
    if not text or _SERVER_PATH.search(text):
        return fallback
    return text


def error_detail(exc: BaseException) -> str:
    """A library's error for a node's message: its kind and its words, or
    its kind alone when the words name a place on the server's disk. Node
    errors reach the browser that queued the run and stay in the history."""
    kind = type(exc).__name__
    text = " ".join(str(exc).split())
    if not text or _SERVER_PATH.search(text):
        return kind
    return f"{kind}: {text}"
