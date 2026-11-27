"""When a queued run asks ComfyUI for step pictures (nodes/_step_preview_helpers.py)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

_PATH = Path(__file__).resolve().parent.parent / "nodes" / "_step_preview_helpers.py"
_SPEC = importlib.util.spec_from_file_location("_step_preview_helpers", _PATH)
helpers = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(helpers)


def body(prompt, extra=None):
    data = {"prompt": prompt, "client_id": "abc"}
    if extra is not None:
        data["extra_data"] = extra
    return data


SAMPLER = {"class_type": "KSampler", "inputs": {"seed": 1}}


class WantsStepPictures(unittest.TestCase):
    def test_step_preview_node_asks(self):
        prompt = {"1": SAMPLER, "2": {"class_type": "AUSBOSS_NODES_StepPreview", "inputs": {}}}
        self.assertTrue(helpers.wants_step_pictures(prompt))

    def test_save_image_switch(self):
        on = {"1": SAMPLER, "2": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"step_preview": True}}}
        off = {"1": SAMPLER, "2": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"step_preview": False}}}
        self.assertTrue(helpers.wants_step_pictures(on))
        self.assertFalse(helpers.wants_step_pictures(off))

    def test_missing_switch_takes_the_default(self):
        prompt = {"2": {"class_type": "AUSBOSS_NODES_SaveVideo", "inputs": {}}}
        self.assertEqual(helpers.wants_step_pictures(prompt), helpers.STEP_PREVIEW_DEFAULT)

    def test_picture_switched_off_has_nowhere_to_show_them(self):
        prompt = {"2": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"step_preview": True, "preview": False}}}
        self.assertFalse(helpers.wants_step_pictures(prompt))

    def test_linked_switch_counts_as_on(self):
        prompt = {"2": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"step_preview": ["7", 0]}}}
        self.assertTrue(helpers.wants_step_pictures(prompt))

    def test_other_nodes_and_junk_do_not_ask(self):
        self.assertFalse(helpers.wants_step_pictures({"1": SAMPLER, "2": {"class_type": "SaveImage", "inputs": {}}}))
        self.assertFalse(helpers.wants_step_pictures(None))
        self.assertFalse(helpers.wants_step_pictures({"1": "x", "2": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": "x"}}))


class AskForStepPictures(unittest.TestCase):
    PROMPT = {"1": SAMPLER, "2": {"class_type": "AUSBOSS_NODES_StepPreview", "inputs": {}}}

    def test_nothing_chosen_becomes_auto(self):
        for extra in (None, {}, {"preview_method": "default"}, {"preview_method": ""}):
            data = helpers.ask_for_step_pictures(body(self.PROMPT, extra), "none")
            self.assertEqual(data["extra_data"]["preview_method"], "auto", extra)

    def test_a_users_choice_wins(self):
        for chosen in ("none", "latent2rgb", "taesd", "auto"):
            data = helpers.ask_for_step_pictures(body(self.PROMPT, {"preview_method": chosen}), "none")
            self.assertEqual(data["extra_data"]["preview_method"], chosen)

    def test_the_servers_own_method_wins(self):
        data = helpers.ask_for_step_pictures(body(self.PROMPT, {}), "taesd")
        self.assertNotIn("preview_method", data["extra_data"])

    def test_a_run_that_shows_no_steps_is_left_alone(self):
        data = helpers.ask_for_step_pictures(body({"1": SAMPLER}, {}), "none")
        self.assertEqual(data["extra_data"], {})

    def test_other_keys_survive(self):
        extra = {"extra_pnginfo": {"workflow": {}}, "client_id": "abc"}
        data = helpers.ask_for_step_pictures(body(self.PROMPT, extra), "none")
        self.assertEqual(data["extra_data"]["extra_pnginfo"], {"workflow": {}})
        self.assertEqual(data["client_id"], "abc")

    def test_junk_bodies_pass_through(self):
        self.assertIsNone(helpers.ask_for_step_pictures(None, "none"))
        self.assertEqual(helpers.ask_for_step_pictures({"prompt": self.PROMPT, "extra_data": "x"}, "none")["extra_data"], "x")


class FramePicks(unittest.TestCase):
    def test_about_one_frame_per_second_of_an_h3_clip(self):
        # 124 frames at 24 fps (about 5 s) is 37 latent frames for H3.
        picks, seconds = helpers.frame_picks(37, 4)
        self.assertEqual(picks, [0, 6, 12, 18, 24, 30, 36])
        self.assertAlmostEqual(seconds, 1.0)

    def test_a_short_clip_still_moves(self):
        picks, seconds = helpers.frame_picks(3, 4)
        self.assertEqual(picks, [0, 2])
        self.assertAlmostEqual(seconds, 2 * 4 / 24)

    def test_a_long_clip_is_capped(self):
        picks, _ = helpers.frame_picks(400, 4)
        self.assertEqual(len(picks), helpers.MAX_FRAMES)
        self.assertEqual((picks[0], picks[-1]), (0, 399))

    def test_one_frame_or_junk_does_not_move(self):
        for frames in (0, 1, None, "x"):
            self.assertEqual(helpers.frame_picks(frames, 4), ([], 0.0), frames)


class _Picture:
    def __init__(self, size=(80, 45)):
        self.size = size

    def convert(self, _mode):
        return self

    def save(self, buffer, **_kwargs):
        buffer.write(b"jpeg")


class _Latent:
    """Just enough of a 5-D tensor: its shape, and slicing by frame."""

    ndim = 5

    def __init__(self, frames):
        self.shape = (1, 24, frames, 45, 80)

    def __getitem__(self, key):
        return ("frame", key[2].start)


class _Previewer:
    def __init__(self):
        self.frames = []
        self.stills = 0
        self.extra = "kept"

    def decode_latent_to_preview(self, x0):
        self.frames.append(x0[1])
        return _Picture()

    def decode_latent_to_preview_image(self, preview_format, x0):
        self.stills += 1
        return (preview_format, "still", 512)


class _Format:
    temporal_downscale_ratio = 4


class MovingStepPicturesTest(unittest.TestCase):
    def make(self):
        sent = []
        inner = _Previewer()
        moving = helpers.MovingStepPictures(inner, _Format(), lambda event, data: sent.append((event, data)), lambda: ("run", "5:3"))
        return moving, inner, sent

    def test_each_step_sends_the_frames_and_keeps_the_still(self):
        moving, inner, sent = self.make()
        self.assertEqual(moving.decode_latent_to_preview_image("JPEG", _Latent(37)), ("JPEG", "still", 512))
        self.assertEqual(inner.frames, [0, 6, 12, 18, 24, 30, 36])
        self.assertEqual(inner.stills, 1)
        event, data = sent[0]
        self.assertEqual(event, helpers.FRAMES_EVENT)
        self.assertEqual((data["prompt_id"], data["node"], len(data["frames"])), ("run", "5:3", 7))
        self.assertTrue(data["frames"][0].startswith("data:image/jpeg;base64,"))
        self.assertAlmostEqual(data["seconds"], 1.0)

    def test_a_still_latent_sends_nothing(self):
        moving, inner, sent = self.make()
        still = _Latent(1)
        moving.decode_latent_to_preview_image("JPEG", still)
        self.assertEqual((sent, inner.frames, inner.stills), ([], [], 1))

    def test_a_failing_previewer_falls_back_to_the_still_for_good(self):
        moving, inner, sent = self.make()
        inner.decode_latent_to_preview = None
        for _ in range(2):
            self.assertEqual(moving.decode_latent_to_preview_image("JPEG", _Latent(37))[1], "still")
        self.assertTrue(moving.failed)
        self.assertEqual(sent, [])

    def test_slow_frames_skip_steps_to_stay_in_budget(self):
        sent = []
        inner = _Previewer()
        times = iter([0.0, 2.0, 10.0, 20.0, 22.0, 30.0])
        moving = helpers.MovingStepPictures(inner, _Format(), lambda e, d: sent.append(d), lambda: ("run", "1"), clock=lambda: next(times))
        # Step 1 at 0 s takes 2 s for its frames: 20 % of a 10 s step.
        # Step 2 at 10 s is skipped (2 s > 10 % of 10 s); step 3 at 20 s sends;
        # step 4 at 30 s is skipped again.
        for _ in range(4):
            moving.decode_latent_to_preview_image("JPEG", _Latent(37))
        self.assertEqual(len(sent), 2)
        self.assertEqual(inner.stills, 4)

    def test_other_attributes_pass_through(self):
        moving, _, _ = self.make()
        self.assertEqual(moving.extra, "kept")


if __name__ == "__main__":
    unittest.main()
