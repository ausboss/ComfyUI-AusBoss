"""The notes a release sends to the Registry: one short line per changelog entry."""

import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import changelog_notes
from changelog_notes import entry_line, notes_for, section

CHANGELOG = """# Changelog

## Unreleased

- **New: Mask by Touch \U0001f18e** (Mask). Click a thing on the picture and get
  its mask. The picture is on the node.

## 2.7.0 - 2026-10-06

- **New: Workflow Switches \U0001f18e** (Utility). One small card that turns
  parts of a workflow off and on. Name a switch and pick what it controls.
- **New example: Mask by Name.** Finds a thing by its name and saves its
  cut-out. A second sentence.
- **A file dropped anywhere on a loader node loads into it.** In the classic
  node style, a picture only loaded when you let go over the title.
- **Save Video: a saved gif shows on the node.** With **Format** set to
  `gif` the node stayed empty.

## 2.6.4 - 2026-10-05

## 2.6.3 - 2026-10-05

- A plain entry with no bold opening. It has a second sentence.
"""


class NotesTests(unittest.TestCase):
    def test_a_fix_is_its_bold_opening(self):
        notes = notes_for("2.7.0", CHANGELOG).splitlines()
        self.assertEqual(notes[2], "- A file dropped anywhere on a loader node loads into it.")
        self.assertEqual(notes[3], "- Save Video: a saved gif shows on the node.")

    def test_a_new_node_also_says_what_it_does(self):
        notes = notes_for("2.7.0", CHANGELOG).splitlines()
        self.assertEqual(notes[0], "- New: Workflow Switches (Utility). One small card that turns parts of a workflow off and on.")
        self.assertEqual(notes[1], "- New example: Mask by Name. Finds a thing by its name and saves its cut-out.")

    def test_one_line_per_entry_and_nothing_of_the_next_version(self):
        notes = notes_for("2.7.0", CHANGELOG)
        self.assertEqual(len(notes.splitlines()), 4)
        self.assertNotIn("plain entry", notes)
        self.assertNotIn("Mask by Touch", notes)

    def test_the_notes_are_plain_text(self):
        for version in ("Unreleased", "2.7.0", "2.6.3"):
            notes = notes_for(version, CHANGELOG)
            for mark in ("**", "`", "\U0001f18e"):
                self.assertNotIn(mark, notes)
            self.assertNotIn("  ", notes)

    def test_an_entry_without_a_bold_opening_gives_its_first_sentence(self):
        self.assertEqual(notes_for("2.6.3", CHANGELOG), "- A plain entry with no bold opening.")
        self.assertEqual(entry_line("Just words\n  over two lines. More."), "Just words over two lines.")

    def test_a_version_is_found_with_or_without_its_date(self):
        self.assertIn("Mask by Touch", section(CHANGELOG, "Unreleased"))
        self.assertIn("Workflow Switches", section(CHANGELOG, "2.7.0"))
        self.assertIsNone(section(CHANGELOG, "2.7"))

    def test_a_missing_or_empty_version_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "no section"):
            notes_for("9.9.9", CHANGELOG)
        with self.assertRaisesRegex(ValueError, "no entries"):
            notes_for("2.6.4", CHANGELOG)

    def test_a_very_long_release_is_cut_at_a_whole_line(self):
        many = "## 3.0.0 - 2026-01-01\n\n" + "".join(f"- **Entry number {i} with a fairly long opening sentence to fill the box.** More.\n" for i in range(120))
        notes = notes_for("3.0.0", many)
        self.assertLessEqual(len(notes), changelog_notes.LIMIT + 80)
        self.assertRegex(notes.splitlines()[-1], r"^- and \d+ more: see CHANGELOG.md")
        shown = len(notes.splitlines()) - 1
        self.assertEqual(int(notes.splitlines()[-1].split()[2]), 120 - shown)


class CommandTests(unittest.TestCase):
    def run_main(self, *argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        fake = types_out(out)
        with patch.dict(os.environ, env or {}, clear=False), contextlib.redirect_stderr(err), patch.object(sys, "stdout", fake):
            code = changelog_notes.main(list(argv))
        return code, fake.text(), err.getvalue()

    def test_the_repos_own_changelog_has_notes_for_the_pyproject_version(self):
        code, out, err = self.run_main()
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.startswith("- "))

    def test_the_workflow_gets_the_notes_under_the_name_comfy_cli_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "env"
            target.write_text("OTHER=1\n", encoding="utf-8")
            code, _out, err = self.run_main("--github-env", env={"GITHUB_ENV": str(target)})
            self.assertEqual((code, err), (0, ""))
            lines = target.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[0], "OTHER=1")
        self.assertEqual(lines[1], "COMFY_NODE_CHANGELOG<<AUSBOSS_NOTES_END")
        self.assertEqual(lines[-1], "AUSBOSS_NOTES_END")
        self.assertTrue(all(line.startswith("- ") for line in lines[2:-1]))

    def test_outside_a_workflow_github_env_says_so(self):
        saved = os.environ.pop("GITHUB_ENV", None)
        try:
            code, _out, err = self.run_main("--github-env")
        finally:
            if saved is not None:
                os.environ["GITHUB_ENV"] = saved
        self.assertEqual(code, 1)
        self.assertIn("GITHUB_ENV is not set", err)

    def test_a_version_with_no_section_fails(self):
        code, _out, err = self.run_main("--version", "9.9.9")
        self.assertEqual(code, 1)
        self.assertIn("no section", err)


class types_out:
    """A stand-in for sys.stdout that takes both text and bytes."""

    def __init__(self, text):
        self._text, self.buffer = text, io.BytesIO()

    def write(self, words):
        return self._text.write(words)

    def flush(self):
        pass

    def text(self):
        return self._text.getvalue() + self.buffer.getvalue().decode("utf-8")


if __name__ == "__main__":
    unittest.main()
