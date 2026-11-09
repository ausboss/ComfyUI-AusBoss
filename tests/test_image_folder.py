"""Image Folder: which pictures a folder holds, which are picked, what a run
loads, and that no folder name ever leads out of ComfyUI's own folders. The
root is a temp folder, so these run without ComfyUI."""

from __future__ import annotations

import json
import asyncio
import os
from io import BytesIO
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import node_image_folder  # noqa: E402
from nodes._image_folder_helpers import (  # noqa: E402
    AT_THE_END,
    BAD_PICKS,
    MAX_PICTURES,
    NO_MASK_SIZE,
    NONE_LEFT,
    NONE_PICKED,
    OUTSIDE,
    RUNS,
    THE_END,
    choose,
    clean_folder,
    fingerprint,
    list_folders,
    list_pictures,
    load_picture,
    natural_key,
    output_name,
    parse_picked,
    place_inside,
    safe_folder,
    thumbnail,
    which,
)


def picture(path: Path, size=(40, 30), color=(200, 40, 40), mode="RGB"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new(mode, size, color if mode == "RGB" else (*color, 255)).save(path)


class FolderCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "input"
        self.outside = Path(self.temp.name) / "private"
        picture(self.root / "people" / "photo_10.png")
        picture(self.root / "people" / "photo_2.png")
        picture(self.root / "people" / "Anna.jpg")
        picture(self.root / "people" / "trips" / "beach.png")
        picture(self.root / "top.png")
        picture(self.outside / "secret.png")
        (self.root / "people" / "notes.txt").write_text("not a picture")
        (self.root / "people" / ".hidden.png").write_bytes(b"x")
        real = node_image_folder._root
        node_image_folder._root = lambda source: self.root.resolve()
        self.addCleanup(setattr, node_image_folder, "_root", real)

    def names(self, *args, **kwargs):
        return [item["name"] for item in list_pictures(self.root, *args, **kwargs)]

    def run_node(self, **overrides):
        values = {"source": "input", "folder": "people", "subfolders": False, "sort": "name", "pictures": "",
                  "run": RUNS[0], "position": 1, "after_run": "next", "at_the_end": AT_THE_END[0]}
        values.update(overrides)
        return node_image_folder.AusBossImageFolder().load(**values)


class ListingTests(FolderCase):
    def test_the_limit_is_applied_in_the_requested_order(self):
        base = self.root / "ordered"
        for name, stamp in [("a10.png", 100), ("a2.png", 200), ("z.png", 300)]:
            picture(base / name)
            os.utime(base / name, (stamp, stamp))
        self.assertEqual(self.names("ordered", sort="name", limit=2), ["a2.png", "a10.png"])
        self.assertEqual(self.names("ordered", sort="newest first", limit=2), ["z.png", "a2.png"])
        self.assertEqual(self.names("ordered", sort="oldest first", limit=2), ["a10.png", "a2.png"])

    def test_the_production_limit_keeps_the_newest_file(self):
        base = self.root / "many"
        base.mkdir()
        for number in range(MAX_PICTURES):
            path = base / f"a{number:04d}.png"
            path.touch()
            os.utime(path, (100, 100))
        picture(base / "z-newest.png")
        os.utime(base / "z-newest.png", (200, 200))
        names = self.names("many", sort="newest first")
        self.assertEqual(len(names), MAX_PICTURES)
        self.assertEqual(names[0], "z-newest.png")

    def test_a_folder_lists_its_pictures_in_natural_order(self):
        self.assertEqual(self.names("people"), ["Anna.jpg", "photo_2.png", "photo_10.png"])
        self.assertEqual(natural_key("photo_2") < natural_key("photo_10"), True)

    def test_subfolders_are_included_only_when_asked(self):
        self.assertEqual(self.names("people", True), ["Anna.jpg", "photo_2.png", "photo_10.png", "trips/beach.png"])
        self.assertEqual(self.names(""), ["top.png"])
        self.assertEqual(len(self.names("", True)), 5)

    def test_newest_first_and_oldest_first_follow_the_files(self):
        base = self.root / "people"
        for age, name in enumerate(["photo_2.png", "Anna.jpg", "photo_10.png"]):
            os.utime(base / name, (1000 + age, 1000 + age))
        self.assertEqual(self.names("people", sort="newest first"), ["photo_10.png", "Anna.jpg", "photo_2.png"])
        self.assertEqual(self.names("people", sort="oldest first"), ["photo_2.png", "Anna.jpg", "photo_10.png"])

    def test_the_folders_inside_are_listed_for_browse(self):
        self.assertEqual(list_folders(self.root, ""), ["people"])
        self.assertEqual(list_folders(self.root, "people"), ["trips"])

    def test_no_folder_name_leads_out_of_the_root(self):
        for bad in ("..", "../private", "people/../../private", "/etc", "~/Pictures", "C:/Windows", "//server/share",
                    "people\\..\\..\\private"):
            with self.assertRaises(ValueError, msg=bad) as refused:
                safe_folder(self.root, bad)
            self.assertEqual(str(refused.exception), OUTSIDE, bad)
        self.assertEqual(clean_folder("./people//trips/"), "people/trips")

    def test_a_link_that_leads_out_is_refused_and_never_listed(self):
        (self.root / "way_out").symlink_to(self.outside, target_is_directory=True)
        (self.root / "people" / "linked.png").symlink_to(self.outside / "secret.png")
        with self.assertRaises(ValueError) as refused:
            safe_folder(self.root, "way_out")
        self.assertEqual(str(refused.exception), OUTSIDE)
        self.assertNotIn("way_out", list_folders(self.root, ""))
        self.assertNotIn("linked.png", self.names("people"))
        self.assertFalse(any("secret" in name for name in self.names("", True)))

    def test_a_pasted_whole_path_inside_comfyui_is_read_as_its_folder(self):
        roots = {"input": self.root, "output": Path(self.temp.name) / "output"}
        self.assertEqual(place_inside(str(self.root / "people" / "trips"), roots), ("input", "people/trips"))
        self.assertEqual(place_inside(str(self.root) + "/", roots), ("input", ""))
        self.assertEqual(place_inside(str(roots["output"] / "set"), roots), ("output", "set"))
        self.assertEqual(place_inside(f'"{self.root / "people"}"', roots), ("input", "people"), "quotes from a copied path")

    def test_a_whole_path_anywhere_else_is_not_a_place(self):
        roots = {"input": self.root, "output": Path(self.temp.name) / "output"}
        self.assertIsNone(place_inside(str(self.outside), roots))
        self.assertIsNone(place_inside(str(self.root) + "_other/x", roots), "a neighbour whose name only starts the same")
        self.assertIsNone(place_inside("//server/share/x", roots), "another machine is refused from its text")
        self.assertIsNone(place_inside("people/trips", roots), "a folder name is not a whole path")
        self.assertIsNone(place_inside(str(self.root / "people" / ".." / ".." / "private"), roots))

    def test_a_folder_that_is_not_there_says_so(self):
        with self.assertRaises(ValueError) as missing:
            safe_folder(self.root, "nowhere")
        self.assertIn('no folder "nowhere"', str(missing.exception))


class PickingTests(FolderCase):
    def test_empty_means_every_picture_and_a_list_keeps_the_folder_order(self):
        listed = list_pictures(self.root, "people")
        self.assertIsNone(parse_picked(""))
        self.assertEqual(len(choose(listed, None)), 3)
        picked = parse_picked(json.dumps(["photo_10.png", "Anna.jpg", "Anna.jpg"]))
        self.assertEqual(picked, ["photo_10.png", "Anna.jpg"])
        self.assertEqual([item["name"] for item in choose(listed, picked)], ["Anna.jpg", "photo_10.png"])

    def test_picked_names_are_compared_never_opened(self):
        listed = list_pictures(self.root, "people")
        with self.assertRaises(ValueError) as gone:
            choose(listed, ["../../private/secret.png"])
        self.assertEqual(str(gone.exception), NONE_LEFT)
        self.assertEqual([item["name"] for item in choose(listed, ["../../private/secret.png", "Anna.jpg"])], ["Anna.jpg"])

    def test_nothing_picked_says_so(self):
        listed = list_pictures(self.root, "people")
        with self.assertRaises(ValueError) as nothing:
            choose(listed, parse_picked("[]"))
        self.assertEqual(str(nothing.exception), NONE_PICKED)

    def test_a_damaged_list_is_refused(self):
        for bad in ("{", '"photo.png"', "[1, 2]", '{"a": 1}'):
            with self.assertRaises(ValueError) as refused:
                parse_picked(bad)
            self.assertEqual(str(refused.exception), BAD_PICKS)

    def test_all_in_one_run_takes_every_picture_and_one_per_run_takes_one(self):
        self.assertEqual(which(3, 2, RUNS[0], AT_THE_END[0]), [0, 1, 2])
        self.assertEqual(which(3, 2, RUNS[1], AT_THE_END[0]), [1])
        self.assertEqual(which(3, 0, RUNS[1], AT_THE_END[0]), [0])

    def test_after_the_last_picture_it_stops_or_starts_over(self):
        with self.assertRaises(RuntimeError) as stopped:
            which(3, 4, RUNS[1], AT_THE_END[0])
        self.assertEqual(str(stopped.exception), THE_END.format(count=3))
        self.assertEqual(which(3, 4, RUNS[1], AT_THE_END[1]), [0])
        self.assertEqual(which(3, 9, RUNS[1], AT_THE_END[1]), [2])

    def test_the_saved_name_drops_the_ending_and_carries_the_folder(self):
        self.assertEqual(output_name("photo_2.png"), "photo_2")
        self.assertEqual(output_name("trips/beach.final.png"), "trips_beach.final")
        self.assertEqual(output_name("v1.2/portrait"), "v1.2_portrait")


class LoadingTests(FolderCase):
    def test_rgb_and_grayscale_transparency_produce_masks_and_dark_thumbnails(self):
        for mode, color, transparency in [("RGB", (255, 0, 0), (255, 0, 0)), ("L", 0, 0)]:
            with self.subTest(mode=mode):
                path = self.root / f"transparent-{mode}.png"
                Image.new(mode, (3, 2), color).save(path, transparency=transparency)
                _image, mask = load_picture(path)
                self.assertEqual(tuple(mask.shape), (1, 2, 3))
                self.assertEqual(float(mask.sum()), 6.0)
                with Image.open(BytesIO(thumbnail(path))) as small:
                    pixel = small.getpixel((0, 0))
                self.assertTrue(all(abs(a - b) <= 3 for a, b in zip(pixel, (27, 35, 38))))

    def test_a_picture_loads_as_image_and_the_no_mask_stand_in(self):
        image, mask = load_picture(self.root / "people" / "photo_2.png")
        self.assertEqual(tuple(image.shape), (1, 30, 40, 3))
        self.assertAlmostEqual(float(image[0, 0, 0, 0]), 200 / 255, places=4)
        self.assertEqual(tuple(mask.shape), (1, *NO_MASK_SIZE))
        self.assertEqual(float(mask.sum()), 0.0)

    def test_a_see_through_part_is_white_in_the_mask(self):
        path = self.root / "cut.png"
        cut = Image.new("RGBA", (20, 10), (10, 20, 30, 255))
        cut.paste((0, 0, 0, 0), (0, 0, 10, 10))
        cut.save(path)
        image, mask = load_picture(path)
        self.assertEqual(tuple(mask.shape), (1, 10, 20))
        self.assertEqual((float(mask[0, 5, 2]), float(mask[0, 5, 15])), (1.0, 0.0))
        self.assertEqual(tuple(image.shape), (1, 10, 20, 3))

    def test_a_turned_photo_comes_out_upright(self):
        path = self.root / "turned.jpg"
        photo = Image.new("RGB", (40, 20), (5, 5, 5))
        exif = photo.getexif()
        exif[0x0112] = 6
        photo.save(path, exif=exif)
        image, _mask = load_picture(path)
        self.assertEqual(tuple(image.shape), (1, 40, 20, 3))

    def test_a_thumbnail_is_small_and_follows_the_file(self):
        path = self.root / "big.png"
        picture(path, size=(900, 600))
        first = thumbnail(path, 160)
        small = Image.open(__import__("io").BytesIO(first))
        self.assertEqual(max(small.size), 160)
        self.assertIs(thumbnail(path, 160), first, "the same file gives the cached copy")
        picture(path, size=(900, 600), color=(0, 200, 0))
        os.utime(path, (2000, 2000))
        self.assertIsNot(thumbnail(path, 160), first, "a rewritten file gets a new one")

    def test_the_fingerprint_changes_with_the_files(self):
        before = fingerprint(list_pictures(self.root, "people"))
        self.assertEqual(before, fingerprint(list_pictures(self.root, "people")))
        picture(self.root / "people" / "new.png")
        self.assertNotEqual(before, fingerprint(list_pictures(self.root, "people")))


class NodeTests(FolderCase):
    def test_runs_above_64_report_every_loaded_picture(self):
        for number in range(65):
            picture(self.root / "many" / f"{number}.png", size=(2, 2))
        out = self.run_node(folder="many")
        note = out["ui"][node_image_folder.UI_KEY][0]
        self.assertEqual(note["loaded"], out["result"][3])
        self.assertEqual(len(note["names"]), 65)

    def test_completion_records_identify_the_folder_used_by_the_run(self):
        note = self.run_node()["ui"][node_image_folder.UI_KEY][0]
        self.assertEqual(note.get("context"), {"source": "input", "folder": "people", "subfolders": False})

    def test_all_in_one_run_gives_a_list_of_everything(self):
        out = self.run_node()
        images, masks, names, numbers, count = out["result"]
        self.assertEqual((len(images), len(masks), count), (3, 3, 3))
        self.assertEqual(names, ["Anna", "photo_2", "photo_10"])
        self.assertEqual(numbers, [1, 2, 3])
        self.assertEqual(out["ui"]["ausboss_image_folder"][0]["count"], 3)

    def test_picked_pictures_only(self):
        out = self.run_node(pictures=json.dumps(["photo_10.png", "Anna.jpg"]))
        self.assertEqual(out["result"][2], ["Anna", "photo_10"])
        self.assertEqual(out["result"][4], 2)

    def test_one_per_run_loads_the_picture_at_its_place(self):
        out = self.run_node(run=RUNS[1], position=2)
        _images, _masks, names, numbers, count = out["result"]
        self.assertEqual((names, numbers, count), (["photo_2"], [2], 3))
        self.assertEqual(out["ui"]["ausboss_image_folder"][0], {
            "count": 3, "loaded": [2], "names": ["photo_2.png"],
            "context": {"source": "input", "folder": "people", "subfolders": False},
        })

    def test_one_per_run_stops_after_the_last_or_starts_over(self):
        with self.assertRaises(RuntimeError) as stopped:
            self.run_node(run=RUNS[1], position=4)
        self.assertEqual(str(stopped.exception), THE_END.format(count=3))
        self.assertEqual(self.run_node(run=RUNS[1], position=4, at_the_end=AT_THE_END[1])["result"][2], ["Anna"])

    def test_a_pasted_path_inside_the_input_folder_loads(self):
        out = self.run_node(folder=str(self.root / "people"))
        self.assertEqual(out["result"][2], ["Anna", "photo_2", "photo_10"])
        with self.assertRaises(ValueError) as refused:
            self.run_node(folder=str(self.outside))
        self.assertEqual(str(refused.exception), OUTSIDE)
        self.assertIn("Drop your folder on the node", OUTSIDE)

    def test_subfolders_carry_their_folder_in_the_name(self):
        out = self.run_node(subfolders=True)
        self.assertEqual(out["result"][2], ["Anna", "photo_2", "photo_10", "trips_beach"])

    def test_an_empty_folder_says_what_to_do(self):
        (self.root / "empty").mkdir()
        with self.assertRaises(ValueError) as empty:
            self.run_node(folder="empty")
        self.assertIn('no pictures in "empty"', str(empty.exception))
        self.assertIn("no pictures", node_image_folder.AusBossImageFolder.VALIDATE_INPUTS("input", "empty"))
        self.assertIs(node_image_folder.AusBossImageFolder.VALIDATE_INPUTS("input", "people"), True)
        self.assertEqual(node_image_folder.AusBossImageFolder.VALIDATE_INPUTS("input", "../private"), OUTSIDE)
        self.assertIs(node_image_folder.AusBossImageFolder.VALIDATE_INPUTS("input", None), True)

    def test_it_reruns_when_the_folder_changes_and_per_step(self):
        changed = node_image_folder.AusBossImageFolder.IS_CHANGED
        args = dict(source="input", folder="people", subfolders=False, sort="name", pictures="", run=RUNS[0], position=1, after_run="next", at_the_end=AT_THE_END[0])
        first = changed(**args)
        self.assertEqual(first, changed(**{**args, "position": 2}), "all in one run does not depend on the place")
        self.assertNotEqual(changed(**{**args, "run": RUNS[1]}), changed(**{**args, "run": RUNS[1], "position": 2}))
        picture(self.root / "people" / "added.png")
        self.assertNotEqual(first, changed(**args))

    def test_the_outputs_are_lists_except_the_count(self):
        node = node_image_folder.AusBossImageFolder
        self.assertEqual(node.RETURN_NAMES, ("image", "mask", "filename", "index", "count"))
        self.assertEqual(node.OUTPUT_IS_LIST, (True, True, True, True, False))

    def test_the_messages_are_ascii(self):
        for text in (OUTSIDE, NONE_LEFT, NONE_PICKED, BAD_PICKS, THE_END.format(count=3)):
            text.encode("ascii")


class RouteTests(FolderCase):
    def setUp(self):
        super().setUp()
        self.handlers = {}
        handlers = self.handlers

        class Routes:
            def get(self, address):
                def register(fn):
                    handlers[address] = fn
                    return fn
                return register

        server = SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=Routes())))
        with patch.dict(sys.modules, {"server": server}):
            node_image_folder._register_routes()

    def request(self, route, **query):
        request = SimpleNamespace(rel_url=SimpleNamespace(query=query))
        return asyncio.run(self.handlers[f"/ausboss/image_folder/{route}"](request))

    def test_route_errors_hide_server_paths(self):
        (self.root / "loop").symlink_to("loop", target_is_directory=True)
        for route, query in [("list", {"folder": "loop"}), ("folders", {"folder": "loop"}),
                             ("thumb", {"name": "loop/picture.png"})]:
            with self.subTest(route=route):
                response = self.request(route, **query)
                self.assertEqual(response.status, 400)
                self.assertNotIn(str(self.root), json.loads(response.text)["error"])

    def test_thumbnail_versions_change_with_subsecond_rewrites_and_size(self):
        path = self.root / "top.png"
        os.utime(path, ns=(1_700_000_000_100_000_000,) * 2)
        def version():
            response = self.request("list")
            self.assertEqual(response.status, 200)
            return json.loads(response.text)["pictures"][0]["v"]
        first = version()
        picture(path, color=(0, 0, 255))
        os.utime(path, ns=(1_700_000_000_800_000_000,) * 2)
        second = version()
        self.assertNotEqual(first, second)
        self.assertIsInstance(second, str)
        picture(path, size=(80, 90))
        os.utime(path, ns=(1_700_000_000_800_000_000,) * 2)
        self.assertNotEqual(second, version())


if __name__ == "__main__":
    unittest.main()
