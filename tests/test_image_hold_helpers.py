from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _image_hold_helpers  # noqa: E402
from nodes._image_hold_helpers import GONE, HELD_FOLDER, hold_pictures, keep_pictures  # noqa: E402

NOW = datetime(2026, 11, 10, 9, 30, 0)


def settings(**changes):
    base = {
        "format": "png", "extension": "png", "width": 64, "height": 96, "exact": "",
        "filename_prefix": "shoot", "on_existing": "overwrite", "output_dir": "",
        "name_counter": True, "name_date": False, "name_time": False, "name_size": False,
        "name_batch": False, "caption": "",
    }
    base.update(changes)
    return base


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.box = tempfile.TemporaryDirectory()
        self.temp = Path(self.box.name) / "temp"
        self.output = Path(self.box.name) / "output"
        self.temp.mkdir()
        self.output.mkdir()

    def tearDown(self):
        self.box.cleanup()

    def hold(self, count=3, **changes):
        frames = [f"picture {index}".encode() for index in range(count)]
        return hold_pictures(self.temp, frames, settings(**changes), lambda path, frame: path.write_bytes(frame))

    def keep(self, token, picks=None):
        return keep_pictures(self.temp, self.output, token, picks, now=NOW)

    def test_a_held_run_saves_nothing_until_it_is_kept(self):
        token, previews = self.hold()
        self.assertEqual(len(previews), 3)
        self.assertTrue(all(entry["type"] == "temp" and entry["subfolder"] == HELD_FOLDER for entry in previews))
        self.assertEqual(list(self.output.iterdir()), [])
        answer = self.keep(token)
        self.assertEqual([item["path"] for item in answer["saved"]], ["shoot_00001.png", "shoot_00002.png", "shoot_00003.png"])
        self.assertEqual((self.output / "shoot_00002.png").read_bytes(), b"picture 1")

    def test_one_picture_can_be_kept_and_is_not_saved_twice(self):
        token, _ = self.hold()
        first = self.keep(token, [2])
        self.assertEqual(first["saved"], [{"index": 2, "path": "shoot_00001.png"}])
        self.assertEqual((self.output / "shoot_00001.png").read_bytes(), b"picture 2")
        again = self.keep(token, [2])
        self.assertEqual(again["saved"], [])
        rest = self.keep(token)
        self.assertEqual([item["index"] for item in rest["saved"]], [0, 1])
        self.assertEqual(rest["kept"], [0, 1, 2])
        self.assertEqual(sorted(entry.name for entry in self.output.iterdir()), ["shoot_00001.png", "shoot_00002.png", "shoot_00003.png"])

    def test_the_folder_and_caption_of_the_run_are_used(self):
        token, _ = self.hold(count=1, output_dir="sets/portraits", caption="a portrait")
        answer = self.keep(token)
        self.assertEqual(answer["saved"][0]["path"], "sets/portraits/shoot_00001.png")
        self.assertEqual((self.output / "sets/portraits/shoot_00001.txt").read_text(), "a portrait")

    def test_an_exact_name_keeps_its_place_in_the_run(self):
        token, _ = self.hold(count=3, exact="portrait")
        whole = [item["path"] for item in self.keep(self.hold(count=3, exact="other")[0])["saved"]]
        picked = self.keep(token, [1])["saved"][0]["path"]
        self.assertEqual(picked, whole[1].replace("other", "portrait"))

    def test_a_request_cannot_name_a_place(self):
        token, _ = self.hold()
        for bad in ["../" + token, token + "/..", "", None, 5, token.upper(), "g" * 16]:
            with self.assertRaises(ValueError):
                self.keep(bad)
        for picks in [[3], [-1], ["0"], [True], [0.0]]:
            with self.assertRaises(ValueError):
                self.keep(token, picks)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_pictures_that_are_gone_say_so(self):
        with self.assertRaises(LookupError) as caught:
            self.keep("0" * 16)
        self.assertEqual(str(caught.exception), GONE)
        token, previews = self.hold(count=1)
        (self.temp / HELD_FOLDER / previews[0]["filename"]).unlink()
        with self.assertRaises(LookupError):
            self.keep(token)

    def test_a_folder_outside_the_output_folder_is_refused_at_the_click_too(self):
        token, _ = self.hold(count=1)
        _image_hold_helpers._RUNS[token]["output_dir"] = "../elsewhere"
        with self.assertRaises(ValueError):
            self.keep(token)
        self.assertFalse((Path(self.box.name) / "elsewhere").exists())

    def test_a_run_planted_in_the_temp_folder_is_not_a_run(self):
        # ComfyUI's temp folder takes uploads, so a file there can be
        # anyone's. A planted list naming a server file must copy nothing.
        secret = Path(self.box.name) / "secret.txt"
        secret.write_text("server secret")
        held = self.temp / HELD_FOLDER
        held.mkdir(exist_ok=True)
        token = "a" * 16
        planted = dict(
            settings(extension="png/../../../secret.txt", output_dir="x/y"), count=1, kept={},
        )
        (held / f"{token}.json").write_text(json.dumps(planted))
        (held / f"{token}_000.png").mkdir()  # an upload's subfolder makes the ".." walk work
        with self.assertRaises(LookupError):
            self.keep(token)
        self.assertEqual(list(self.output.rglob("*")), [])

    def test_a_held_picture_is_named_only_from_the_token_number_and_format(self):
        token, previews = self.hold(count=1)
        for extension in ["png/../../x", "txt", "", "PNG"]:
            with self.assertRaises(ValueError):
                _image_hold_helpers._held_name(token, 0, extension)
        _image_hold_helpers._RUNS[token]["extension"] = "png/../../../secret.txt"
        with self.assertRaises(ValueError):
            self.keep(token)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_a_picture_swapped_for_a_link_is_not_copied(self):
        token, previews = self.hold(count=1)
        secret = Path(self.box.name) / "secret.txt"
        secret.write_text("server secret")
        picture = self.temp / HELD_FOLDER / previews[0]["filename"]
        picture.unlink()
        try:
            picture.symlink_to(secret)
        except (OSError, NotImplementedError):
            self.skipTest("no symlinks here")
        with self.assertRaises(LookupError):
            self.keep(token)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_counts_are_capped(self):
        with patch.object(_image_hold_helpers, "MAX_HELD_PICTURES", 4):
            with self.assertRaises(ValueError):
                self.hold(count=5)
            token, _ = self.hold(count=2)
            with self.assertRaises(ValueError):
                self.keep(token, [0] * 5)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_old_runs_are_forgotten_first(self):
        with patch.object(_image_hold_helpers, "MAX_HELD_RUNS", 2):
            oldest, _ = self.hold(count=1)
            self.hold(count=1)
            newest, _ = self.hold(count=1)
            with self.assertRaises(LookupError):
                self.keep(oldest)
            self.assertEqual(len(self.keep(newest)["saved"]), 1)


if __name__ == "__main__":
    unittest.main()
