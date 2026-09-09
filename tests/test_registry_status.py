"""A green upload must never stand in for the target version's approval."""

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from registry_status import version_status


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


if __name__ == "__main__":
    unittest.main()
