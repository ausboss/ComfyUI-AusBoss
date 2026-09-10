"""A green upload must never stand in for the target version's approval."""

import json
import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from registry_status import version_status
import registry_status


class RegistryStatusTests(unittest.TestCase):
    def entry(self, version, status, **extra):
        return {"node_id": "ausboss-nodes", "version": version, "status": status, **extra}

    def test_older_active_version_does_not_clear_target(self):
        versions = [self.entry("1.3.0", "NodeVersionStatusActive"),
                    self.entry("2.0.0", "NodeVersionStatusFlagged")]
        self.assertEqual(version_status(versions, "2.0.0")[0], "NodeVersionStatusFlagged")

    def test_absent_target_is_not_published(self):
        self.assertEqual(version_status([], "2.0.0")[0], "NotPublished")

    def test_current_decision_wins_over_history(self):
        reason = json.dumps({"message": "Needs a fix", "statusHistory": [{"status": "NodeVersionStatusActive"}]})
        result = version_status([self.entry("2.0.0", "NodeVersionStatusBanned", status_reason=reason)], "2.0.0")
        self.assertEqual(result, ("NodeVersionStatusBanned", "Needs a fix"))

    def test_exact_active_target(self):
        self.assertEqual(version_status([self.entry("2.0.0", "NodeVersionStatusActive")], "2.0.0"),
                         ("NodeVersionStatusActive", ""))

    def test_wrong_pack_and_unknown_status_are_errors(self):
        for entry in [self.entry("2.0.0", "FutureStatus"),
                      self.entry("2.0.0", "NodeVersionStatusActive", node_id="different-pack")]:
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                version_status([entry], "2.0.0")

    def test_malformed_and_duplicate_responses_are_errors(self):
        entry = self.entry("2.0.0", "NodeVersionStatusActive")
        for payload in [{"status": "NodeStatusActive"}, [None], [entry, entry]]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                version_status(payload, "2.0.0")


class RegistryReportTests(unittest.TestCase):
    def run_report(self, status, report=True, reason=""):
        with tempfile.TemporaryDirectory() as tmp:
            summary, output = Path(tmp) / "summary.md", Path(tmp) / "output"
            log = io.StringIO()
            with (
                patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "GITHUB_STEP_SUMMARY": str(summary),
                                        "GITHUB_OUTPUT": str(output)}, clear=True),
                patch.object(registry_status, "fetch_version_status", return_value=(status, reason)),
                contextlib.redirect_stdout(log),
            ):
                code = registry_status.main(["--version", "2.0.2"] + (["--report"] if report else []))
            return code, summary.read_text(), output.read_text(), log.getvalue()

    def test_waiting_review_is_a_successful_report_but_never_approval(self):
        for status in registry_status.REVIEW_STATUSES:
            with self.subTest(status=status):
                code, summary, output, log = self.run_report(status)
                self.assertEqual(code, 0)
                self.assertIn("**Approved: no.**", summary)
                self.assertIn("approved=false", output)
                self.assertIn("do not republish", log.lower())
                self.assertNotIn("::error", log)
                self.assertEqual(self.run_report(status, report=False)[0], 2)

    def test_active_is_the_only_approved_result(self):
        for report in (True, False):
            code, summary, output, _ = self.run_report("NodeVersionStatusActive", report=report)
            self.assertEqual(code, 0)
            self.assertIn("**Approved: yes.**", summary)
            self.assertIn("approved=true", output)

    def test_bans_deletions_and_missing_versions_still_fail(self):
        for status in ("NodeVersionStatusBanned", "NodeVersionStatusDeleted", "NotPublished"):
            with self.subTest(status=status):
                code, _, output, log = self.run_report(status)
                self.assertEqual(code, 2)
                self.assertIn("approved=false", output)
                self.assertIn("::error", log)

    def test_remote_reason_cannot_inject_a_workflow_command(self):
        _, _, _, log = self.run_report("NodeVersionStatusFlagged", reason="review\n::error::injected")
        self.assertIn("Reason: ::error::injected", log)
        self.assertNotIn("\n::error::injected", log)

    def test_failed_lookup_remains_an_error(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(registry_status, "fetch_version_status", side_effect=urllib.error.URLError("unavailable")),
            contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(registry_status.main(["--report", "--version", "2.0.2"]), 1)


class RegistryRetryTests(unittest.TestCase):
    def response(self, versions):
        return io.BytesIO(json.dumps(versions).encode())

    def entry(self):
        return {"node_id": "ausboss-nodes", "version": "2.0.2", "status": "NodeVersionStatusPending"}

    def test_post_upload_visibility_delay_recovers(self):
        with (
            patch.object(registry_status.urllib.request, "urlopen", side_effect=[self.response([]), self.response([self.entry()])]) as get,
            patch.object(registry_status.time, "sleep") as sleep,
        ):
            self.assertEqual(registry_status.fetch_version_status("2.0.2")[0], "NodeVersionStatusPending")
            self.assertEqual(get.call_count, 2)
            sleep.assert_called_once_with(5)

    def test_transient_failure_recovers_and_does_not_wait_for_approval(self):
        for error in (urllib.error.URLError("offline"), TimeoutError(),
                      urllib.error.HTTPError(registry_status.STATUS_URL, 503, "unavailable", {}, None),
                      urllib.error.HTTPError(registry_status.STATUS_URL, 429, "busy", {}, None)):
            with (
                self.subTest(error=error),
                patch.object(registry_status.urllib.request, "urlopen", side_effect=[error, self.response([self.entry()])]) as get,
                patch.object(registry_status.time, "sleep"),
            ):
                self.assertEqual(registry_status.fetch_version_status("2.0.2")[0], "NodeVersionStatusPending")
                self.assertEqual(get.call_count, 2)

    def test_missing_version_and_outage_have_bounded_retries(self):
        for responses in ([self.response([]) for _ in range(3)], urllib.error.URLError("offline")):
            with (
                self.subTest(responses=responses),
                patch.object(registry_status.urllib.request, "urlopen", side_effect=responses) as get,
                patch.object(registry_status.time, "sleep") as sleep,
            ):
                if isinstance(responses, list):
                    self.assertEqual(registry_status.fetch_version_status("2.0.2")[0], "NotPublished")
                else:
                    with self.assertRaises(urllib.error.URLError):
                        registry_status.fetch_version_status("2.0.2")
                self.assertEqual(get.call_count, 3)
                self.assertEqual(sleep.call_count, 2)

    def test_permanent_http_and_malformed_data_fail_without_retries(self):
        for response, error in ((urllib.error.HTTPError(registry_status.STATUS_URL, 403, "forbidden", {}, None), urllib.error.HTTPError),
                                (io.BytesIO(b"not json"), ValueError)):
            with (
                self.subTest(error=error),
                patch.object(registry_status.urllib.request, "urlopen", side_effect=[response]) as get,
                patch.object(registry_status.time, "sleep") as sleep,
            ):
                with self.assertRaises(error):
                    registry_status.fetch_version_status("2.0.2")
                self.assertEqual(get.call_count, 1)
                sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
