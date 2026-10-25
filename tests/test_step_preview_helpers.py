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


if __name__ == "__main__":
    unittest.main()
