#!/usr/bin/env python3
"""Read the exact release's Registry status without publishing anything.

Exit 0 means Active, 2 means not approved, and 1 means the
status could not be established. A successful upload is not approval.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sys
import tomllib
import urllib.error
import urllib.request

NODE_ID = "ausboss-nodes"
STATUS_URL = f"https://api.comfy.org/nodes/{NODE_ID}/versions?include_status_reason=true"
KNOWN_STATUSES = {
    "NodeVersionStatusActive", "NodeVersionStatusPending",
    "NodeVersionStatusFlagged", "NodeVersionStatusBanned",
    "NodeVersionStatusDeleted",
}


def version_status(versions, version):
    if not isinstance(versions, list) or any(not isinstance(v, dict) for v in versions):
        raise ValueError("Registry returned an unexpected version list")
    matches = [v for v in versions if v.get("version") == version]
    if not matches:
        return "NotPublished", "The requested version is not listed."
    if len(matches) != 1:
        raise ValueError("Registry returned duplicate versions")
    entry = matches[0]
    if entry.get("node_id") != NODE_ID:
        raise ValueError("Registry returned a different node pack")
    status = entry.get("status")
    if status not in KNOWN_STATUSES:
        raise ValueError(f"Registry returned an unknown status: {status!r}")
    reason = entry.get("status_reason") or ""
    if isinstance(reason, str):
        try:
            reason = json.loads(reason)
        except ValueError:
            pass
    if isinstance(reason, dict):
        reason = reason.get("message", "")
    return status, str(reason)[:4000]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Defaults to the checked-out pyproject version")
    args = parser.parse_args(argv)
    try:
        version = args.version or tomllib.loads(
            (Path(__file__).resolve().parent.parent / "pyproject.toml").read_text()
        )["project"]["version"]
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError("Version must use X.Y.Z format")
        request = urllib.request.Request(STATUS_URL, headers={"User-Agent": "AusBoss-release-check"})
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise ValueError("Registry response exceeds the size limit")
        status, reason = version_status(json.loads(payload), version)
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as exc:
        print(f"Registry status UNKNOWN: {exc}", file=sys.stderr)
        return 1

    print(f"{NODE_ID} {version}: {status}")
    if reason:
        print(f"Reason: {reason}")
    active = status == "NodeVersionStatusActive"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## Registry: {version}\n\nStatus: **{status}**\n\n")
            handle.write("Release approved.\n" if active else "Release is not approved; review the status before publishing again.\n")
            if reason:
                handle.write("\n" + "\n".join("> " + line for line in reason.splitlines()) + "\n")
            handle.write(f"\n[Registry response]({STATUS_URL})\n")
    return 0 if active else 2


if __name__ == "__main__":
    sys.exit(main())
