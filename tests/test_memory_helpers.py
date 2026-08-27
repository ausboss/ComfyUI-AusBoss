from __future__ import annotations

from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._memory_helpers import WILDCARD, free_gpu_memory


class WildcardTypeTests(unittest.TestCase):
    def test_it_is_the_star_string(self):
        self.assertEqual(str(WILDCARD), "*")
        self.assertIsInstance(WILDCARD, str)

    def test_it_is_never_unequal_in_either_direction(self):
        # ComfyUI validates links with !=, and the upstream type can sit on
        # either side of the comparison. Both directions run our __ne__
        # because a str subclass's reflected comparison takes priority.
        self.assertFalse(WILDCARD != "IMAGE")
        self.assertFalse("IMAGE" != WILDCARD)
        self.assertFalse(WILDCARD != "LATENT")
        self.assertFalse(WILDCARD != WILDCARD)

    def test_plain_equality_and_hashing_still_behave_as_str(self):
        self.assertTrue(WILDCARD == "*")
        self.assertEqual(hash(WILDCARD), hash("*"))


def fake_model_management(**functions):
    """A stand-in comfy.model_management installed into sys.modules."""
    comfy = types.ModuleType("comfy")
    module = types.ModuleType("comfy.model_management")
    for name, function in functions.items():
        setattr(module, name, function)
    comfy.model_management = module
    return {"comfy": comfy, "comfy.model_management": module}


class FreeGpuMemoryTests(unittest.TestCase):
    def test_it_never_raises_and_reports_what_it_did(self):
        # This process has no comfy on the path; the comfy steps are skipped
        # and the always-available ones still run.
        freed = free_gpu_memory()
        self.assertIsInstance(freed, list)
        self.assertIn("collected garbage", freed)
        self.assertTrue(all(isinstance(entry, str) for entry in freed))

    def test_comfy_steps_are_reported_when_comfy_is_present(self):
        calls = []
        modules = fake_model_management(
            unload_all_models=lambda: calls.append("unload"),
            soft_empty_cache=lambda: calls.append("soft_empty"),
        )
        with patch.dict(sys.modules, modules):
            freed = free_gpu_memory()
        self.assertEqual(calls, ["unload", "soft_empty"])
        self.assertIn("unloaded models", freed)
        self.assertIn("emptied comfy cache", freed)

    def test_a_moved_api_is_skipped_not_fatal(self):
        def broken():
            raise RuntimeError("this API moved in a core release")

        modules = fake_model_management(
            unload_all_models=broken,
            soft_empty_cache=lambda: None,
        )
        with patch.dict(sys.modules, modules):
            freed = free_gpu_memory()
        self.assertNotIn("unloaded models", freed)
        self.assertIn("emptied comfy cache", freed)

    def test_a_missing_api_is_skipped_not_fatal(self):
        modules = fake_model_management()  # neither function exists
        with patch.dict(sys.modules, modules):
            freed = free_gpu_memory()
        self.assertNotIn("unloaded models", freed)
        self.assertNotIn("emptied comfy cache", freed)
        self.assertIn("collected garbage", freed)


if __name__ == "__main__":
    unittest.main()
