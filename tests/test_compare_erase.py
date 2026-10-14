"""Image Compare A/B's Erase mix: the strokes, the mask, the saved files."""

from __future__ import annotations

import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _compare_helpers as helpers
from nodes._compare_helpers import (
    CompareSaveError,
    brush_core,
    brush_sigma,
    clean_save_name,
    clean_strokes,
    erase_mask,
    mix_pictures,
    pair_pictures,
    remember_pair,
    save_mix,
    tidy_save_name,
)
from nodes._psd_helpers import write_psd

A_NAME = "ausboss_compare_abcde_00001_.png"
B_NAME = "ausboss_compare_abcde_00002_.png"
SOURCES = [ROOT / "nodes" / "node_compare.py", ROOT / "nodes" / "_compare_helpers.py"]


def stroke(points, size=40, soft=0, erase=1):
    return {"o": erase, "d": size, "s": soft, "p": [value for point in points for value in point]}


def read_psd(path: Path) -> dict:
    """The parts of a PSD the tests check, read straight from its bytes."""
    data = path.read_bytes()
    signature, version, channels, height, width, depth, mode = struct.unpack(">4sH6xHIIHH", data[:26])
    at = 26
    at += 4 + struct.unpack(">I", data[at:at + 4])[0]  # colour mode data
    at += 4 + struct.unpack(">I", data[at:at + 4])[0]  # image resources
    block = struct.unpack(">I", data[at:at + 4])[0]
    end = at + 4 + block
    info, count = struct.unpack(">Ih", data[at + 4:at + 10])
    at += 10
    layers = []
    for _ in range(count):
        top, left, bottom, right, planes = struct.unpack(">4iH", data[at:at + 18])
        at += 18
        ids = []
        for _ in range(planes):
            channel, length = struct.unpack(">hI", data[at:at + 6])
            ids.append((channel, length))
            at += 6
        blend, opacity, _clip, flags = data[at + 4:at + 8], data[at + 8], data[at + 9], data[at + 10]
        at += 12
        extra = struct.unpack(">I", data[at:at + 4])[0]
        body = data[at + 4:at + 4 + extra]
        at += 4 + extra
        mask_bytes = struct.unpack(">I", body[:4])[0]
        ranges = struct.unpack(">I", body[4 + mask_bytes:8 + mask_bytes])[0]
        name_at = 8 + mask_bytes + ranges
        name = body[name_at + 1:name_at + 1 + body[name_at]].decode("ascii")
        layers.append({"box": (top, left, bottom, right), "ids": ids, "blend": blend, "opacity": opacity,
                       "flags": flags, "has_mask": mask_bytes == 20, "name": name})
    planes = {}
    for layer in layers:
        for channel, length in layer["ids"]:
            assert data[at:at + 2] == b"\x00\x00"
            planes[(layer["name"], channel)] = np.frombuffer(data[at + 2:at + length], dtype=np.uint8).reshape(height, width)
            at += length
    flat_at = end
    assert data[flat_at:flat_at + 2] == b"\x00\x00"
    flat = np.frombuffer(data[flat_at + 2:], dtype=np.uint8).reshape(3, height, width).transpose(1, 2, 0)
    return {"signature": signature, "version": version, "channels": channels, "size": (width, height),
            "depth": depth, "mode": mode, "layers": layers, "planes": planes, "flat": flat,
            "layer_info": info, "bytes": len(data)}


class BrushTests(unittest.TestCase):
    def test_the_browser_and_the_server_share_the_brush(self):
        source = (ROOT / "js" / "shared" / "compare_erase.mjs").read_text(encoding="utf-8")

        def number(name):
            return int(re.search(rf"export const {name} = (\d+);", source).group(1))

        low, high = re.search(r"export const ERASE_SIZE = \[(\d+), (\d+)\];", source).groups()
        self.assertEqual((int(low), int(high)), helpers.ERASE_SIZE)
        self.assertEqual(number("ERASE_MAX_STROKES"), helpers.ERASE_MAX_STROKES)
        self.assertEqual(number("ERASE_MAX_STROKE_POINTS"), helpers.ERASE_MAX_STROKE_POINTS)
        self.assertEqual(number("ERASE_MAX_POINTS"), helpers.ERASE_MAX_POINTS)
        self.assertEqual(number("ERASE_OUTSIDE"), helpers.ERASE_OUTSIDE)
        # The brush itself is the pack's shared one.
        brush = (ROOT / "js" / "shared" / "brush.mjs").read_text(encoding="utf-8")
        self.assertIn("return (size / 2) * (1 - soft / 2);", brush)
        self.assertIn("return (soft * size) / 8;", brush)
        self.assertIn(f'export const SAVE_NAME = "{helpers.SAVE_NAME}";', source)
        self.assertIn(f"export const SAVE_NAME_MAX = {helpers.SAVE_NAME_MAX};", source)
        self.assertEqual(brush_core(100, 0), 50)
        self.assertEqual(brush_core(100, 1), 25)
        self.assertEqual(brush_sigma(100, 0), 0)
        self.assertEqual(brush_sigma(100, 1), 12.5)

    def test_strokes_are_checked_and_held_to_the_limits(self):
        cleaned = clean_strokes([{"o": 0, "d": 99999, "s": 250, "p": [-99999, 5, 10.5, 99999]}], 64, 48)
        self.assertEqual(cleaned, [{
            "erase": False, "size": 2000.0, "soft": 1.0,
            "points": [(-4096.0, 5.0), (10.5, 48.0 + 4096)],
        }])
        self.assertEqual(clean_strokes(None, 8, 8), [])
        for bad in (
            "paint",
            [7],
            [{"d": 10, "p": [1]}],
            [{"d": 10, "p": [1, 2, 3]}],
            [{"d": 10, "p": [1, "2"]}],
            [{"d": 10, "p": [1, float("nan")]}],
            [{"d": "big", "p": [1, 2]}],
            [{"d": True, "p": [1, 2]}],
            [{"d": 10, "p": [0, 0] * (helpers.ERASE_MAX_STROKE_POINTS + 1)}],
            [{"d": 10, "p": [0, 0]}] * (helpers.ERASE_MAX_STROKES + 1),
        ):
            with self.assertRaises(CompareSaveError):
                clean_strokes(bad, 64, 64)
        full = [{"d": 10, "p": [0, 0] * helpers.ERASE_MAX_STROKE_POINTS}] * (helpers.ERASE_MAX_POINTS // helpers.ERASE_MAX_STROKE_POINTS + 1)
        with self.assertRaises(CompareSaveError):
            clean_strokes(full, 64, 64)


class MaskTests(unittest.TestCase):
    def mask(self, strokes, width=200, height=160):
        return erase_mask(clean_strokes(strokes, width, height), width, height)

    def test_a_hard_dab_is_a_disc_of_the_brush_size(self):
        gone = self.mask([stroke([(100, 80)], size=60)])
        self.assertEqual(gone.shape, (160, 200))
        self.assertAlmostEqual(float(gone.sum()), np.pi * 30 * 30, delta=4)
        self.assertEqual(gone[80, 100], 1.0)
        self.assertEqual(gone[80, 135], 0.0)
        self.assertEqual(gone[10, 10], 0.0)

    def test_a_stroke_covers_the_whole_line(self):
        gone = self.mask([stroke([(40, 80), (160, 80)], size=20)])
        self.assertTrue((gone[75:85, 40:160] == 1.0).all())
        # Round ends, flat sides.
        self.assertAlmostEqual(float(gone.sum()), 120 * 20 + np.pi * 100, delta=4)

    def test_a_soft_brush_is_half_gone_at_the_rim_of_its_middle(self):
        gone = self.mask([stroke([(20, 80), (180, 80)], size=80, soft=100)])
        core = brush_core(80, 1.0)  # 20
        self.assertGreater(gone[80, 100], 0.93)
        self.assertAlmostEqual(float(gone[80 - int(core), 100]), 0.5, delta=0.06)
        self.assertLess(gone[80 - 40, 100], 0.04)
        # It falls away steadily from the middle out.
        column = gone[40:81, 100]
        self.assertTrue((np.diff(column) >= -1e-6).all())

    def test_bringing_back_undoes_rubbing_away(self):
        both = [stroke([(100, 80)], size=120), stroke([(100, 80)], size=60, erase=0)]
        gone = self.mask(both)
        self.assertEqual(gone[80, 100], 0.0)
        self.assertEqual(gone[80, 100 + 45], 1.0)
        self.assertEqual(self.mask(list(reversed(both)))[80, 100], 1.0)

    def test_a_stroke_along_the_edge_reaches_the_edge(self):
        # The brush runs off the picture: the edge row is as gone as the middle.
        gone = self.mask([stroke([(-50, 0), (250, 0)], size=60, soft=100)])
        self.assertGreater(gone[0, 100], 0.93)
        self.assertGreater(gone[0, 0], 0.93)
        outside = self.mask([stroke([(-500, -500)], size=40)])
        self.assertEqual(float(outside.sum()), 0.0)

    def test_the_mix_takes_each_picture_where_the_mask_says(self):
        top = np.full((4, 4, 3), 200, dtype=np.uint8)
        under = np.full((4, 4, 3), 100, dtype=np.uint8)
        gone = np.zeros((4, 4), dtype=np.float32)
        gone[0, 0] = 1.0
        gone[0, 1] = 0.5
        mixed = mix_pictures(top, under, gone)
        self.assertEqual(mixed.dtype, np.uint8)
        self.assertEqual(mixed[0, 0].tolist(), [100, 100, 100])
        self.assertEqual(mixed[0, 1].tolist(), [150, 150, 150])
        self.assertEqual(mixed[3, 3].tolist(), [200, 200, 200])


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.temp = Path(self.folder.name) / "temp"
        self.output = Path(self.folder.name) / "output"
        self.temp.mkdir()
        self.output.mkdir()
        self.a = np.zeros((90, 120, 3), dtype=np.uint8)
        self.a[..., 0] = 220
        self.b = np.zeros((90, 120, 3), dtype=np.uint8)
        self.b[..., 2] = 180
        Image.fromarray(self.a).save(self.temp / A_NAME)
        Image.fromarray(self.b).save(self.temp / B_NAME)

    def save(self, **changes):
        options = {
            "picture_a": self.temp / A_NAME, "picture_b": self.temp / B_NAME, "output_dir": self.output,
            "strokes": [stroke([(60, 45)], size=40)],
        }
        options.update(changes)
        return save_mix(**options)

    def test_a_run_is_named_by_a_key_and_never_by_a_file(self):
        key = remember_pair(self.temp / A_NAME, self.temp / B_NAME)
        self.assertEqual(pair_pictures(key), (self.temp / A_NAME, self.temp / B_NAME, ""))
        named = remember_pair(self.temp / A_NAME, self.temp / B_NAME, "photo 12")
        self.assertEqual(pair_pictures(named)[2], "photo 12")
        self.assertNotIn("ausboss_compare", key)
        self.assertNotEqual(key, remember_pair(self.temp / A_NAME, self.temp / B_NAME))
        # Anything that is not a key the server gave out is "run again": a
        # file name, a path, a number, nothing at all.
        for wrong in (None, 7, "", "nope", A_NAME, str(self.temp / A_NAME), "../" + A_NAME, {"filename": A_NAME}, [key]):
            with self.assertRaises(CompareSaveError) as raised:
                pair_pictures(wrong)
            self.assertEqual(raised.exception.status, 404)
            self.assertIn("Run the workflow again", str(raised.exception))
        # The pictures went with ComfyUI's temp folder: the same answer.
        gone = remember_pair(self.temp / "missing_a.png", self.temp / B_NAME)
        with self.assertRaises(CompareSaveError) as raised:
            pair_pictures(gone)
        self.assertEqual(raised.exception.status, 404)

    def test_only_the_newest_runs_are_kept(self):
        first = remember_pair(self.temp / A_NAME, self.temp / B_NAME)
        for _ in range(helpers.PAIRS_KEPT):
            last = remember_pair(self.temp / A_NAME, self.temp / B_NAME)
        with self.assertRaises(CompareSaveError):
            pair_pictures(first)
        self.assertEqual(pair_pictures(last), (self.temp / A_NAME, self.temp / B_NAME, ""))

    def test_the_route_takes_no_file_name_from_the_request(self):
        """The body is a key, the strokes, two choices and a name for the new
        files. No file to read is named, the name goes through
        clean_save_name before anything is built from it, and what the route
        answers names no place on the server's disk."""
        node = SOURCES[0].read_text(encoding="utf-8")
        route = node[node.index("async def save(request):"):node.index("class AusBossCompare:")]
        self.assertEqual(sorted(set(re.findall(r'body\.get\("(\w+)"', route))), ["layers", "name", "pair", "strokes", "top"])
        self.assertIn('clean_save_name(body.get("name"))', route)
        self.assertEqual(route.count('body.get("name")'), 1)
        self.assertIn("safe_route_error(error)", route)
        for source in SOURCES:
            text = source.read_text(encoding="utf-8")
            self.assertNotIn("FileResponse", text)
            self.assertNotIn("rel_url", text)
        save = SOURCES[1].read_text(encoding="utf-8")
        save = save[save.index("def save_mix("):save.index("__all__")]
        self.assertNotIn("subfolder\": subfolder", save)
        for message in (helpers.PICTURES_GONE, helpers.SAVE_NAME_HELP, "Image Compare: the top picture is A or B."):
            self.assertNotRegex(message, r"[\\/]")

    def test_a_typed_name_is_a_plain_name_or_it_is_refused(self):
        for typed, name in (
            (None, "compare"), ("", "compare"), ("   ", "compare"),
            ("mix", "mix"), (" my mix-2_final.v3 ", "my mix-2_final.v3"),
            ("photo.PNG", "photo"), ("Überblick 12", "Überblick 12"), ("写真", "写真"),
            ("x" * 80, "x" * 80),
        ):
            self.assertEqual(clean_save_name(typed), name, typed)
        for bad in (
            "a/b", "..", ".", "../x", "/etc/x", "C:\\x", "a\\b", "a:b", "a\nb", "~x", "a..b", "*.png", "-x",
            "x" * 81, "con<", 'q"', "a|b", "name?", 7, ["mix"], {"name": "mix"},
        ):
            with self.assertRaises(CompareSaveError, msg=repr(bad)):
                clean_save_name(bad)
        # save_mix checks the name itself, whoever calls it.
        with self.assertRaises(CompareSaveError):
            self.save(name="../out")
        with self.assertRaises(CompareSaveError):
            self.save(name="sub/mix")
        self.assertEqual(list(self.output.iterdir()), [])

    def test_a_wired_name_is_tidied_and_never_stops_a_run(self):
        for wired, name in (
            ("sets/a/photo 12.jpg", "photo 12"), ("C:\\pics\\shot.png", "shot"),
            ("../../etc/passwd", "passwd"), ("a:b*c?.webp", "a_b_c"), ("  .hidden  ", "hidden"),
            ("..", ""), ("", ""), (None, ""), (5, ""), ("///", ""),
            ("x" * 200 + ".png", "x" * 80),
        ):
            tidy = tidy_save_name(wired)
            self.assertEqual(tidy, name, wired)
            # Whatever comes out is a name the save takes, or nothing.
            self.assertEqual(clean_save_name(tidy), name or "compare")

    def test_the_name_goes_into_the_file_names(self):
        result = self.save(name="my mix", layers=True)
        self.assertEqual([file["filename"] for file in result["files"]],
                         ["my mix_00001.png", "my mix_00001.psd", "my mix_00001_mask.png"])
        self.assertEqual({file["subfolder"] for file in result["files"]}, {""})
        self.assertEqual(self.save(name="my mix")["files"][0]["filename"], "my mix_00002.png")
        # Each name counts by itself.
        self.assertEqual(self.save()["files"][0]["filename"], "compare_00001.png")
        self.assertEqual({path.parent for path in self.output.iterdir()}, {self.output})

    def test_the_mix_is_saved_as_a_png(self):
        result = self.save()
        self.assertEqual(result["files"], [{"filename": "compare_00001.png", "subfolder": "", "type": "output"}])
        self.assertEqual((result["width"], result["height"]), (120, 90))
        mixed = np.asarray(Image.open(self.output / "compare_00001.png").convert("RGB"))
        self.assertEqual(mixed[45, 60].tolist(), [0, 0, 180])   # rubbed away: B shows
        self.assertEqual(mixed[5, 5].tolist(), [220, 0, 0])     # untouched: A stays
        self.assertEqual(sorted(path.name for path in self.output.iterdir()), ["compare_00001.png"])
        # The next save takes the next number and overwrites nothing.
        self.assertEqual(self.save()["files"][0]["filename"], "compare_00002.png")

    def test_pictures_that_cannot_be_read_say_run_again(self):
        (self.temp / A_NAME).write_bytes(b"not a picture")
        with self.assertRaises(CompareSaveError) as raised:
            self.save()
        self.assertEqual(raised.exception.status, 404)
        self.assertNotIn(str(self.temp), str(raised.exception))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_b_on_top_swaps_the_pictures(self):
        self.save(top="B")
        mixed = np.asarray(Image.open(self.output / "compare_00001.png").convert("RGB"))
        self.assertEqual(mixed[45, 60].tolist(), [220, 0, 0])
        self.assertEqual(mixed[5, 5].tolist(), [0, 0, 180])
        with self.assertRaises(CompareSaveError):
            self.save(top="C")

    def test_no_paint_saves_the_top_picture(self):
        self.save(strokes=[])
        self.assertTrue(np.array_equal(np.asarray(Image.open(self.output / "compare_00001.png").convert("RGB")), self.a))

    def test_layers_add_a_psd_and_the_mask(self):
        result = self.save(layers=True, strokes=[stroke([(60, 45)], size=40, soft=60)])
        self.assertEqual([file["filename"] for file in result["files"]],
                         ["compare_00001.png", "compare_00001.psd", "compare_00001_mask.png"])
        mixed = np.asarray(Image.open(self.output / "compare_00001.png").convert("RGB"))
        mask = np.asarray(Image.open(self.output / "compare_00001_mask.png"))
        self.assertEqual(mask.shape, (90, 120))
        self.assertGreater(mask[45, 60], 240)   # white where B shows
        self.assertEqual(mask[2, 2], 0)

        psd = read_psd(self.output / "compare_00001.psd")
        self.assertEqual((psd["signature"], psd["version"], psd["channels"], psd["depth"], psd["mode"]), (b"8BPS", 1, 3, 8, 3))
        self.assertEqual(psd["size"], (120, 90))
        self.assertEqual([layer["name"] for layer in psd["layers"]], ["B", "A"])   # bottom first
        under, upper = psd["layers"]
        self.assertFalse(under["has_mask"])
        self.assertTrue(upper["has_mask"])
        self.assertEqual([channel for channel, _ in upper["ids"]], [-1, 0, 1, 2, -2])
        for layer in psd["layers"]:
            self.assertEqual(layer["box"], (0, 0, 90, 120))
            self.assertEqual((layer["blend"], layer["opacity"], layer["flags"]), (b"norm", 255, 8))
        self.assertEqual(psd["layer_info"] % 2, 0)
        # Each layer is the whole picture, untouched; the paint is only in the mask.
        self.assertTrue(np.array_equal(np.dstack([psd["planes"][("A", c)] for c in range(3)]), self.a))
        self.assertTrue(np.array_equal(np.dstack([psd["planes"][("B", c)] for c in range(3)]), self.b))
        self.assertTrue((psd["planes"][("A", -1)] == 255).all())
        self.assertTrue(np.array_equal(psd["planes"][("A", -2)], 255 - mask))
        self.assertTrue(np.array_equal(psd["flat"], mixed))
        # Pillow reads the flat picture of the same file.
        with Image.open(self.output / "compare_00001.psd") as opened:
            self.assertEqual((opened.format, opened.size), ("PSD", (120, 90)))
            self.assertTrue(np.array_equal(np.asarray(opened.convert("RGB")), mixed))

    def test_a_b_of_another_size_is_fitted_to_a(self):
        Image.fromarray(np.full((45, 60, 3), 90, dtype=np.uint8)).save(self.temp / B_NAME)
        result = self.save(strokes=[stroke([(0, 0), (120, 90)], size=400)])
        self.assertEqual((result["width"], result["height"]), (120, 90))
        mixed = np.asarray(Image.open(self.output / "compare_00001.png").convert("RGB"))
        self.assertEqual(mixed.shape, (90, 120, 3))
        self.assertTrue((mixed == 90).all())

    def test_the_files_have_a_fixed_name_in_the_output_folder(self):
        (self.output / "compare_00007.png").write_bytes(b"")
        (self.output / "other_00020.png").write_bytes(b"")
        result = self.save(layers=True)
        self.assertEqual(
            [(file["filename"], file["subfolder"], file["type"]) for file in result["files"]],
            [("compare_00008.png", "", "output"), ("compare_00008.psd", "", "output"), ("compare_00008_mask.png", "", "output")],
        )
        # A name that is a link out of the folder is not written through.
        outside = Path(self.folder.name) / "elsewhere.png"
        try:
            (self.output / "compare_00009.png").symlink_to(outside)
        except OSError:
            return
        self.assertEqual(self.save()["files"][0]["filename"], "compare_00010.png")
        self.assertFalse(outside.exists())

    def test_bad_strokes_stop_the_save_before_anything_is_written(self):
        with self.assertRaises(CompareSaveError):
            self.save(strokes=[{"d": 10, "p": [1]}])
        self.assertEqual(list(self.output.iterdir()), [])


class PsdTests(unittest.TestCase):
    def test_sizes_must_agree(self):
        flat = np.zeros((4, 6, 3), dtype=np.uint8)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "x.psd"
            with self.assertRaises(ValueError):
                write_psd(path, [{"name": "a", "rgb": np.zeros((4, 5, 3), dtype=np.uint8)}], flat)
            with self.assertRaises(ValueError):
                write_psd(path, [{"name": "a", "rgb": flat, "mask": np.zeros((3, 6), dtype=np.uint8)}], flat)
            with self.assertRaises(ValueError):
                write_psd(path, [], flat)
            write_psd(path, [{"name": "only", "rgb": flat}], flat)
            self.assertEqual(read_psd(path)["layers"][0]["name"], "only")
            # 26 header, 3 empty blocks' lengths, the layer block, the flat picture.
            self.assertEqual(read_psd(path)["bytes"], path.stat().st_size)


if __name__ == "__main__":
    unittest.main()
