#!/usr/bin/env python3
"""Read the exact release's Registry status without publishing anything.

Exit 0 means Active, 2 means not approved, and 1 means the
status could not be established. A successful upload is not approval.
With --report, Pending and Flagged also exit 0: the status was checked,
but review is unfinished. Banned, Deleted and missing versions still fail.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
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
REVIEW_STATUSES = {"NodeVersionStatusPending", "NodeVersionStatusFlagged"}
STATUS_MESSAGES = {
    "NodeVersionStatusActive": "Approved by the Registry.",
    "NodeVersionStatusPending": "Awaiting Registry review; not approved yet. Do not republish to retry approval.",
    "NodeVersionStatusFlagged": "Flagged for Registry review; not approved. Review the findings before taking further action; do not republish to retry approval.",
    "NodeVersionStatusBanned": "Banned by the Registry. Address the recorded finding and request review of a corrected candidate.",
    "NodeVersionStatusDeleted": "The Registry version was deleted. Investigate before publishing again.",
    "NotPublished": "The exact version is still missing after retries. Check the publication run before retrying an upload.",
    "Unknown": "Could not establish Registry status. Check the service or response; this does not establish approval.",
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


def fetch_version_status(version):
    """Retry temporary service errors and short post-upload visibility delays."""
    request = urllib.request.Request(STATUS_URL, headers={"User-Agent": "AusBoss-release-check"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read(8 * 1024 * 1024 + 1)
        except (urllib.error.URLError, TimeoutError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code != 429 and exc.code < 500:
                raise
            if attempt == 2:
                raise
        else:
            if len(payload) > 8 * 1024 * 1024:
                raise ValueError("Registry response exceeds the size limit")
            result = version_status(json.loads(payload), version)
            if result[0] != "NotPublished" or attempt == 2:
                return result
        time.sleep(5 * (attempt + 1))


def report_status(version, status, reason):
    active = status == "NodeVersionStatusActive"
    message = STATUS_MESSAGES[status]
    print(f"{NODE_ID} {version}: {status}")
    print(message)
    if reason:
        # Prefix every line so remote text cannot become a workflow command.
        for line in reason.splitlines():
            print(f"Reason: {line}")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        level = "notice" if active or status == "NodeVersionStatusPending" else (
            "warning" if status == "NodeVersionStatusFlagged" else "error"
        )
        print(f"::{level} title=Registry approval::{message}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"status={status}\napproved={str(active).lower()}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## Registry: {version}\n\nStatus: **{status}**\n\n")
            handle.write(f"{message}\n\n**Approved: {'yes' if active else 'no'}.**\n")
            handle.write("A successful status-check job means the check completed, not that the release is approved.\n")
            if reason:
                handle.write("\n" + "\n".join("> " + line for line in reason.splitlines()) + "\n")
            handle.write(f"\n[Registry response]({STATUS_URL})\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Defaults to the checked-out pyproject version")
    parser.add_argument("--report", action="store_true", help="Report Pending/Flagged without failing; only Active means approved")
    args = parser.parse_args(argv)
    try:
        version = args.version or tomllib.loads(
            (Path(__file__).resolve().parent.parent / "pyproject.toml").read_text()
        )["project"]["version"]
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError("Version must use X.Y.Z format")
        status, reason = fetch_version_status(version)
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as exc:
        print(f"Registry status UNKNOWN: {exc}", file=sys.stderr)
        report_status("unverified", "Unknown", "The lookup failed; see the error in the job log.")
        return 1

    report_status(version, status, reason)
    active = status == "NodeVersionStatusActive"
    return 0 if active or (args.report and status in REVIEW_STATUSES) else 2


if __name__ == "__main__":
    sys.exit(main())
