"""Each test file runs as a script (scripts/run_python_tests.py), so the
unittest.main() at its foot runs only the tests defined above it. A test
class written after that guard would never run, and the file would still
pass."""

from __future__ import annotations

from pathlib import Path
import re
import unittest

TESTS = Path(__file__).resolve().parent
GUARD = re.compile(r'^if __name__ == "__main__":', re.M)


class EveryTestRuns(unittest.TestCase):
    def test_no_test_is_defined_after_the_main_guard(self):
        late = []
        for path in sorted(TESTS.glob("test_*.py")):
            text = path.read_text(encoding="utf-8")
            guard = GUARD.search(text)
            if guard and re.search(r"^(?:class|def) ", text[guard.end():], re.M):
                late.append(path.name)
        self.assertEqual(late, [])


if __name__ == "__main__":
    unittest.main()
