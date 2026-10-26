"""Mask by Touch helpers: reading the touches, the picture's key, strokes,
the matches of a word, tidying an answer, the pieces for hovering and the
edge settings. Torch only, so these run without ComfyUI and without a model."""

from __future__ import annotations

import json
import math
from pathlib import Path
import random
import sys
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _mask_by_touch_helpers as helpers  # noqa: E402
from nodes._mask_by_touch_helpers import (  # noqa: E402
    ITEMS_MAX,
    MATCHES_MAX,
    NEEDS_SAM3,
    NEWER_TOUCHES,
    NOTHING_PICKED,
    NOT_A_PICTURE,
    NOT_SAM3,
    NOT_TOUCHES,
    NO_TEXT_READER,
    OTHER_PICTURE,
    PIECES_MAX,
    POINTS_MAX,
    TEXT_MAX,
    TOO_MUCH,
    WORDS_FIRST,
    WORDS_MORE,
    WORD_MAX,
    Memory,
    PieceSieve,
    along_stroke,
    apply_item,
    box_of,
    choose_found,
    clean_word,
    drop_specks,
    fill_small_holes,
    find_points,
    finish_mask,
    inner_point,
    keep_touched,
    match_points,
    match_under,
    pack_planes,
    parse_touches,
    picture_key,
    plane_piece,
    read_ask,
    scope_points,
    small_picture,
    small_size,
    soft_stroke_area,
    soft_to_small,
    stroke_area,
    tidy_matches,
    to_small,
    touch_stamp,
    unpack_planes,
    word_text,
)

EXAMPLE = (
    '{"v": 1, "key": "912x1632-0123456789abcdef", "items": ['
    '{"t": "tap", "op": 1, "x": 160, "y": 1450},'
    '{"t": "find", "op": 1, "r": 30, "pts": [[150, 1240], [230, 1010], [330, 1150]]},'
    '{"t": "paint", "op": 0, "r": 45, "pts": [[640, 120], [760, 170]]}]}'
)


def block(height, width, top, left, tall, wide):
    mask = torch.zeros(height, width, dtype=torch.bool)
    mask[top:top + tall, left:left + wide] = True
    return mask


def within(pts, radius, height, width):
    """The slow, plain way to say which pixels lie within `radius` of a stroke."""
    radius = max(0.5, radius)
    ys, xs = torch.meshgrid(
        torch.arange(height, dtype=torch.float64), torch.arange(width, dtype=torch.float64), indexing="ij"
    )
    nearest = torch.full((height, width), float("inf"), dtype=torch.float64)
    pts = [(float(x), float(y)) for x, y in pts]
    for (ax, ay), (bx, by) in list(zip(pts, pts[1:])) or [(pts[0], pts[0])]:
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = (((xs - ax) * dx + (ys - ay) * dy) / length).clamp(0, 1) if length else torch.zeros_like(xs)
        nearest = torch.minimum(nearest, (xs - ax - t * dx) ** 2 + (ys - ay - t * dy) ** 2)
    return nearest <= radius * radius + 1e-9


class TouchesTests(unittest.TestCase):
    def test_the_stamp_is_fnv1a_of_the_text_as_it_arrived(self):
        self.assertEqual(touch_stamp(""), "811c9dc5")
        self.assertEqual(touch_stamp("a"), "e40c292c")
        self.assertEqual(touch_stamp("foobar"), "bf9cf968")
        self.assertEqual(touch_stamp(None), "811c9dc5")
        # Its UTF-8 bytes, and nothing stripped.
        self.assertNotEqual(touch_stamp(" a"), touch_stamp("a"))
        self.assertEqual(len(touch_stamp("é\U0001f17e")), 8)

    def test_the_contracts_example_reads_as_three_items(self):
        picked = parse_touches(EXAMPLE)
        self.assertEqual(picked.key, "912x1632-0123456789abcdef")
        tap, find, paint = picked.items
        self.assertEqual((tap.kind, tap.add, tap.x, tap.y), ("tap", True, 160, 1450))
        self.assertEqual((find.kind, find.add, find.r, find.pts), ("find", True, 30.0, ((150, 1240), (230, 1010), (330, 1150))))
        self.assertEqual((paint.kind, paint.add, paint.r, paint.pts), ("paint", False, 45.0, ((640, 120), (760, 170))))

    def test_a_name_touch_is_a_word_at_a_point(self):
        text = '{"items": [{"t": "name", "op": 1, "w": "jacket", "x": 412, "y": 900}, {"t": "name", "op": 0, "w": " Fur,  collar ", "x": 3.4, "y": 7}]}'
        first, second = parse_touches(text).items
        self.assertEqual((first.kind, first.add, first.word, first.x, first.y), ("name", True, "jacket", 412, 900))
        self.assertEqual((second.kind, second.add, second.word, second.x, second.y), ("name", False, "Fur collar", 3, 7))
        empty = parse_touches('{"items": [{"t": "name", "w": " ,:() ", "x": 1, "y": 2}]}').items[0]
        self.assertEqual((empty.kind, empty.word), ("name", ""), "kept as an item, so the answers still line up")

    def test_an_all_touch_is_a_word_and_no_point(self):
        text = '{"items": [{"t": "all", "op": 1, "w": "bird"}, {"t": "all", "op": 0, "w": " Fur,  collar ", "x": 5, "y": "ignored"}, {"t": "all", "w": ":"}]}'
        first, second, empty = parse_touches(text).items
        self.assertEqual((first.kind, first.add, first.word, first.pts), ("all", True, "bird", ()))
        self.assertEqual((second.kind, second.add, second.word, second.x, second.y), ("all", False, "Fur collar", 0, 0), "cleaned like a name touch's word")
        self.assertEqual((empty.kind, empty.word, empty.add), ("all", "", True), "kept as an item, so the answers still line up")

    def test_a_word_is_cleaned_before_it_is_asked(self):
        self.assertEqual(clean_word("  red,jacket:2 (x) [y] {z}\n"), "red jacket 2 x y z", "the text reader's own signs are out")
        self.assertEqual(clean_word("t-shirt"), "t-shirt")
        self.assertEqual(clean_word("teddy \t bear"), "teddy bear", "spaces are collapsed")
        self.assertEqual(clean_word("embedding:secret"), "embedding secret")
        self.assertEqual(len(clean_word("x" * 200)), WORD_MAX)
        self.assertEqual(clean_word("a" * 59 + " b"), "a" * 59, "cut to 60, and no space left at the end")
        self.assertEqual((clean_word(""), clean_word(None), clean_word(",:()[]{}")), ("", "", ""))
        self.assertEqual((WORD_MAX, MATCHES_MAX), (60, 16))
        self.assertEqual(word_text("jacket"), "jacket:16", "up to 16 matches: a bare word returns one")

    def test_the_words_asked_of_a_picture(self):
        self.assertEqual((len(WORDS_FIRST), len(WORDS_MORE)), (40, 64))
        self.assertEqual(len(set(WORDS_FIRST + WORDS_MORE)), 104, "no word is there twice")
        self.assertEqual(WORDS_FIRST[:4], ("person", "face", "hair", "hand"))
        self.assertEqual(WORDS_MORE[-3:], ("sky", "wall", "floor"))
        self.assertEqual(WORDS_MORE[WORDS_MORE.index("television") + 1], "screen", "a TV's screen has a word of its own")
        for word in WORDS_FIRST + WORDS_MORE:
            self.assertEqual(clean_word(word), word, "each is asked as it is written")
            self.assertEqual(word, word.lower())

    def test_empty_text_is_nothing_picked(self):
        for text in ("", "   ", None):
            self.assertEqual(parse_touches(text).items, ())
        self.assertEqual(parse_touches('{"v": 1, "items": []}').items, ())
        self.assertIsNone(parse_touches('{"items": []}').key, "a hand-written text needs no key")

    def test_a_kind_this_version_does_not_know_is_skipped_but_counted(self):
        picked = parse_touches('{"items": [{"t": "lasso", "pts": "whatever"}, {"t": "tap", "x": 1, "y": 2}]}')
        self.assertEqual([item.kind for item in picked.items], [None, "tap"])

    def test_numbers_are_whole_pixels(self):
        tap = parse_touches('{"items": [{"t": "tap", "x": 10.6, "y": 3.2}]}').items[0]
        self.assertEqual((tap.x, tap.y, tap.add), (11, 3, True), "op left out adds")
        huge = parse_touches('{"items": [{"t": "paint", "r": 1e9, "pts": [[1e12, -1e12]]}]}').items[0]
        self.assertEqual(huge.pts, ((1_000_000, -1_000_000),))
        self.assertEqual(huge.r, 4096.0)

    def test_text_that_is_not_this_json_stops_with_a_plain_message(self):
        broken = (
            "not json", "[1, 2]", '"text"', '{"items": {}}', '{"items": [3]}',
            '{"items": [{"t": "tap", "x": "1", "y": 2}]}', '{"items": [{"t": "tap", "x": 1}]}',
            '{"items": [{"t": "tap", "x": true, "y": 2}]}', '{"items": [{"t": "tap", "x": NaN, "y": 2}]}',
            '{"items": [{"t": "tap", "op": 2, "x": 1, "y": 2}]}', '{"items": [{"t": "paint", "r": 3}]}',
            '{"items": [{"t": "paint", "r": 3, "pts": []}]}', '{"items": [{"t": "paint", "r": -1, "pts": [[1, 2]]}]}',
            '{"items": [{"t": "find", "r": 3, "pts": [[1]]}]}', '{"key": 5, "items": []}', '{"v": "1", "items": []}',
            '{"items": [{"t": "name", "x": 1, "y": 2}]}', '{"items": [{"t": "name", "w": 7, "x": 1, "y": 2}]}',
            '{"items": [{"t": "name", "w": ["hat"], "x": 1, "y": 2}]}', '{"items": [{"t": "name", "w": "hat", "x": 1}]}',
            '{"items": [{"t": "name", "w": "hat", "op": "add", "x": 1, "y": 2}]}',
            '{"items": [{"t": "all"}]}', '{"items": [{"t": "all", "w": 7}]}', '{"items": [{"t": "all", "w": "hat", "op": 3}]}',
            "[" * 5000,
        )
        for text in broken:
            with self.subTest(text=text[:40]):
                with self.assertRaises(ValueError) as stopped:
                    parse_touches(text)
                self.assertEqual(str(stopped.exception), NOT_TOUCHES)

    def test_picks_saved_by_a_newer_version_say_so(self):
        with self.assertRaises(ValueError) as stopped:
            parse_touches('{"v": 2, "items": []}')
        self.assertEqual(str(stopped.exception), NEWER_TOUCHES)

    def test_the_limits_stop_with_a_plain_message(self):
        tap = {"t": "tap", "x": 1, "y": 1}
        self.assertEqual(len(parse_touches(json.dumps({"items": [tap] * ITEMS_MAX})).items), ITEMS_MAX)
        stroke = {"t": "paint", "r": 2, "pts": [[1, 1]] * 4000}
        self.assertEqual(len(parse_touches(json.dumps({"items": [stroke] * 5})).items), 5, "20,000 points fit")
        named = {"t": "name", "w": "hat", "x": 1, "y": 1}
        too_much = (
            json.dumps({"items": [tap] * (ITEMS_MAX + 1)}),
            json.dumps({"items": [stroke] * 5 + [tap]}),
            json.dumps({"items": [stroke] * 5 + [named]}),
            json.dumps({"items": [stroke] * 5 + [{"t": "all", "w": "hat"}]}),
            json.dumps({"items": [{"t": "find", "r": 2, "pts": [[1, 1]] * (POINTS_MAX + 1)}]}),
            '{"items": []}' + " " * TEXT_MAX,
        )
        for text in too_much:
            with self.assertRaises(ValueError) as stopped:
                parse_touches(text)
            self.assertEqual(str(stopped.exception), TOO_MUCH)

    def test_what_the_face_asks_of_a_run(self):
        self.assertEqual(read_ask("", 100, 200), ("", None))
        self.assertEqual(read_ask(None, 100, 200), ("", None))
        self.assertEqual(read_ask("scope", 100, 200), ("scope", None))
        self.assertEqual(read_ask("scope:171,36", 100, 200), ("scope", (171, 36)))
        self.assertEqual(read_ask("look", 100, 200), ("look", None))
        self.assertEqual(read_ask("anything else", 100, 200), ("look", None))
        # Outside the picture, or not two whole numbers: plain scope.
        for text in ("scope:200,36", "scope:171,100", "scope:-1,5", "scope:a,b", "scope:1.5,2", "scope:7"):
            self.assertEqual(read_ask(text, 100, 200), ("scope", None), text)

    def test_the_messages_are_plain_and_ascii(self):
        for message in (NOTHING_PICKED, OTHER_PICTURE, NOT_TOUCHES, TOO_MUCH, NEWER_TOUCHES, NOT_A_PICTURE, NEEDS_SAM3, NOT_SAM3, NO_TEXT_READER):
            message.encode("ascii")  # raised into consoles that may be cp1252
            self.assertIn("Mask by Touch", message)
            self.assertNotIn("Mask by Name", message)
        self.assertIn("Click a thing on the node's picture, or paint over it", NOTHING_PICKED)
        self.assertIn("Wire model and clip from a Load Checkpoint that loads the SAM 3 file", NOT_SAM3)
        self.assertTrue(NO_TEXT_READER.startswith(NOT_SAM3) and NO_TEXT_READER.endswith("Nothing is wired into clip."))


class PictureKeyTests(unittest.TestCase):
    def test_the_same_picture_has_the_same_key_and_one_pixel_changes_it(self):
        picture = torch.rand(1, 40, 60, 3)
        key = picture_key(picture)
        self.assertTrue(key.startswith("60x40-"))
        self.assertEqual(picture_key(picture.clone()), key)
        changed = picture.clone()
        changed[0, 20, 30, 1] = (changed[0, 20, 30, 1] + 0.5) % 1.0
        self.assertNotEqual(picture_key(changed), key)
        self.assertNotEqual(picture_key(torch.zeros(1, 40, 60, 3)), picture_key(torch.zeros(1, 60, 40, 3)))

    def test_it_is_the_8_bit_picture_that_counts(self):
        # A loaded picture is 8-bit values over 255: the key reads them back
        # exactly, so it is the same on every machine.
        values = torch.randint(0, 256, (1, 12, 9, 3))
        picture = values.float() / 255.0
        self.assertEqual(picture_key(picture), picture_key((values.float() + 0.2) / 255.0))
        self.assertNotEqual(picture_key(picture), picture_key((values.float() + 1.0).clamp(max=255) / 255.0))

    def test_a_batch_is_known_by_its_first_picture_and_see_through_is_left_out(self):
        first, second = torch.rand(1, 8, 8, 3), torch.rand(1, 8, 8, 3)
        self.assertEqual(picture_key(torch.cat([first, second])), picture_key(first))
        self.assertEqual(picture_key(first[0]), picture_key(first), "one picture without the batch axis")
        self.assertEqual(picture_key(torch.cat([first, torch.rand(1, 8, 8, 1)], dim=-1)), picture_key(first))

    def test_something_that_is_not_a_picture_says_so(self):
        for value in (None, "picture", torch.zeros(4), torch.zeros(0, 4, 4, 3)):
            with self.assertRaises(ValueError) as stopped:
                picture_key(value)
            self.assertEqual(str(stopped.exception), NOT_A_PICTURE)


class StrokeTests(unittest.TestCase):
    def test_a_dab_is_a_disc(self):
        area = stroke_area([(20, 15)], 5, 40, 50)
        self.assertTrue(torch.equal(area, within([(20, 15)], 5, 40, 50)))
        self.assertTrue(bool(area[15, 25]) and bool(area[10, 20]) and not bool(area[15, 26]))
        self.assertEqual(int(stroke_area([(20, 15)], 0, 40, 50).sum()), 1, "no radius still marks its own pixel")

    def test_a_stroke_is_what_a_round_brush_covers(self):
        random.seed(7)
        for _ in range(120):
            height, width = random.randint(5, 60), random.randint(5, 60)
            pts = [(random.randint(-8, width + 8), random.randint(-8, height + 8)) for _ in range(random.randint(1, 6))]
            radius = random.choice([0, 0.5, 1, 1.5, 2, 3.3, 5, 9, 20])
            with self.subTest(pts=pts, radius=radius, size=(width, height)):
                self.assertTrue(torch.equal(stroke_area(pts, radius, height, width), within(pts, radius, height, width)))

    def test_a_stroke_off_the_picture_marks_nothing_and_a_huge_one_stays_cheap(self):
        self.assertEqual(int(stroke_area([(-50, -50), (-20, -30)], 5, 30, 30).sum()), 0)
        self.assertEqual(int(stroke_area([], 5, 30, 30).sum()), 0)
        random.seed(3)
        scribble = [(random.randint(-10 ** 6, 10 ** 6), random.randint(-10 ** 6, 10 ** 6)) for _ in range(3000)]
        self.assertEqual(tuple(stroke_area(scribble, 30, 200, 300).shape), (200, 300))

    def test_points_are_spread_evenly_along_the_strokes_own_path(self):
        corner = [(0, 0), (100, 0), (100, 100)]
        self.assertEqual(along_stroke(corner, 5, ends=True), [(0, 0), (50, 0), (100, 0), (100, 50), (100, 100)])
        self.assertEqual(along_stroke(corner, 4, ends=False), [(25, 0), (75, 0), (100, 25), (100, 75)])
        self.assertEqual(along_stroke(corner, 2, ends=False), [(50, 0), (100, 50)])
        self.assertEqual(along_stroke(corner, 1), [(100, 0)], "one point is the middle")
        self.assertEqual(along_stroke([(7, 9), (7, 9)], 4, ends=False), [(7, 9)], "no length: its one point")
        self.assertEqual(along_stroke([], 3), [])

    def test_a_find_stroke_asks_with_four_points_and_with_two(self):
        many, pair = find_points([(100, 100), (500, 100)], 1000, 1000)
        self.assertEqual(many, [(150, 100), (250, 100), (350, 100), (450, 100)])
        self.assertEqual(pair, [(200, 100), (400, 100)])
        # Shorter than 5 % of the picture's long side: two points only.
        self.assertEqual(find_points([(100, 100), (140, 100)], 1000, 1000), ([], [(110, 100), (130, 100)]))
        self.assertEqual(find_points([(100, 100), (149, 100)], 1000, 1000)[0], [])
        self.assertEqual(len(find_points([(100, 100), (150, 100)], 1000, 1000)[0]), 4)
        self.assertEqual(find_points([(30, 40)], 1000, 1000), ([], [(30, 40)]), "a dot is its one point")
        # Only the part of a stroke that lies on the picture is asked about.
        many, pair = find_points([(-400, 50), (400, 50)], 100, 100)
        self.assertEqual(len(many), 4)
        self.assertEqual(len(pair), 2)
        self.assertTrue(all(0 <= x < 100 and y == 50 for x, y in many + pair))
        self.assertEqual(find_points([(-400, 50), (-300, 50)], 100, 100), ([], []))


class AnswerTests(unittest.TestCase):
    def test_stray_specks_go_and_the_thing_stays(self):
        thing = block(400, 600, 100, 200, 200, 300)
        speck = block(400, 600, 10, 10, 4, 4)
        part = block(400, 600, 350, 20, 30, 40)  # 2 % of the thing: a part of it
        answer = thing | speck | part
        self.assertTrue(torch.equal(drop_specks(answer), thing | part))
        self.assertTrue(torch.equal(drop_specks(answer, (12, 12)), answer), "the island under the tap stays")
        self.assertTrue(torch.equal(drop_specks(thing), thing))
        self.assertEqual(int(drop_specks(torch.zeros(40, 60, dtype=torch.bool)).sum()), 0)

    def test_many_small_islands_keep_at_least_the_biggest(self):
        answer = torch.zeros(300, 300, dtype=torch.bool)
        for row in range(15):
            for column in range(15):
                answer[row * 20 + 2:row * 20 + 4, column * 20 + 2:column * 20 + 4] = True
        answer[150:154, 150:154] = True
        kept = drop_specks(answer)
        self.assertGreater(int(kept.sum()), 0)
        self.assertTrue(bool(kept[151, 151]))

    def test_islands_touching_at_a_corner_are_one(self):
        steps = torch.zeros(64, 64, dtype=torch.bool)
        for index in range(8):
            steps[index * 8:index * 8 + 8, index * 8:index * 8 + 8] = True
        labels = helpers._islands(steps)
        self.assertEqual(len(torch.unique(labels[steps])), 1)
        spiral = torch.zeros(41, 41, dtype=torch.bool)
        spiral[2, 2:39] = spiral[2:39, 38] = spiral[38, 6:39] = spiral[6:39, 6] = spiral[6, 6:35] = spiral[6:35, 34] = True
        spiral[20, 20] = True
        self.assertEqual(len(torch.unique(helpers._islands(spiral)[spiral])), 2, "one winding line and one dot")

    def test_only_what_the_stroke_touches_is_kept(self):
        thing = block(400, 600, 100, 200, 200, 300)
        far = block(400, 600, 20, 20, 40, 40)
        stroke = stroke_area([(250, 150), (400, 250)], 10, 400, 600)
        self.assertTrue(torch.equal(keep_touched(thing | far, stroke), thing))
        self.assertEqual(int(keep_touched(thing | far, stroke_area([(590, 390)], 3, 400, 600)).sum()), 0)

    def test_the_four_point_answer_is_the_thing_unless_the_two_point_answer_is_much_smaller(self):
        stroke = stroke_area([(30, 50), (70, 50)], 6, 100, 100)
        hand = block(100, 100, 40, 20, 20, 60)        # under the whole stroke
        face = block(100, 100, 10, 10, 80, 80)        # five times the hand
        sleeve = block(100, 100, 35, 15, 30, 70)      # under two times the hand
        speck = block(100, 100, 2, 2, 3, 3)
        self.assertTrue(torch.equal(choose_found(face, hand, stroke), hand), "the smaller thing under the stroke")
        self.assertTrue(torch.equal(choose_found(sleeve, hand, stroke), sleeve), "not much smaller: four points win")
        self.assertTrue(torch.equal(choose_found(face, block(100, 100, 44, 20, 12, 12), stroke), face), "a part of the stroke only")
        self.assertTrue(torch.equal(choose_found(torch.zeros_like(hand), hand, stroke), hand))
        self.assertTrue(torch.equal(choose_found(None, hand | speck, stroke), hand), "what the stroke misses is dropped")
        self.assertTrue(torch.equal(choose_found(face, None, stroke), face))
        self.assertIsNone(choose_found(speck, None, stroke))
        self.assertIsNone(choose_found(None, None, stroke))

    def test_items_join_and_take_away(self):
        selection = block(10, 10, 0, 0, 5, 5)
        other = block(10, 10, 3, 3, 5, 5)
        self.assertEqual(int(apply_item(selection, other, True).sum()), 25 + 25 - 4)
        self.assertEqual(int(apply_item(selection, other, False).sum()), 25 - 4)


class MatchTests(unittest.TestCase):
    """What is done with everything SAM 3 calls by one word."""

    def test_matches_are_tidied_the_surest_first(self):
        hat = block(200, 300, 20, 20, 60, 80)
        speck = block(200, 300, 190, 290, 3, 3)
        again = block(200, 300, 20, 20, 60, 76)  # the same hat, found a second time
        other = block(200, 300, 100, 150, 60, 80)
        masks = torch.stack([other, again, hat | speck, torch.zeros(200, 300, dtype=torch.bool)])
        matches = tidy_matches(masks, [0.7, 0.8, 0.95, 0.6])
        self.assertEqual([sure for _, sure in matches], [0.95, 0.7])
        self.assertTrue(torch.equal(matches[0][0], hat), "its stray speck is gone")
        self.assertTrue(torch.equal(matches[1][0], other))
        self.assertEqual(matches[0][0].dtype, torch.bool)
        self.assertEqual(tidy_matches(torch.zeros(0, 200, 300), []), [])
        # Two things of a kind side by side, and one inside the other, are each a match.
        pair = tidy_matches(torch.stack([hat, block(200, 300, 20, 110, 60, 80), block(200, 300, 30, 30, 20, 20)]).float(), [0.9, 0.9, 0.9])
        self.assertEqual(len(pair), 3)

    def test_a_name_takes_the_smallest_match_at_the_point(self):
        window = block(200, 300, 20, 20, 150, 200)
        pane = block(200, 300, 40, 40, 50, 50)
        twin = block(200, 300, 40, 120, 50, 50)  # as big as the pane
        matches = [(window, 0.9), (pane, 0.8), (twin, 0.7)]
        self.assertEqual(match_under(matches, (60, 60)), 1, "the pane, not the window round it")
        self.assertEqual(match_under(matches, (150, 150)), 0)
        self.assertEqual(match_under(matches, (140, 60)), 2)
        self.assertIsNone(match_under(matches, (290, 190)))
        self.assertIsNone(match_under(matches, (900, 900)), "off the picture")
        self.assertIsNone(match_under([], (5, 5)))
        self.assertEqual(match_under([(pane, 0.5), (pane.clone(), 0.9)], (60, 60)), 0, "of two the same size, the earlier")

    def test_each_match_has_a_point_that_means_it_and_no_other(self):
        window = block(200, 300, 20, 20, 150, 200)
        pane = block(200, 300, 40, 40, 50, 50)
        left, right = block(200, 300, 5, 230, 40, 30), block(200, 300, 60, 230, 40, 30)
        matches = [(window, 0.9), (pane, 0.8), (left, 0.7), (right, 0.7)]
        points = match_points(matches)
        for index, point in enumerate(points):
            self.assertEqual(match_under(matches, point), index)
        self.assertTrue(abs(points[1][0] - 64.5) <= 1 and abs(points[1][1] - 64.5) <= 1, "the middle of the pane")
        self.assertTrue(abs(points[2][0] - 244.5) <= 1 and abs(points[2][1] - 24.5) <= 1)
        x, y = points[0]
        self.assertFalse(bool(pane[y, x]), "the window's point is not in the pane")
        # Well away from the edge: no nearer than a third of the widest room left.
        self.assertTrue(bool(window[y - 20:y + 21, x - 20:x + 21].all()) and not bool(pane[y - 20:y + 21, x - 20:x + 21].any()))

    def test_a_match_wholly_under_smaller_ones_has_no_point(self):
        whole = block(100, 100, 10, 10, 40, 80)
        halves = [(block(100, 100, 10, 10, 40, 40), 0.9), (block(100, 100, 10, 50, 40, 40), 0.9)]
        self.assertEqual(match_points([(whole, 0.95)] + halves)[0], None, "no point could mean it")
        self.assertEqual(match_points([]), [])

    def test_the_deepest_point_of_a_shape(self):
        self.assertIsNone(inner_point(torch.zeros(50, 50, dtype=torch.bool)))
        self.assertEqual(inner_point(block(50, 50, 7, 9, 1, 1)), (9, 7))
        x, y = inner_point(block(400, 600, 100, 200, 200, 300))
        self.assertTrue(abs(x - 349.5) <= 52 and abs(y - 199.5) <= 2, "on the middle line of a wide box")
        ring = block(400, 400, 50, 50, 300, 300) & ~block(400, 400, 120, 120, 160, 160)
        x, y = inner_point(ring)
        self.assertTrue(bool(ring[y, x]) and bool(ring[y - 30:y + 31, x - 30:x + 31].all()), "in the band, far from both edges")
        line = block(2000, 3000, 1000, 100, 3, 2600)  # three pixels thin, on a big picture
        x, y = inner_point(line)
        self.assertTrue(bool(line[y, x]) and y == 1001, "inside, on its middle row")
        corner = block(300, 300, 20, 20, 200, 40) | block(300, 300, 180, 20, 40, 200)
        x, y = inner_point(corner)
        self.assertTrue(bool(corner[y - 15:y + 16, x - 15:x + 16].all()))
        dots = torch.zeros(60, 60, dtype=torch.bool)
        dots[10, 10] = dots[40, 45] = True
        self.assertIn(inner_point(dots), ((10, 10), (45, 40)))


class SmallCopyTests(unittest.TestCase):
    def test_the_small_size_is_what_a_browser_rounds_to(self):
        self.assertEqual(small_size(912, 1632), (572, 1024, 1024 / 1632))
        self.assertEqual(small_size(1504, 1648), (935, 1024, 1024 / 1648))
        self.assertEqual(small_size(800, 600), (800, 600, 1.0))
        for width, height in ((2047, 1024), (1024, 2049), (3, 5000), (4095, 4097), (1366, 2048)):
            small_width, small_height, scale = small_size(width, height)
            self.assertEqual(small_width, max(1, math.floor(width * scale + 0.5)))
            self.assertEqual(small_height, max(1, math.floor(height * scale + 0.5)))
            self.assertEqual(max(small_width, small_height), 1024)

    def test_a_small_pixel_is_in_when_half_of_it_is(self):
        mask = block(8, 8, 0, 0, 8, 3)
        small = to_small(mask, 4, 4)
        self.assertEqual(small[:, 0].tolist(), [True] * 4)
        self.assertEqual(small[:, 1].tolist(), [True] * 4, "half covered counts")
        self.assertEqual(small[:, 2].tolist(), [False] * 4)
        self.assertIs(to_small(mask, 8, 8).dtype, torch.bool)
        self.assertTrue(torch.equal(to_small(mask, 8, 8), mask), "a picture that is already small is left as it is")

    def test_the_small_picture_is_8_bit_rgb(self):
        picture = torch.rand(2, 40, 20, 4)
        small = small_picture(picture, 10, 20)
        self.assertEqual((tuple(small.shape), small.dtype), ((20, 10, 3), torch.uint8))
        same = small_picture(picture, 20, 40)
        self.assertTrue(torch.equal(same, picture[0, ..., :3].mul(255).round().to(torch.uint8)))

    def test_the_box_ends_one_past_the_last_pixel(self):
        self.assertEqual(box_of(block(40, 60, 5, 7, 10, 20)), [7, 5, 27, 15])
        self.assertEqual(box_of(torch.zeros(4, 4, dtype=torch.bool)), [0, 0, 0, 0])


class PieceTests(unittest.TestCase):
    def test_pieces_pack_into_bit_planes_and_come_back(self):
        for count in (0, 1, 8, 24, 25, 64):
            masks = torch.rand(count, 6, 5) > 0.5
            planes = pack_planes(masks)
            self.assertEqual(len(planes), math.ceil(count / 24))
            for plane in planes:
                self.assertEqual((tuple(plane.shape), plane.dtype), ((6, 5, 3), torch.uint8))
            back = unpack_planes(planes, count)
            self.assertEqual(int(back.shape[0]), count)
            if count:
                self.assertTrue(torch.equal(back, masks))

    def test_piece_i_is_bit_i_of_red_green_blue(self):
        masks = torch.zeros(26, 1, 1, dtype=torch.bool)
        for index in (0, 9, 23, 25):
            masks[index] = True
        first, second = pack_planes(masks)
        self.assertEqual(first[0, 0].tolist(), [1, 2, 128], "piece 0: red bit 0; 9: green bit 1; 23: blue bit 7")
        self.assertEqual(second[0, 0].tolist(), [2, 0, 0], "piece 25 is bit 1 of the second plane")

    def test_the_points_cover_the_picture_from_the_middle_out(self):
        points = scope_points(912, 1632, 400)
        self.assertEqual(len(points), len(set(points)))
        self.assertTrue(380 <= len(points) <= 420)
        self.assertTrue(all(0 <= x < 912 and 0 <= y < 1632 for x, y in points))
        self.assertLess(math.dist(points[0], (456, 816)), 80, "the first point is in the middle")
        # However early the asking stops, what was asked is spread out: the
        # first 30 points leave no pixel farther from a point than a dense
        # row-by-row start would.
        first = torch.tensor(points[:30], dtype=torch.float64)
        ys, xs = torch.meshgrid(torch.arange(0, 1632, 16.0, dtype=torch.float64), torch.arange(0, 912, 16.0, dtype=torch.float64), indexing="ij")
        gaps = torch.cdist(torch.stack([xs.reshape(-1), ys.reshape(-1)], dim=1), first).amin(dim=1)
        self.assertLess(float(gaps.max()), 260.0)
        self.assertEqual(scope_points(912, 1632, 400), points, "the same points every time")
        self.assertEqual(len(scope_points(10, 10, 1)), 1)

    def test_planes_take_a_list_of_pieces_and_give_one_back(self):
        masks = [torch.rand(6, 5) > 0.5 for _ in range(50)]
        planes = pack_planes(masks)
        self.assertEqual(len(planes), 3)
        for index in (0, 7, 8, 23, 24, 49):
            self.assertTrue(torch.equal(plane_piece(planes, index), masks[index]))
        self.assertEqual(pack_planes([]), [])
        self.assertEqual(len(pack_planes([masks[0]] * PIECES_MAX)), 5, "120 pieces at most, on five planes")

    def sieve(self):
        return PieceSieve(400, 400)

    def test_nested_pieces_are_kept_and_look_alikes_are_not(self):
        sieve = self.sieve()
        person = block(400, 400, 40, 100, 340, 200)
        face = block(400, 400, 60, 150, 100, 100)
        glasses = block(400, 400, 90, 160, 30, 80)
        self.assertTrue(sieve.offer((200, 300), person))
        self.assertTrue(sieve.offer((200, 110), face))
        self.assertTrue(sieve.offer((200, 100), glasses))
        self.assertFalse(sieve.offer((210, 300), block(400, 400, 44, 100, 336, 200)), "nearly the same person")
        self.assertFalse(sieve.offer((5, 5), block(400, 400, 0, 0, 10, 10)), "a speck: under 0.2 % of the picture")
        self.assertFalse(sieve.offer((5, 5), block(400, 400, 0, 0, 400, 380)), "nearly the whole picture")
        self.assertFalse(sieve.offer((5, 5), torch.zeros(400, 400, dtype=torch.bool)))
        self.assertEqual(sorted(sieve.settle()), [(None, (200, 100)), (None, (200, 110)), (None, (200, 300))])

    def test_what_the_person_points_at_is_kept_however_small(self):
        sieve = self.sieve()
        earring = block(400, 400, 100, 100, 6, 6)
        self.assertFalse(sieve.offer((102, 102), earring))
        self.assertTrue(sieve.offer((102, 102), earring, pointed=True))
        self.assertFalse(sieve.offer((5, 5), block(400, 400, 0, 0, 400, 380), pointed=True), "still not the whole picture")
        self.assertFalse(sieve.offer((5, 5), torch.zeros(400, 400, dtype=torch.bool), pointed=True))

    def test_of_two_point_answers_alike_the_one_with_fewer_holes_stays(self):
        clean = block(400, 400, 100, 100, 200, 200)
        speckled = clean.clone()
        speckled[100:300:4, 100:300:4] = False
        sieve = self.sieve()
        self.assertTrue(sieve.offer((150, 150), speckled))
        self.assertTrue(sieve.offer((250, 250), clean), "it takes the speckled one's place")
        self.assertEqual(sieve.settle(), [(None, (250, 250))])
        sieve = self.sieve()
        sieve.offer((250, 250), clean)
        self.assertFalse(sieve.offer((150, 150), speckled))

    def test_a_point_piece_that_was_shown_keeps_its_point(self):
        clean = block(400, 400, 100, 100, 200, 200)
        speckled = clean.clone()
        speckled[100:300:4, 100:300:4] = False
        sieve = self.sieve()
        sieve.offer((150, 150), speckled)
        self.assertEqual(sieve.settle(), [(None, (150, 150))])
        self.assertFalse(sieve.offer((250, 250), clean), "a tap on what was shown must still give it")
        self.assertEqual(sieve.settle(), [(None, (150, 150))])

    def test_two_names_for_one_area_are_one_piece_by_the_surer_word(self):
        jacket = block(400, 400, 100, 100, 200, 200)
        coat = block(400, 400, 100, 100, 200, 190)  # nearly the same area
        sieve = self.sieve()
        self.assertTrue(sieve.offer((150, 150), jacket, name="jacket", sure=0.9))
        self.assertFalse(sieve.offer((160, 160), coat, name="coat", sure=0.7), "less sure: the jacket stays")
        self.assertFalse(sieve.offer((160, 160), coat, name="coat", sure=0.9), "as sure: the earlier word stays")
        self.assertEqual(sieve.settle(), [("jacket", (150, 150))])
        self.assertEqual((sieve.sure_of("jacket", (150, 150)), sieve.sure_of("coat", (160, 160)), sieve.sure_of(None, (150, 150))), (0.9, None, None))
        # A surer word takes its place, also after it was shown.
        self.assertTrue(sieve.offer((170, 170), coat, name="sweater", sure=0.97))
        self.assertEqual(sieve.settle(), [("sweater", (170, 170))])
        # A thing inside it is a piece of its own, whatever it is called.
        self.assertTrue(sieve.offer((120, 120), block(400, 400, 110, 110, 60, 60), name="pocket", sure=0.6))
        self.assertTrue(sieve.offer((320, 320), block(400, 400, 20, 20, 360, 360), name="person", sure=0.98))
        self.assertEqual(len(sieve.settle()), 3)

    def test_a_point_piece_that_is_nearly_a_named_piece_goes(self):
        jacket = block(400, 400, 100, 100, 200, 200)
        nearly = block(400, 400, 100, 100, 200, 190)
        sieve = self.sieve()
        sieve.offer((150, 150), jacket, name="jacket", sure=0.55)
        self.assertFalse(sieve.offer((160, 160), nearly), "the named piece stays, however unsure")
        # The point came first, and was shown: the name still takes its place.
        sieve = self.sieve()
        self.assertTrue(sieve.offer((160, 160), nearly, pointed=True))
        self.assertTrue(sieve.offer((20, 20), block(400, 400, 0, 0, 60, 60)))
        self.assertEqual(len(sieve.settle()), 2)
        self.assertTrue(sieve.offer((150, 150), jacket, name="jacket", sure=0.55))
        self.assertEqual(sieve.settle(), [(None, (20, 20)), ("jacket", (150, 150))])

    def test_a_named_piece_may_be_a_speck_or_the_whole_picture(self):
        sieve = self.sieve()
        self.assertTrue(sieve.offer((102, 102), block(400, 400, 100, 100, 6, 6), name="earring", sure=0.6))
        self.assertTrue(sieve.offer((200, 200), torch.ones(400, 400, dtype=torch.bool), name="wall", sure=0.96))
        self.assertTrue(sieve.offer((300, 300), block(400, 400, 300, 300, 1, 1), name="eye", sure=0.6))
        self.assertFalse(sieve.offer((5, 5), torch.zeros(400, 400, dtype=torch.bool), name="hat", sure=0.9))
        self.assertEqual(len(sieve.settle()), 3)

    def test_the_whole_picture_gets_a_name_only_when_sam3_is_sure(self):
        # Asked about a hundred words nobody typed, SAM 3 called a whole
        # portrait a mirror, 0.81 sure. That is a guess, not a thing to point at.
        whole = torch.ones(400, 400, dtype=torch.bool)
        nearly = block(400, 400, 4, 4, 392, 392)
        sieve = self.sieve()
        self.assertFalse(sieve.offer((200, 200), whole, name="mirror", sure=0.81))
        # "poster" at 0.898 on 95% of a picture was the worst one found on 22 test pictures.
        self.assertFalse(sieve.offer((200, 200), nearly, name="poster", sure=0.898))
        self.assertFalse(sieve.offer((200, 200), nearly, name="mirror", sure=0.94))
        self.assertTrue(sieve.offer((200, 200), nearly, name="wall", sure=0.95))
        # Under nine tenths of the picture a name is kept as before.
        self.assertTrue(sieve.offer((100, 100), block(400, 400, 0, 0, 300, 400), name="curtain", sure=0.55))
        self.assertEqual(sorted(name for name, _ in sieve.settle()), ["curtain", "wall"])

    def test_over_120_pieces_the_point_pieces_go_first_the_smallest_first(self):
        sieve = PieceSieve(1000, 1000)
        for index in range(100):
            sure = 0.99 - index * 0.001
            self.assertTrue(sieve.offer((index, 0), block(1000, 1000, 0, index * 9, 50, 6), name="book", sure=sure))
        for index in range(30):  # point pieces, each bigger than the one before
            self.assertTrue(sieve.offer((index, 1), block(1000, 1000, 100, index * 30, 100 + index, 25)))
        self.assertTrue(sieve.offer((999, 999), block(1000, 1000, 990, 990, 4, 4), pointed=True))
        kept = sieve.settle()
        self.assertEqual(len(kept), PIECES_MAX)
        self.assertEqual(sum(1 for name, _ in kept if name == "book"), 100, "every named piece stays")
        self.assertEqual(sorted(point[0] for name, point in kept if name is None and point[1] == 1), list(range(11, 30)), "the 11 smallest point pieces went")
        self.assertIn((None, (999, 999)), kept, "what the person points at is the last point piece to go")

    def test_over_120_named_pieces_the_least_sure_go(self):
        sieve = PieceSieve(1000, 1000)
        for index in range(130):
            self.assertTrue(sieve.offer((index, 0), block(1000, 1000, (index // 50) * 100, (index % 50) * 9, 50, 6), name="book", sure=0.5 + index * 0.003))
        self.assertTrue(sieve.offer((500, 900), block(1000, 1000, 850, 400, 100, 200)))
        kept = sieve.settle()
        self.assertEqual(len(kept), PIECES_MAX)
        self.assertEqual(sorted(point[0] for _, point in kept), list(range(10, 130)), "the point piece first, then the ten least sure")
        self.assertEqual(PIECES_MAX, 120)


class EdgeTests(unittest.TestCase):
    def test_a_pinhole_is_closed_and_a_ring_stays_a_ring(self):
        blob = block(200, 200, 40, 40, 120, 120).float()
        blob[100:103, 100:103] = 0.0  # 9 pixels in 14,400
        ring = block(200, 200, 40, 40, 120, 120).float()
        ring[70:130, 70:130] = 0.0  # 3,600 pixels: a third of the ring
        filled = fill_small_holes(torch.stack([blob, ring]))
        self.assertEqual(float(filled[0, 101, 101]), 1.0, "the pinhole is closed")
        self.assertEqual(float(filled[1, 100, 100]), 0.0, "the ring's middle stays open")
        self.assertTrue(torch.equal(filled[1], ring))

    def test_the_limit_is_one_percent_of_each_pictures_own_area(self):
        # A 5 x 5 hole: closed in an area of 10,000 pixels, left in one of 2,000.
        big = block(200, 200, 20, 20, 100, 100).float()
        big[60:65, 60:65] = 0.0
        small = block(200, 200, 20, 20, 45, 45).float()
        small[40:45, 40:45] = 0.0
        small[40:45, 45] = 1.0
        filled = fill_small_holes(torch.stack([big, small]))
        self.assertEqual(float(filled[0, 62, 62]), 1.0)
        self.assertEqual(float(filled[1, 42, 42]), 0.0)
        nothing = torch.zeros(1, 20, 20)
        self.assertTrue(torch.equal(fill_small_holes(nothing), nothing))
        tiny = block(20, 20, 5, 5, 3, 3).float()[None]
        tiny[0, 6, 6] = 0.0
        self.assertEqual(float(fill_small_holes(tiny)[0, 6, 6]), 0.0, "1 % of 8 pixels is no pixel: nothing is filled")

    def test_grow_shrink_soften_and_smooth(self):
        selection = block(100, 100, 30, 30, 40, 40)[None]
        exact = finish_mask(selection, fill_holes=False)
        self.assertEqual((exact.dtype, tuple(exact.shape)), (torch.float32, (1, 100, 100)))
        self.assertTrue(torch.equal(exact[0] > 0.5, selection[0]), "all settings at rest keep the outline")
        self.assertEqual(float(finish_mask(selection, grow=5)[0, 26, 50]), 1.0)
        self.assertEqual(float(finish_mask(selection, grow=5)[0, 24, 50]), 0.0)
        self.assertEqual(float(finish_mask(selection, grow=-5)[0, 32, 50]), 0.0, "below zero shrinks")
        self.assertEqual(float(finish_mask(selection, grow=-5)[0, 36, 50]), 1.0)
        soft = finish_mask(selection, soften=4.0)[0]
        self.assertTrue(0.05 < float(soft[30, 50]) < 0.95)
        spur = selection.clone()
        spur[0, 28:30, 50] = True
        self.assertEqual(float(finish_mask(spur, smooth=3)[0, 28, 50]), 0.0, "smooth rounds a spur off")

    def test_the_order_is_fill_smooth_grow_soften(self):
        selection = block(200, 200, 40, 40, 120, 120)
        selection[100:103, 100:103] = False
        # Shrinking first would widen the pinhole past what smooth and fill close.
        shrunk = finish_mask(selection[None], grow=-10)[0]
        self.assertEqual(float(shrunk[101, 101]), 1.0)
        self.assertEqual(float(shrunk[45, 100]), 0.0)
        left_open = finish_mask(selection[None], grow=-10, fill_holes=False)[0]
        self.assertEqual(float(left_open[101, 101]), 0.0)


class MemoryTests(unittest.TestCase):
    def test_an_answer_comes_back_as_it_went_in(self):
        memory = Memory()
        answer = block(40, 60, 5, 7, 10, 20)
        memory.put("thing", answer)
        memory.put("nothing", None)
        memory.put("empty", torch.zeros(40, 60, dtype=torch.bool))
        found, back = memory.get("thing")
        self.assertTrue(found and torch.equal(back, answer))
        self.assertEqual(memory.get("nothing"), (True, None), "asked, and nothing was there")
        self.assertEqual(memory.get("empty"), (True, None))
        self.assertEqual(memory.get("never asked"), (False, None))
        memory.clear()
        self.assertFalse(memory.get("thing")[0])

    def test_the_oldest_answers_go_first_when_it_is_full(self):
        memory = Memory(budget=3 * (64 + 100))
        for name in "abc":
            memory.put(name, block(40, 40, 0, 0, 10, 10))
        memory.get("a")  # used again: now the newest
        memory.put("d", block(40, 40, 0, 0, 10, 10))
        self.assertEqual([memory.get(name)[0] for name in "abcd"], [True, False, True, True])

    def test_the_matches_of_a_word_come_back_as_they_went_in(self):
        memory = Memory()
        hat, other = block(40, 60, 5, 7, 10, 20), block(40, 60, 20, 30, 15, 25)
        memory.put_matches("hat", [(hat, 0.9), (other, 0.75)])
        memory.put_matches("unicorn", [])
        found, matches = memory.get_matches("hat")
        self.assertTrue(found)
        self.assertEqual([sure for _, sure in matches], [0.9, 0.75])
        self.assertTrue(torch.equal(matches[0][0], hat) and torch.equal(matches[1][0], other))
        self.assertEqual(memory.get_matches("unicorn"), (True, []), "asked, and nothing is called that")
        self.assertEqual(memory.get_matches("never asked"), (False, []))
        self.assertEqual((memory.has("hat"), memory.has("unicorn"), memory.has("never asked")), (True, True, False))

    def test_matches_count_toward_what_is_kept(self):
        memory = Memory(budget=64 + 2 * (64 + 100) + 64 + 100)
        memory.put_matches("pair", [(block(40, 40, 0, 0, 10, 10), 0.9), (block(40, 40, 20, 20, 10, 10), 0.8)])
        memory.put("point", block(40, 40, 0, 0, 10, 10))
        self.assertTrue(memory.has("pair") and memory.has("point"))
        memory.put("one more", block(40, 40, 0, 0, 10, 10))
        self.assertEqual((memory.has("pair"), memory.has("point"), memory.has("one more")), (False, True, True), "the oldest goes, with all its matches")

    def test_pieces_are_kept_for_the_last_four_pictures(self):
        memory = Memory()
        for number in range(5):
            memory.put_pieces(number, {"number": number})
        self.assertIsNone(memory.get_pieces(0))
        self.assertEqual(memory.get_pieces(4), {"number": 4})


class SubjectAndQuietTests(unittest.TestCase):
    def test_the_subject_and_the_background_are_touches_without_a_point(self):
        text = json.dumps({"v": 1, "items": [{"t": "subject", "op": 1}, {"t": "background", "op": 0}]})
        items = parse_touches(text).items
        self.assertEqual([(item.kind, item.add) for item in items], [("subject", True), ("background", False)])
        self.assertEqual([(item.x, item.y, item.word, item.pts) for item in items], [(0, 0, "", ())] * 2)

    def test_a_name_the_face_did_not_show_is_marked_quiet(self):
        items = parse_touches(json.dumps({"v": 1, "items": [
            {"t": "name", "op": 1, "w": "foot", "x": 3, "y": 4, "q": 1},
            {"t": "name", "op": 1, "w": "hair", "x": 3, "y": 4},
            {"t": "name", "op": 1, "w": "hair", "x": 3, "y": 4, "q": 0},
        ]})).items
        self.assertEqual([item.quiet for item in items], [True, False, False])
        with self.assertRaises(ValueError):
            parse_touches(json.dumps({"v": 1, "items": [{"t": "name", "op": 1, "w": "hair", "x": 3, "y": 4, "q": "yes"}]}))

    def test_they_count_as_one_point_each_towards_the_limit(self):
        many = [{"t": "subject", "op": 1}] * ITEMS_MAX
        self.assertEqual(len(parse_touches(json.dumps({"v": 1, "items": many})).items), ITEMS_MAX)



class SoftBrushTests(unittest.TestCase):
    def test_a_paint_touch_reads_how_soft_its_brush_was(self):
        item = parse_touches(json.dumps({"items": [{"t": "paint", "op": 1, "r": 4, "pts": [[1, 2]], "s": 40, "g": 3}]})).items[0]
        self.assertAlmostEqual(item.soft, 0.4)
        self.assertAlmostEqual(parse_touches(json.dumps({"items": [{"t": "paint", "op": 1, "r": 4, "pts": [[1, 2]], "s": 250}]})).items[0].soft, 1.0)
        self.assertEqual(parse_touches(json.dumps({"items": [{"t": "paint", "op": 1, "r": 4, "pts": [[1, 2]]}]})).items[0].soft, 0.0)
        # Only paint has an edge of its own.
        self.assertEqual(parse_touches(json.dumps({"items": [{"t": "find", "op": 1, "r": 4, "pts": [[1, 2]], "s": 40}]})).items[0].soft, 0.0)
        for bad in (True, "soft", None, float("nan")):
            with self.assertRaises(ValueError):
                parse_touches(json.dumps({"items": [{"t": "paint", "op": 1, "r": 4, "pts": [[1, 2]], "s": bad}]}).replace("NaN", "NaN"))

    def test_a_soft_stroke_fades_and_a_too_thin_one_is_none(self):
        area = soft_stroke_area([[10, 20], [50, 20]], 8, 1.0, 40, 64)
        self.assertEqual((area.dtype, tuple(area.shape)), (torch.float32, (40, 64)))
        self.assertGreater(float(area[20, 30]), 0.9)
        self.assertTrue(0.2 < float(area[24, 30]) < 0.85)
        self.assertIsNone(soft_stroke_area([[10, 20]], 2, 0.01, 40, 64))
        # A stroke off the picture covers nothing.
        self.assertEqual(float(soft_stroke_area([[-500, -500]], 8, 1.0, 40, 64).sum()), 0.0)

    def test_joining_on_off_stays_on_off_and_soft_makes_it_soft(self):
        one = torch.tensor([[True, True, False, False]])
        other = torch.tensor([[True, False, True, False]])
        self.assertTrue(torch.equal(apply_item(one, other, True), torch.tensor([[True, True, True, False]])))
        self.assertTrue(torch.equal(apply_item(one, other, False), torch.tensor([[False, True, False, False]])))
        soft = torch.full((1, 4), 0.5)
        self.assertEqual(apply_item(one, soft, True).tolist(), [[1.0, 1.0, 0.5, 0.5]])
        self.assertEqual(apply_item(one, soft, False).tolist(), [[0.5, 0.5, 0.0, 0.0]])
        self.assertEqual(apply_item(soft, other, False).tolist(), [[0.0, 0.5, 0.0, 0.5]])

    def test_a_soft_mask_at_the_small_size_keeps_its_strength(self):
        mask = torch.zeros(8, 8)
        mask[:, :4] = 1.0
        mask[:, 4:6] = 0.5
        small = soft_to_small(mask, 4, 4)
        self.assertEqual(small[0].tolist(), [1.0, 1.0, 0.5, 0.0])


if __name__ == "__main__":
    unittest.main()
