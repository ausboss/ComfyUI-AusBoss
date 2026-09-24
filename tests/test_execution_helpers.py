from __future__ import annotations

import contextlib
import io
import types
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

try:
    import torch
except ImportError:  # CI runs this file with the standard library alone.
    torch = None

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _execution_helpers
from nodes._execution_helpers import (
    advance_progress,
    comfy_torch_device,
    frame_progress,
    progress_bar,
    raise_if_interrupted,
    warn_once,
)


class FakeInterrupt(BaseException):
    """Mirrors ComfyUI's InterruptProcessingException: not an Exception."""


class RecordingBar:
    def __init__(self):
        self.updates = []

    def update_absolute(self, value, total=None, preview=None):
        self.updates.append((value, total, preview))


class BrokenBar:
    def update_absolute(self, *_args, **_kwargs):
        raise RuntimeError("the websocket went away")


class InterruptingBar:
    """ComfyUI's progress hook raises its interrupt straight through here."""

    def update_absolute(self, *_args, **_kwargs):
        raise FakeInterrupt()


def fake_comfy(**submodules) -> dict:
    """sys.modules entries for a stand-in comfy package with these submodules."""
    package = types.ModuleType("comfy")
    entries = {"comfy": package}
    for name, attributes in submodules.items():
        module = types.ModuleType(f"comfy.{name}")
        for attribute, value in attributes.items():
            setattr(module, attribute, value)
        setattr(package, name, module)
        entries[f"comfy.{name}"] = module
    return entries


class FrameProgressTests(unittest.TestCase):
    def test_an_unknown_total_tracks_nothing(self):
        self.assertIsNone(frame_progress(0))
        self.assertIsNone(frame_progress(-7))

    def test_a_known_total_either_tracks_or_fails_soft(self):
        # A bar only exists when ComfyUI is importable; either way no throw.
        bar = frame_progress(10)
        self.assertTrue(bar is None or hasattr(bar, "update_absolute"))


class ProgressBarTests(unittest.TestCase):
    """progress_bar is the plain seam; frame_progress guards unknown totals."""

    def test_offline_there_is_no_bar(self):
        with patch.dict(sys.modules, {"comfy": None}):
            self.assertIsNone(progress_bar(5))

    def test_any_total_gets_a_bar_where_frame_progress_declines(self):
        class Bar:
            def __init__(self, total):
                self.total = total

        with patch.dict(sys.modules, fake_comfy(utils={"ProgressBar": Bar})):
            self.assertEqual(progress_bar(3).total, 3)
            self.assertEqual(progress_bar(0).total, 0)
            self.assertIsNone(frame_progress(0))

    def test_a_bar_that_cannot_be_built_is_not_hidden(self):
        class Unbuildable:
            def __init__(self, total):
                raise RuntimeError("no progress hook")

        with patch.dict(sys.modules, fake_comfy(utils={"ProgressBar": Unbuildable})):
            with self.assertRaises(RuntimeError):
                progress_bar(3)
            self.assertIsNone(frame_progress(3))


class AdvanceProgressTests(unittest.TestCase):
    def test_an_absent_bar_is_a_no_op(self):
        advance_progress(None, 3, 10)

    def test_updates_are_absolute_and_carry_no_preview(self):
        bar = RecordingBar()
        advance_progress(bar, 3, 10)
        advance_progress(bar, 4, 10)
        self.assertEqual(bar.updates, [(3, 10, None), (4, 10, None)])

    def test_a_broken_bar_never_breaks_the_operation(self):
        advance_progress(BrokenBar(), 1, 10)

    def test_an_interrupt_raised_by_the_bar_still_gets_out(self):
        with self.assertRaises(FakeInterrupt):
            advance_progress(InterruptingBar(), 1, 10)


class InterruptSeamTests(unittest.TestCase):
    def test_an_uninterrupted_queue_lets_the_loop_continue(self):
        self.assertIsNone(raise_if_interrupted())


class WarnOnceTests(unittest.TestCase):
    def printed(self, *calls) -> list[str]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            for args, kwargs in calls:
                warn_once(*args, **kwargs)
        return buffer.getvalue().splitlines()

    def test_each_message_prints_once_with_the_pack_prefix(self):
        seen: set[str] = set()
        lines = self.printed(
            (("first", seen), {}), (("first", seen), {}), (("second", seen), {})
        )
        self.assertEqual(lines, ["[AusBoss] first", "[AusBoss] second"])

    def test_a_key_decides_what_counts_as_a_repeat(self):
        seen: set[str] = set()
        lines = self.printed(
            (("same text", seen), {"key": "node a"}),
            (("same text", seen), {"key": "node b"}),
            (("other text", seen), {"key": "node a"}),
        )
        self.assertEqual(lines, ["[AusBoss] same text", "[AusBoss] same text"])
        self.assertEqual(seen, {"node a", "node b"})

    def test_a_limit_starts_over_instead_of_growing(self):
        capped: set[str] = set()
        kept: set[str] = set()
        with contextlib.redirect_stdout(io.StringIO()):
            for index in range(5):
                warn_once(f"note {index}", capped, limit=3)
                warn_once(f"note {index}", kept)
        # Past three remembered notes the set was cleared before the fifth.
        self.assertEqual(capped, {"note 4"})
        self.assertEqual(len(kept), 5)


@unittest.skipIf(torch is None, "needs torch")
class ComfyTorchDeviceTests(unittest.TestCase):
    def test_comfy_chooses_the_device(self):
        entries = fake_comfy(model_management={"get_torch_device": lambda: "cpu"})
        with patch.dict(sys.modules, entries):
            self.assertEqual(comfy_torch_device(), torch.device("cpu"))

    def test_offline_it_falls_back_to_cuda_or_cpu(self):
        with patch.dict(sys.modules, {"comfy": None}):
            expected = "cuda" if torch.cuda.is_available() else "cpu"
            self.assertEqual(comfy_torch_device().type, expected)


@unittest.skipIf(torch is None, "the helper modules need torch")
class SharedSeamTests(unittest.TestCase):
    def test_the_helpers_share_one_copy_of_each_seam(self):
        from nodes import _inpaint_crop_helpers, _interpolate_helpers, _lama_helpers, _mask_helpers

        for module in (_inpaint_crop_helpers, _interpolate_helpers, _lama_helpers, _mask_helpers):
            with self.subTest(module=module.__name__):
                self.assertIs(module.raise_if_interrupted, _execution_helpers.raise_if_interrupted)
        for module in (_inpaint_crop_helpers, _interpolate_helpers, _lama_helpers):
            self.assertIs(module.progress_bar, _execution_helpers.progress_bar)
        # Frame Interpolate reads the device from here, not from LaMa's module.
        self.assertIs(_interpolate_helpers.comfy_torch_device, _execution_helpers.comfy_torch_device)
        self.assertIs(_lama_helpers.comfy_torch_device, _execution_helpers.comfy_torch_device)


if __name__ == "__main__":
    unittest.main()
