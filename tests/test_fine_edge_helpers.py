"""Fine edges: where a pick's edge is taken from the subject's outline, what
stays as picked, growing a fine edge, the colour clean-up, and how ComfyUI's
background-removal model is found, loaded and asked. Torch only, on the CPU;
ComfyUI's node classes and folders are stand-ins."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes import _fine_edge_helpers as fine  # noqa: E402
from nodes._fine_edge_helpers import (  # noqa: E402
    INNER,
    KEEP_AT_LEAST,
    NEEDS_MODEL,
    NEEDS_NEWER,
    OFF,
    PREFERRED,
    REACH,
    clean_colours,
    fine_edge_choices,
    grow_fine,
    shown_colours,
    subject_edge,
    subject_matte,
    subject_model_name,
    wants_fine_edges,
)

H, W = 240, 320


def disc(height=H, width=W, cx=None, cy=None, radius=70) -> torch.Tensor:
    ys, xs = torch.meshgrid(torch.arange(height), torch.arange(width), indexing="ij")
    cx, cy = width // 2 if cx is None else cx, height // 2 if cy is None else cy
    return (xs - cx) ** 2 + (ys - cy) ** 2 <= radius ** 2


def soft_disc(radius=70, edge=6.0, **where) -> torch.Tensor:
    """A subject with a soft outline: 1 inside, falling to 0 over `edge` pixels."""
    height, width = where.get("height", H), where.get("width", W)
    ys, xs = torch.meshgrid(torch.arange(height), torch.arange(width), indexing="ij")
    cx, cy = where.get("cx", width // 2), where.get("cy", height // 2)
    far = ((xs - cx) ** 2 + (ys - cy) ** 2).float().sqrt()
    return ((radius + edge / 2 - far) / edge).clamp(0.0, 1.0)


class Folders:
    """A stand-in for ComfyUI's folder_paths: one models folder with files."""

    def __init__(self, folder: Path, known: bool = True):
        self.folder = folder
        self.folder_names_and_paths = {fine.MODEL_FOLDER: ([str(folder)], {".safetensors"})} if known else {}

    def get_filename_list(self, name):
        return sorted(path.name for path in self.folder.iterdir())

    def get_full_path(self, name, file):
        path = self.folder / file
        return str(path) if path.is_file() else None


class Output:
    def __init__(self, *result):
        self.result = result


class Loader:
    calls = []

    @classmethod
    def execute(cls, bg_removal_name):
        cls.calls.append(bg_removal_name)
        if "broken" in bg_removal_name:
            raise RuntimeError("ERROR: background model file is invalid")
        return Output({"model": bg_removal_name})


class Remover:
    calls = []
    answer = None

    @classmethod
    def execute(cls, bg_removal_model, image):
        cls.calls.append((bg_removal_model["model"], tuple(image.shape)))
        return Output(cls.answer if cls.answer is not None else torch.ones(image.shape[0], image.shape[1], image.shape[2]) * 0.5)


class ModelCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp(prefix="ausboss_fine_test_")
        self.folder = Path(folder)
        self.addCleanup(lambda: [path.unlink() for path in self.folder.iterdir()] and None)
        self.swap(fine, "folder_paths", Folders(self.folder))
        Loader.calls, Remover.calls, Remover.answer = [], [], None
        nodes = types.ModuleType("nodes")
        nodes.NODE_CLASS_MAPPINGS = {"LoadBackgroundRemovalModel": Loader, "RemoveBackground": Remover}
        self.addCleanup(sys.modules.__setitem__, "nodes", sys.modules.get("nodes")) if "nodes" in sys.modules else self.addCleanup(sys.modules.pop, "nodes", None)
        sys.modules["nodes"] = nodes
        self.nodes = nodes
        fine.forget_subjects()
        self.addCleanup(fine.forget_subjects)

    def swap(self, owner, attribute, value):
        self.addCleanup(setattr, owner, attribute, getattr(owner, attribute))
        setattr(owner, attribute, value)

    def file(self, name: str, text: str = "weights") -> None:
        (self.folder / name).write_text(text)


class ChoiceTests(ModelCase):
    def test_off_comes_first_and_then_every_file_of_comfyuis_own_folder(self):
        self.assertEqual(fine_edge_choices(), [OFF])
        self.file("birefnet.safetensors")
        self.file("another.safetensors")
        self.assertEqual(fine_edge_choices(), [OFF, "another.safetensors", "birefnet.safetensors"])

    def test_a_comfyui_without_the_folder_offers_only_off(self):
        self.swap(fine, "folder_paths", Folders(self.folder, known=False))
        self.file("birefnet.safetensors")
        self.assertEqual(fine_edge_choices(), [OFF])
        self.swap(fine, "folder_paths", None)
        self.assertEqual(fine_edge_choices(), [OFF])

    def test_only_a_model_file_turns_fine_edges_on(self):
        for value in (None, "", " ", "off", " off "):
            self.assertFalse(wants_fine_edges(value), repr(value))
        self.assertTrue(wants_fine_edges("birefnet.safetensors"))

    def test_the_subject_is_asked_of_the_chosen_file_or_of_comfyuis_usual_one(self):
        self.file("another.safetensors")
        self.assertEqual(subject_model_name("another.safetensors"), "another.safetensors")
        self.assertEqual(subject_model_name(OFF), "another.safetensors", "the first there is")
        self.file(PREFERRED)
        self.assertEqual(subject_model_name(OFF), PREFERRED, "ComfyUI's usual one when it is there")
        self.assertEqual(subject_model_name(None), PREFERRED)

    def test_with_no_file_at_all_the_message_says_what_to_get_and_where_to_put_it(self):
        with self.assertRaises(FileNotFoundError) as raised:
            subject_model_name(OFF)
        self.assertEqual(str(raised.exception), NEEDS_MODEL)
        for part in ("birefnet.safetensors", "445 MB", "Comfy-Org/BiRefNet", "ComfyUI/models/background_removal"):
            self.assertIn(part, NEEDS_MODEL)


class AskTests(ModelCase):
    def setUp(self):
        super().setUp()
        self.file(PREFERRED)
        self.frame = torch.rand(1, 40, 60, 3)

    def test_the_model_is_loaded_and_asked_through_comfyuis_own_nodes(self):
        Remover.answer = torch.linspace(0, 1, 40 * 60).reshape(1, 40, 60)
        matte = subject_matte(self.frame, PREFERRED)
        self.assertEqual(Loader.calls, [PREFERRED])
        self.assertEqual(Remover.calls, [(PREFERRED, (1, 40, 60, 3))])
        self.assertEqual((tuple(matte.shape), matte.dtype), ((40, 60), torch.float32))
        self.assertTrue(torch.allclose(matte, Remover.answer[0]))

    def test_only_the_picture_goes_to_the_model_not_a_see_through_channel(self):
        subject_matte(torch.rand(1, 40, 60, 4), PREFERRED)
        self.assertEqual(Remover.calls[0][1], (1, 40, 60, 3))

    def test_a_picture_is_asked_about_once_and_the_model_loaded_once(self):
        first = subject_matte(self.frame, OFF, key="one")
        again = subject_matte(self.frame, OFF, key="one")
        other = subject_matte(self.frame, OFF, key="two")
        self.assertEqual(len(Loader.calls), 1, "one load for all of them")
        self.assertEqual(len(Remover.calls), 2, "one question for each picture")
        self.assertTrue(torch.allclose(first, again, atol=1 / 255))
        self.assertEqual(tuple(other.shape), (40, 60))
        subject_matte(self.frame, OFF)
        self.assertEqual(len(Remover.calls), 3, "without the picture's key nothing is remembered")

    def test_a_file_that_was_swapped_is_loaded_again(self):
        subject_matte(self.frame, OFF, key="one")
        self.file(PREFERRED, "other weights, longer")
        os.utime(self.folder / PREFERRED, (1, 1))
        subject_matte(self.frame, OFF, key="two")
        self.assertEqual(len(Loader.calls), 2)

    def test_an_older_comfyui_gets_a_plain_message(self):
        self.nodes.NODE_CLASS_MAPPINGS = {"LoadBackgroundRemovalModel": Loader}
        with self.assertRaises(RuntimeError) as raised:
            subject_matte(self.frame, PREFERRED)
        self.assertEqual(str(raised.exception), NEEDS_NEWER)
        self.assertIn("0.21", NEEDS_NEWER)

    def test_a_missing_file_and_a_wrong_file_say_so_plainly(self):
        with self.assertRaisesRegex(FileNotFoundError, "'gone.safetensors' is not in ComfyUI/models/background_removal"):
            subject_matte(self.frame, "gone.safetensors")
        self.file("broken.safetensors")
        with self.assertRaisesRegex(ValueError, "'broken.safetensors' is not a background-removal model"):
            subject_matte(self.frame, "broken.safetensors")

    def test_an_answer_of_the_wrong_size_is_refused(self):
        Remover.answer = torch.ones(1, 10, 10)
        with self.assertRaises(ValueError):
            subject_matte(self.frame, PREFERRED)


class EdgeTests(unittest.TestCase):
    def test_where_the_pick_ends_at_the_subjects_outline_the_outline_is_taken(self):
        # SAM 3 picked the subject a little too big and with a hard edge.
        matte = soft_disc(radius=70)
        picked = disc(radius=76)
        alpha = subject_edge(picked, matte)
        self.assertEqual(tuple(alpha.shape), (H, W))
        self.assertTrue(torch.allclose(alpha, fine._firm(matte), atol=0.02), "the soft outline, all the way round")
        self.assertGreater(int(((alpha > 0.1) & (alpha < 0.9)).sum()), 500)

    def test_strands_outside_the_pick_come_with_it_and_a_far_speck_does_not(self):
        matte = soft_disc(radius=70)
        strand = torch.zeros(H, W, dtype=torch.bool)
        strand[H // 2 - 1:H // 2 + 1, W // 2 + 68:W // 2 + 110] = True     # sticks out of the subject
        speck = disc(cx=20, cy=20, radius=4)                               # subject too, says the model, but joined to nothing
        matte = torch.maximum(matte, (strand | speck).float() * 0.8)
        alpha = subject_edge(disc(radius=70), matte)
        self.assertGreater(float(alpha[strand].mean()), 0.6)
        self.assertEqual(float(alpha[speck].max()), 0.0)

    def test_background_inside_the_pick_goes(self):
        # A gap between strands that SAM 3 filled in.
        gap = disc(cx=W // 2 + 60, radius=5)
        matte = soft_disc(radius=70) * (~gap).float()
        alpha = subject_edge(disc(radius=70), matte)
        self.assertLess(float(alpha[gap].mean()), 0.05)

    def test_wall_that_sam3_swallowed_goes_even_beside_more_of_the_subject(self):
        # SAM 3's hair mask took a sliver of wall along with the hair, at a
        # place where the hair hangs over a shoulder: the other side of the
        # edge is subject too, so the edge is no outline there. The wall
        # inside the pick has to go all the same.
        matte = soft_disc(radius=70)
        sliver = torch.zeros(H, W, dtype=torch.bool)
        sliver[H // 2 - 30:H // 2 + 30, W // 2 + 70:W // 2 + 82] = True     # 12 px of wall beside the subject
        shoulder = torch.zeros(H, W, dtype=torch.bool)
        shoulder[H // 2 + 30:H // 2 + 90, W // 2 + 40:W // 2 + 120] = True  # more subject, below, not picked
        matte = torch.maximum(matte, shoulder.float())
        picked = (disc(radius=70) | sliver) & ~shoulder
        alpha = subject_edge(picked, matte)
        self.assertLess(float(alpha[sliver & picked].mean()), 0.2, "the sliver of wall is gone")
        self.assertEqual(float(alpha[H // 2, W // 2]), 1.0)
        self.assertEqual(float(alpha[shoulder].max()), 0.0, "and the shoulder was not added to the hair")

    def test_a_gap_in_the_pick_that_shows_more_of_the_subject_is_not_filled(self):
        # An open coat, picked. Down its front the shirt shows in a narrow
        # gap, and the field is close by, on the far side of the coat's
        # other half. The other side of the gap's edges is what lies in the
        # gap, not that field.
        height, width = 360, 320
        matte = torch.zeros(height, width)
        matte[40:320, 80:260] = 1.0                                         # the person: coat and shirt
        gap = torch.zeros(height, width, dtype=torch.bool)
        gap[80:290, 222:232] = True                                         # the shirt: 10 px wide, 28 px from the coat's outer edge
        picked = (matte > 0.5) & ~gap
        alpha = subject_edge(picked, matte)
        self.assertEqual(float(alpha[gap].max()), 0.0, "the shirt stays out of the coat")
        self.assertEqual(float(alpha[180, 245]), 1.0)

    def test_loose_strands_at_the_rim_of_a_pick_are_not_turned_inside_out(self):
        # Flyaway hair: SAM 3's mask covers a zone that is more wall than
        # hair. That zone is still hair that was picked, not a picked wall,
        # and its strands must not be the part that goes.
        ys, _xs = torch.meshgrid(torch.arange(H), torch.arange(W), indexing="ij")
        strands = disc(radius=96) & ~disc(radius=62) & ((ys % 8) < 2)       # a quarter hair, the rest wall
        matte = torch.maximum(soft_disc(radius=60), strands.float())
        alpha = subject_edge(disc(radius=96), matte)                         # the blob SAM 3 drew round all of it
        self.assertGreater(float(alpha[strands & disc(radius=90) & ~disc(radius=66)].mean()), 0.9, "the strands are still there")

    def test_light_between_loose_curls_goes_where_the_hair_is_the_subjects(self):
        # The same loose rim, on hair that is the subject's as a whole: a
        # street light between the curls is background that came along.
        # The rim is wide, so along it the pick is more light than hair.
        side = 400
        ys, _xs = torch.meshgrid(torch.arange(side), torch.arange(side), indexing="ij")
        strands = disc(side, side, radius=180) & ~disc(side, side, radius=152) & ((ys % 8) < 2)
        matte = torch.maximum(soft_disc(radius=150, height=side, width=side), strands.float())
        alpha = subject_edge(disc(side, side, radius=180), matte)
        zone = disc(side, side, radius=176) & ~disc(side, side, radius=158)
        self.assertLess(float(alpha[zone & ((ys % 8) > 3) & ((ys % 8) < 7)].mean()), 0.1, "the light between them is gone")
        self.assertGreater(float(alpha[zone & strands].mean()), 0.8, "the curls are still there")

    def test_a_pocket_of_background_deep_inside_a_thing_of_the_subject_goes(self):
        # A light seen through the hair, far from the hair's edge: farther
        # in than the band along the edge reaches.
        pocket = disc(radius=8)
        matte = soft_disc(radius=96) * (~pocket).float()
        alpha = subject_edge(disc(radius=96), matte)
        self.assertGreater(96 - 8, INNER * 2)
        self.assertLess(float(alpha[pocket].max()), 0.05)
        self.assertEqual(float(alpha[H // 2, W // 2 + 40]), 1.0)

    def test_a_big_piece_the_model_does_not_see_is_no_pocket(self):
        # A leg the model missed is not a light between curls: it stays.
        missed = disc(radius=30)
        matte = soft_disc(radius=96) * (~missed).float()
        alpha = subject_edge(disc(radius=96), matte)
        self.assertEqual(float(alpha[disc(radius=20)].min()), 1.0)

    def test_a_chain_keeps_the_end_that_hangs_over_the_background(self):
        # A bracelet is all edge: no rim of its own and no pockets. The end
        # of it that hangs off the wrist is still bracelet.
        matte = torch.zeros(H, W)
        matte[:, : W // 2] = 1.0                                            # the arm fills the left half
        chain = torch.zeros(H, W, dtype=torch.bool)
        chain[H // 2 - 3:H // 2 + 3, W // 2 - 100:W // 2 + 22] = True        # 6 px thick, its end over the background
        alpha = subject_edge(chain, matte)
        self.assertTrue(torch.equal(alpha, chain.float()), "exactly as picked")

    def test_a_thing_on_the_background_keeps_the_part_the_model_calls_subject(self):
        # A flower on a table, with a strip of it lying over a sweater. To
        # the model that strip is "subject". It is still the flower.
        matte = torch.zeros(H, W)
        matte[:, : W // 2] = 1.0                                            # the sweater fills the left half
        for shift in (10, 18):
            flower = disc(cx=W // 2 + shift, radius=30)
            over_sweater = flower & (matte > 0.5)
            self.assertGreater(int(over_sweater.sum()), 150)
            alpha = subject_edge(flower, matte)
            self.assertGreater(float(alpha[over_sweater].min()), 0.95, "no bite out of the flower")

    def test_the_matte_is_made_firm(self):
        self.assertEqual(fine._firm(torch.tensor([0.0, 0.03, 0.5, 0.97, 1.0])).tolist(), [0.0, 0.0, 0.5, 1.0, 1.0])

    def test_an_edge_inside_the_subject_stays_where_sam3_put_it(self):
        # The hair, picked off a person: against the wall its edge is the
        # outline, against the face it is not.
        matte = soft_disc(radius=70)
        left = torch.zeros(H, W, dtype=torch.bool)
        left[:, : W // 2] = True
        picked = disc(radius=76) & left
        alpha = subject_edge(picked, matte)
        cut = torch.zeros(H, W, dtype=torch.bool)
        cut[H // 2 - 40:H // 2 + 40, W // 2 - 3:W // 2 + 3] = True          # along the cut through the subject
        self.assertTrue(torch.equal(alpha[cut], picked.float()[cut]), "hard, as picked")
        rim = torch.zeros(H, W, dtype=torch.bool)
        rim[H // 2 - 20:H // 2 + 20, W // 2 - 80:W // 2 - 62] = True        # the far side, at the outline
        self.assertTrue(torch.allclose(alpha[rim], fine._firm(matte)[rim], atol=0.02))

    def test_a_thing_on_the_subject_gets_no_ring_around_it_on_a_big_picture(self):
        # Glasses on a face, in a picture big enough to be planned on a smaller copy.
        height, width = 1200, 1600
        matte = soft_disc(height=height, width=width, radius=500, edge=20.0)
        glasses = disc(height, width, radius=90)
        alpha = subject_edge(glasses, matte)
        self.assertTrue(torch.equal(alpha, glasses.float()), "exactly as picked: nothing added just outside its edge")

    def test_a_thing_that_is_not_the_subject_is_left_alone(self):
        # A lamp in the background, and a necklace on the subject: neither
        # edge is the subject's outline.
        matte = soft_disc(radius=70)
        for picked in (disc(cx=30, cy=30, radius=18), disc(radius=20)):
            self.assertTrue(torch.equal(subject_edge(picked, matte), picked.float()))

    def test_a_picked_background_gets_the_outline_the_other_way_round(self):
        matte = soft_disc(radius=70)
        picked = ~disc(radius=66)
        alpha = subject_edge(picked, matte)
        self.assertTrue(torch.allclose(alpha, fine._firm(1.0 - matte), atol=0.02))

    def test_paint_stays_exactly_as_painted(self):
        matte = soft_disc(radius=70)
        picked = disc(radius=76)
        stroke = torch.zeros(H, W, dtype=torch.bool)
        stroke[H // 2 - 6:H // 2 + 6, W // 2 + 50:W // 2 + 100] = True     # painted across the outline
        picked = picked | stroke
        alpha = subject_edge(picked, matte, keep_hard=stroke)
        self.assertTrue(torch.equal(alpha[stroke], torch.ones(int(stroke.sum()))))
        self.assertLess(float(alpha[H // 2 - 60, W // 2 + 44]), 1.0, "the rest of the outline is still fine")

    def test_the_outline_fades_out_and_never_stops_at_a_line(self):
        # The model calls much more subject than the pick has beside it: a
        # second thing, out to far beyond the band's reach.
        matte = torch.maximum(soft_disc(radius=40, cx=100), torch.zeros(H, W))
        matte[H // 2 - 3:H // 2 + 3, 100:300] = 1.0                        # a long bar out of the subject
        alpha = subject_edge(disc(radius=40, cx=100), matte)
        row = alpha[H // 2, 140:300]
        steps = (row[1:] - row[:-1]).abs()
        self.assertGreater(float(row[:20].min()), 0.9, "near the pick the bar is taken whole")
        self.assertEqual(float(row[-40:].max()), 0.0, "far beyond the reach nothing is taken")
        self.assertLess(float(steps.max()), 0.2, "and in between it fades, with no cut")

    def test_nothing_and_everything_are_left_as_they_are(self):
        matte = soft_disc()
        for picked in (torch.zeros(H, W, dtype=torch.bool), torch.ones(H, W, dtype=torch.bool)):
            self.assertTrue(torch.equal(subject_edge(picked, matte), picked.float()))

    def test_a_result_that_loses_most_of_the_pick_is_thrown_away(self):
        # A thin ring round the subject's outline: the model's subject has a hole where the ring is.
        ring = disc(radius=74) & ~disc(radius=62)
        matte = soft_disc(radius=70) * 0.0 + (disc(radius=62)).float() * 0.0
        matte = torch.zeros(H, W)
        matte[disc(radius=200)] = 0.0
        # Subject inside the ring's inner side only at its very rim: the ring itself is "not subject".
        inside = disc(radius=74)
        fake = inside.float()
        fake[ring] = 0.02
        alpha = subject_edge(ring | disc(radius=20), fake)
        kept = float((alpha * (ring | disc(radius=20)).float()).sum()) / float((ring | disc(radius=20)).sum())
        self.assertGreaterEqual(kept, KEEP_AT_LEAST, "never less than that share of the pick")

    def test_a_big_picture_is_planned_small_and_answered_full_size(self):
        height, width = 1500, 2000
        matte = soft_disc(height=height, width=width, radius=420, edge=30.0)
        picked = disc(height, width, radius=432)
        alpha = subject_edge(picked, matte)
        self.assertEqual(tuple(alpha.shape), (height, width))
        self.assertTrue(torch.allclose(alpha, fine._firm(matte), atol=0.06))
        self.assertEqual(float(alpha[height // 2, width // 2]), 1.0)
        self.assertEqual(float(alpha[5, 5]), 0.0)

    def test_how_deep_is_counted_round_not_square(self):
        area = torch.ones(1, 1, 81, 81, dtype=torch.bool)
        area[0, 0, 40, 40] = False                                        # depth is the distance to this one hole
        deep = fine._depth(area, 60)[0, 0]
        straight, diagonal = float(deep[40, 60]), float(deep[60, 60])
        self.assertEqual(straight, 20.0)
        self.assertGreater(diagonal, 26.0, "a square count would say 20, a true circle 28")
        self.assertLess(diagonal, 32.0)

    def test_the_bands_are_what_the_help_page_says(self):
        self.assertEqual((REACH, INNER, fine.WORK_SIDE), (68, 40, 1024))
        self.assertEqual((fine.MOSTLY, fine.SOLID, fine.IS_SUBJECT, fine.NOT_SUBJECT), (0.6, 4, 0.8, 0.25))
        self.assertEqual((fine.PIECE_IS_SUBJECT, fine.THIN, fine.BODY, fine.POCKET), (0.75, 0.2, 12, 0.006))


class GrowTests(unittest.TestCase):
    def setUp(self):
        self.hard = disc(radius=40)[None].float()
        strand = torch.zeros(H, W)
        strand[H // 2 - 1:H // 2 + 1, W // 2 + 40:W // 2 + 70] = 0.5       # a strand 30 px long
        self.fine = torch.maximum(self.hard * 1.0, strand[None])

    def test_grown_the_area_is_solid_to_its_new_line_and_longer_strands_still_show(self):
        grown = grow_fine(self.fine, self.hard, 10)
        self.assertEqual(float(grown[0, H // 2, W // 2 + 48]), 1.0, "solid 8 px past the old edge")
        self.assertEqual(float(grown[0, H // 2, W // 2 + 62]), 0.5, "the strand's far end, as it was")
        values = set(grown.unique().tolist())
        self.assertEqual(values, {0.0, 0.5, 1.0}, "no grey steps of its own making")

    def test_shrunk_the_fine_edge_is_cut_back_to_the_new_line(self):
        shrunk = grow_fine(self.fine, self.hard, -10)
        self.assertEqual(float(shrunk[0, H // 2, W // 2 + 35]), 0.0)
        self.assertEqual(float(shrunk[0, H // 2, W // 2 + 20]), 1.0)
        self.assertEqual(float(shrunk[0, H // 2, W // 2 + 50]), 0.0, "the strand goes with it")

    def test_no_grow_changes_nothing(self):
        self.assertIs(grow_fine(self.fine, self.hard, 0), self.fine)


class ColourTests(unittest.TestCase):
    def test_half_see_through_strands_get_the_things_own_colour(self):
        # Red hair, a blue wall, and thin strands that are half one and half
        # the other: in the picture they are purple. At two sizes of picture,
        # because the clean-up's reach grows with the picture.
        red, blue = torch.tensor([0.9, 0.1, 0.1]), torch.tensor([0.1, 0.1, 0.9])
        for height, width in ((200, 320), (800, 1280)):
            step = width // 320
            alpha = torch.zeros(height, width)
            alpha[:, : width // 2] = 1.0
            strands = torch.zeros(height, width, dtype=torch.bool)
            for y in range(10 * step, height - 10 * step, 8 * step):
                strands[y:y + step, width // 2: width // 2 + 14 * step] = True
            alpha[strands] = 0.5
            picture = alpha.unsqueeze(-1) * red + (1 - alpha.unsqueeze(-1)) * blue
            clean = clean_colours(picture, alpha)
            self.assertEqual(tuple(clean.shape), (height, width, 3))
            solid = alpha == 1.0
            self.assertTrue(torch.allclose(clean[solid], picture[solid], atol=1e-5), "what is all the thing keeps the picture's colour")
            before = float((picture[strands] - red).abs().mean())
            after = float((clean[strands] - red).abs().mean())
            self.assertGreater(before, 0.25, "purple in the picture")
            self.assertLess(after, 0.08, f"red in the cut-out ({width} wide)")
            self.assertLess(after, before / 3)

    def test_the_cut_out_shows_the_clean_colour_where_the_mask_is_the_fine_edge(self):
        picture = torch.rand(8, 8, 3)
        clean = torch.rand(8, 8, 3)
        alpha = torch.rand(8, 8)
        self.assertTrue(torch.allclose(shown_colours(picture, clean, alpha, alpha), clean))
        self.assertTrue(torch.allclose(shown_colours(picture, clean, alpha, alpha * 0.5), clean), "a softer mask, the same colour")

    def test_a_grown_mask_goes_back_to_the_pictures_own_pixels(self):
        picture = torch.rand(8, 8, 3)
        clean = torch.rand(8, 8, 3)
        alpha = torch.rand(8, 8) * 0.9
        whole = shown_colours(picture, clean, alpha, torch.ones(8, 8))
        self.assertTrue(torch.allclose(whole, picture, atol=1e-4), "a mask of 1 shows the picture as it is")
        between = shown_colours(picture, clean, alpha, (alpha + 1) / 2)
        low, high = torch.minimum(picture, clean) - 1e-4, torch.maximum(picture, clean) + 1e-4
        self.assertTrue(bool(((between >= low) & (between <= high)).all()), "in between, a mix of the two")
        solid = shown_colours(picture, clean, torch.ones(8, 8), torch.ones(8, 8))
        self.assertTrue(bool(torch.isfinite(solid).all()))


if __name__ == "__main__":
    unittest.main()
