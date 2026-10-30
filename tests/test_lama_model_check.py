from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._lama_helpers import load_lama_model

KNOWN = b"a known model"


class KnownModelTests(unittest.TestCase):
    def setUp(self):
        load_lama_model.cache_clear()
        self.addCleanup(load_lama_model.cache_clear)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        pinned = patch(
            "nodes._lama_helpers.KNOWN_MODEL_SHA256", {hashlib.sha256(KNOWN).hexdigest()}
        )
        pinned.start()
        self.addCleanup(pinned.stop)

    def model_file(self, name: str, data: bytes) -> str:
        path = self.folder / name
        path.write_bytes(data)
        return str(path)

    def test_a_known_file_opens(self):
        path = self.model_file("big-lama.pt", KNOWN)
        with patch("torch.jit.load", return_value=MagicMock()) as opened:
            load_lama_model(path)
        opened.assert_called_once()

    def test_a_renamed_known_file_opens(self):
        path = self.model_file("my copy.pth", KNOWN)
        with patch("torch.jit.load", return_value=MagicMock()) as opened:
            load_lama_model(path)
        opened.assert_called_once()

    def test_any_other_file_is_refused_before_it_opens(self):
        path = self.model_file("big-lama.pt", b"something else")
        with patch("torch.jit.load") as opened:
            with self.assertRaisesRegex(ValueError, "not a known big-lama.pt"):
                load_lama_model(path)
        opened.assert_not_called()

    def test_the_refusal_names_the_file_not_its_folder(self):
        path = self.model_file("other.pt", b"something else")
        with self.assertRaises(ValueError) as caught:
            load_lama_model(path)
        self.assertIn("other.pt", str(caught.exception))
        self.assertNotIn(str(self.folder), str(caught.exception))


if __name__ == "__main__":
    unittest.main()
