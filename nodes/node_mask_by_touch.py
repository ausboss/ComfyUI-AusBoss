"""Mask by Touch 🆎 — click a thing on the picture, or paint over it, and get its mask."""

from __future__ import annotations

from collections import OrderedDict
import contextlib
import itertools
import json
from pathlib import Path
import sys
import time
import weakref

import torch
import torch.nn.functional as F
from PIL import Image

from ._execution_helpers import advance_progress, progress_bar, raise_if_interrupted, warn_once
from ._fine_edge_helpers import OFF as FINE_OFF
from ._fine_edge_helpers import (
    fine_edge_choices,
    fine_edges as find_fine_edges,
    grow_fine,
    loaded_subject_models,
    shown_colours,
    subject_matte,
    wants_fine_edges,
)
from ._mask_by_name_helpers import IF_NOTHING, cut_out
from ._mask_by_touch_helpers import (
    NEEDS_SAM3,
    NOTHING_PICKED,
    NOT_A_PICTURE,
    NOT_SAM3,
    NO_TEXT_READER,
    OTHER_PICTURE,
    WORDS_FIRST,
    WORDS_MORE,
    Memory,
    PieceSieve,
    apply_item,
    box_of,
    choose_found,
    drop_specks,
    edge_mask,
    find_points,
    finish_mask,
    match_points,
    match_under,
    pack_planes,
    parse_touches,
    picture_key,
    plane_piece,
    read_ask,
    scope_points,
    shape_mask,
    small_picture,
    small_size,
    soft_stroke_area,
    soft_to_small,
    stroke_area,
    tidy_matches,
    to_small,
    touch_stamp,
    word_text,
)
from ._preview_helpers import temp_prefix

try:
    import folder_paths
except ImportError:  # Offline tests import this module without ComfyUI.
    folder_paths = None

# What the node's face reads after a run.
UI_KEY = "ausboss_mask_by_touch"
# How SAM 3 is asked, about points and about words: ComfyUI's own defaults
# for SAM 3 Detect.
SURENESS = 0.5
REFINE_PASSES = 2

# Finding the pieces for hovering (a look) works through one list of
# questions per picture (_scope_queue): words, then points. One run goes
# through the whole list. It stops early only when another job waits in
# ComfyUI's queue, so a click never waits for a look; the next look goes on
# where this one stopped. Where the queue cannot be read, a look stops after
# SCOPE_SECONDS_BLIND instead. Every look asks at least SCOPE_FLOOR
# questions, so the list always ends.
SCOPE_SECONDS_BLIND = 1.0
SCOPE_FLOOR = 1
# A look's first answer that takes longer than this had to load SAM 3: where
# the look's time is counted, it is counted from that answer on.
SCOPE_COLD = 0.6
# While a look runs it tells the node's face what it has found so far, about
# this often (seconds), and once more at its end: the event LOOK_EVENT.
LOOK_TELL_SECONDS = 1.5
LOOK_EVENT = "ausboss.mask_by_touch.look"
# The face is sent each picked thing's own area, so it can tell which chip a
# brush mark touches. This many at most; what is over has none.
AREAS_MAX = 48
# A look is quiet: while it runs, ComfyUI sends the page no progress reports
# (see _quiet), so the progress bar, the tab title and the node's outline do
# not flicker for a run nobody pressed Run for. Off: a look reports as any
# run does.
QUIET = True
# Points are lined up for a picture, SCOPE_POINTS at most, never closer
# together than SCOPE_SPACING. The first SCOPE_FIRST_POINTS are asked
# between the two lists of words, the rest after them.
SCOPE_POINTS = 400
SCOPE_SPACING = 16
SCOPE_FIRST_POINTS = 48
# The text reader reads this many upcoming words in one go, so that SAM 3
# stays the last model ComfyUI loaded while the words are asked.
WORDS_AHEAD = 16
# What the text reader made of a word is kept for this many words.
WORDS_KEPT = 512

# Asking SAM 3 about many points or words of one picture repeats two costly
# steps on every call: reading the picture, and ComfyUI's check that the
# model is loaded. With this on, both are done once per run (see _Session).
QUICK = True

# Shared by every Mask by Touch node: what SAM 3 answered, per picture.
_MEMORY = Memory()
# What the text reader made of each word, per text reader. A word reads the
# same for every picture, so it is read once.
_WORDS = OrderedDict()
# Per SAM 3 model and kind of question ("point", "word"): True once the
# quick way gave the same answers as the plain way, False once it did not
# (then it is never used again).
_TRUST = {}
# Per SAM 3 model and kind of question: how often its plain answers did not
# repeat, so the quick way could not be judged. After a few it is left off.
_UNSTEADY = {}
_TOKENS = weakref.WeakKeyDictionary()
_TOKEN_NUMBERS = itertools.count(1)
_PIECE_NUMBERS = itertools.count(1)
_NOTED = set()


def fine_made(grow, soften, smooth, fill_holes, invert, fine_edges) -> str:
    """The settings a fine edge was made with, as one line. The node's face
    writes the same line from its own controls, and shows the fine edge only
    while the two agree."""
    return "|".join((
        str(int(grow)), f"{float(soften):.3f}", str(int(smooth)),
        "1" if fill_holes else "0", "1" if invert else "0", str(fine_edges),
    ))


def _core_nodes() -> dict:
    """ComfyUI's own node classes, by key. Empty outside ComfyUI."""
    mappings = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", None)
    return mappings if isinstance(mappings, dict) else {}


def _model_management():
    """ComfyUI's model management module. None outside ComfyUI."""
    return sys.modules.get("comfy.model_management")


def _free_sam3(model, clip) -> bool:
    """Take SAM 3 and its text reader out of VRAM. Every other model stays.
    Best effort: where ComfyUI's unload is missing or fails, nothing is
    freed and the run goes on."""
    unload = getattr(_model_management(), "unload_model_and_clones", None)
    if unload is None:
        return False
    freed = False
    for patcher in (model, getattr(clip, "patcher", None)):
        if patcher is None:
            continue
        try:
            unload(patcher)
            freed = True
        except Exception:  # noqa: BLE001 - freeing memory never fails a run
            pass
    return freed


def _free_subject_models() -> None:
    """Take the background-removal model out of VRAM, with ComfyUI's own
    unload of one model. Best effort, as for SAM 3."""
    unload = getattr(_model_management(), "unload_model_and_clones", None)
    if unload is None:
        return
    for model in loaded_subject_models():
        patcher = getattr(model, "patcher", None)
        if patcher is None:
            continue
        try:
            unload(patcher)
        except Exception:  # noqa: BLE001 - freeing memory never fails a run
            pass


def _jobs_waiting():
    """How many jobs wait in ComfyUI's queue behind the one that is running.
    None when that cannot be read (another ComfyUI, or none at all). The
    queue is only looked at, never changed."""
    try:
        return len(sys.modules["server"].PromptServer.instance.prompt_queue.queue)
    except Exception:  # noqa: BLE001
        return None


def _server():
    """ComfyUI's own server object, which talks to its page. None outside
    ComfyUI."""
    try:
        return sys.modules["server"].PromptServer.instance
    except Exception:  # noqa: BLE001
        return None


def _tell(node_id, note: dict, end: bool) -> bool:
    """Tell the node's face what a look has found, over ComfyUI's own channel
    to its page. It goes to the page that asked for the run. True when it
    was sent; a failure never stops the look."""
    server = _server()
    if server is None or node_id is None:
        return False
    try:
        server.send_sync(
            LOOK_EVENT,
            {"node": str(node_id), "note": note, "end": bool(end)},
            getattr(server, "client_id", None),
        )
    except Exception:  # noqa: BLE001
        return False
    return True


def _hold_back(*_args, **_kwargs) -> None:
    """What stands in for ComfyUI's progress report while a look runs: the
    report is dropped, a stop by the user still stops the run."""
    raise_if_interrupted()


@contextlib.contextmanager
def _quiet():
    """While open, ComfyUI sends its page no progress reports.

    A look asks SAM 3 hundreds of questions, and ComfyUI's SAM 3 Detect
    reports "done" after each one. Each report redraws the progress bar, the
    tab title and the node's outline. ComfyUI sends them two ways, and both
    are held back here and put back on the way out, also when the run fails:
    - a progress bar hands its steps to one function (comfy.utils'
      PROGRESS_BAR_HOOK), which sends the `progress` message. A bar picks
      that function up when it is made, so for the time being it is one
      that only checks whether the user stopped the run;
    - the run's progress list sends `progress_state` through its handler
      for the page ("webui"), which is switched off with the list's own
      switch.
    Nothing of ComfyUI's is changed for good, and where a part is missing
    (another ComfyUI) that part is skipped: the look then reports as any
    run does.
    """
    undo = []
    try:
        utils = sys.modules.get("comfy.utils")
        plain = getattr(utils, "PROGRESS_BAR_HOOK", None)
        if plain is not None:
            utils.PROGRESS_BAR_HOOK = _hold_back

            def put_back():
                if getattr(utils, "PROGRESS_BAR_HOOK", None) is _hold_back:
                    utils.PROGRESS_BAR_HOOK = plain

            undo.append(put_back)
    except Exception:  # noqa: BLE001 - another ComfyUI: go without
        pass
    try:
        registry = sys.modules["comfy_execution.progress"].get_progress_state()
        handler = registry.handlers.get("webui")
        if handler is not None and handler.enabled:
            registry.disable_handler("webui")
            undo.append(lambda: registry.enable_handler("webui"))
    except Exception:  # noqa: BLE001
        pass
    try:
        yield bool(undo)
    finally:
        for step in reversed(undo):
            try:
                step()
            except Exception:  # noqa: BLE001
                pass


def _stopped_by_user(error: BaseException) -> bool:
    return type(error).__name__ == "InterruptProcessingException"


def _out_of_memory(error: BaseException) -> bool:
    return "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()


def _scope_plan(width: int, height: int) -> tuple:
    """The points to ask about for a picture's pieces, in asking order."""
    count = max(1, min(SCOPE_POINTS, (int(width) * int(height)) // (SCOPE_SPACING * SCOPE_SPACING)))
    return scope_points(int(width), int(height), count)


def _scope_queue(width: int, height: int) -> tuple:
    """Every question asked of a picture for its pieces, in asking order:
    the first words, the first points, the other words, the other points."""
    points = _scope_plan(width, height)
    return (
        tuple(("word", word) for word in WORDS_FIRST)
        + tuple(("point", point) for point in points[:SCOPE_FIRST_POINTS])
        + tuple(("word", word) for word in WORDS_MORE)
        + tuple(("point", point) for point in points[SCOPE_FIRST_POINTS:])
    )


def _token(target):
    """A name for one loaded model, so answers of another never mix in."""
    try:
        token = _TOKENS.get(target)
        if token is None:
            token = _TOKENS[target] = next(_TOKEN_NUMBERS)
        return token
    except TypeError:  # something that cannot be remembered by reference
        return ("id", id(target))


@contextlib.contextmanager
def _picture_read_once(model):
    """While open, SAM 3 reads a picture once and reuses what it read.

    ComfyUI's SAM 3 Detect runs the picture through the model's picture
    reader on every call: twice for a point with two passes, once for a word
    and twice more for the cut-out of each thing the word matched. For many
    questions about one picture the reader's answer is the same every time,
    so it is kept and handed back while the picture it is given stays equal,
    pixel for pixel (one picture for each way the reader is called: the
    whole picture for words, and the last one read for points and cut-outs).
    Nothing of ComfyUI's is copied or changed: the reader's own function is
    called, and put back as it was on the way out.
    """
    try:
        reader = model.model.diffusion_model.detector.backbone["vision_backbone"]
        plain = reader.forward
        own = vars(reader).get("forward")
    except Exception:  # noqa: BLE001 - another ComfyUI, another model: go without
        yield False
        return
    held = {}

    def forward(images, *args, **kwargs):
        try:
            key = (args, tuple(sorted(kwargs.items())))
            seen = held.get(key)
            same = (
                seen is not None
                and seen[0].shape == images.shape
                and seen[0].dtype == images.dtype
                and seen[0].device == images.device
                and bool(torch.equal(seen[0], images))
            )
        except Exception:  # noqa: BLE001 - arguments this was not written for
            return plain(images, *args, **kwargs)
        if same:
            return seen[1]
        answer = plain(images, *args, **kwargs)
        held[key] = (images, answer)
        return answer

    try:
        reader.forward = forward
    except Exception:  # noqa: BLE001
        yield False
        return
    try:
        yield True
    finally:
        held.clear()
        try:
            if own is None:
                del reader.forward
            else:
                reader.forward = own
        except Exception:  # noqa: BLE001
            pass


@contextlib.contextmanager
def _loaded_once(model):
    """While open, ComfyUI checks once that SAM 3 is loaded, not on every call.

    SAM 3 Detect asks ComfyUI to load the model at the start of each call.
    For a model that is already loaded that check walks every weight again,
    which takes longer than the question itself. Here the first call does it
    in full; later calls for the same model return at once, as long as that
    model is still the last one ComfyUI loaded. Any other model is loaded as
    always.
    """
    management = _model_management()
    plain = getattr(management, "load_model_gpu", None)
    if plain is None:
        yield False
        return
    state = {"loaded": False}

    def still_in_front() -> bool:
        try:
            loaded = management.current_loaded_models
            return bool(loaded) and loaded[0].model is model
        except Exception:  # noqa: BLE001
            return False

    def load_model_gpu(candidate, *args, **kwargs):
        if candidate is model and state["loaded"] and not args and not kwargs and still_in_front():
            return None
        answer = plain(candidate, *args, **kwargs)
        if candidate is model:
            state["loaded"] = True
        return answer

    management.load_model_gpu = load_model_gpu
    try:
        yield True
    finally:
        if getattr(management, "load_model_gpu", None) is load_model_gpu:
            management.load_model_gpu = plain


class _Session:
    """One run's questions to ComfyUI's own SAM 3 Detect.

    Every question goes through the node class's `execute`, as a workflow
    would ask it: about points, or about a word that ComfyUI's CLIP Text
    Encode has read. The quick way (QUICK) is proven before it is trusted,
    for points and for words apart: the first question of a kind that finds
    something is asked the plain way; with the next one the quick way is
    switched on, and the first is then asked again with it. Only the same
    answer, pixel for pixel, earns trust for that model. A question that
    fails with the quick way on is asked again the plain way.
    """

    KINDS = ("point", "word")

    def __init__(self, model, clip=None):
        self.model, self.clip = model, clip
        self.token = _token(getattr(model, "model", model))
        self.reader = None if clip is None else _token(getattr(clip, "cond_stage_model", clip))
        self.asked = 0
        self._detector = None
        self._open = None
        self._first = {}
        self._plain_only = set()

    def close(self) -> None:
        if self._open is not None:
            self._open.close()
            self._open = None

    # -- the text reader ------------------------------------------------------

    def knows(self, word: str) -> bool:
        return (self.reader, word_text(word)) in _WORDS

    def _read(self, word: str):
        """A word as SAM 3 takes it, from ComfyUI's own CLIP Text Encode."""
        key = (self.reader, word_text(word))
        held = _WORDS.get(key)
        if held is not None:
            _WORDS.move_to_end(key)
            return held
        if self.clip is None:
            raise RuntimeError(NO_TEXT_READER)
        encoder = _core_nodes().get("CLIPTextEncode")
        if encoder is None:
            raise RuntimeError(NEEDS_SAM3)
        try:
            held = encoder().encode(self.clip, key[1])[0]
        except Exception as error:  # noqa: BLE001 - told apart just below
            if _stopped_by_user(error) or _out_of_memory(error):
                raise
            raise RuntimeError(f"{NOT_SAM3} ({type(error).__name__}: {error})") from error
        _WORDS[key] = held
        while len(_WORDS) > WORDS_KEPT:
            _WORDS.popitem(last=False)
        return held

    def read_ahead(self, words, stop=None) -> None:
        """Read some words in one go. Reading a word loads the text reader,
        and SAM 3 is then no longer the last model ComfyUI loaded; reading
        the next few together costs that once, not once a word."""
        for number, word in enumerate(words):
            if number and stop is not None and stop():
                return
            self._read(word)

    # -- one question ---------------------------------------------------------

    def _call(self, kind: str, frame, what):
        """One question, straight to SAM 3 Detect. Points: H x W, True
        inside. A word: (N x H x W, [how sure of each])."""
        if self._detector is None:
            detector = _core_nodes().get("SAM3_Detect")
            if detector is None or not hasattr(detector, "execute"):
                raise RuntimeError(NEEDS_SAM3)
            self._detector = detector
        size = tuple(frame.shape[1:3])
        if kind == "point":
            output = self._detector.execute(
                model=self.model,
                image=frame,
                positive_coords=json.dumps([{"x": int(x), "y": int(y)} for x, y in what]),
                threshold=SURENESS,
                refine_iterations=REFINE_PASSES,
                individual_masks=False,
            )
            masks = output.result[0]
            if not isinstance(masks, torch.Tensor) or masks.ndim != 3 or tuple(masks.shape[1:]) != size:
                raise ValueError("the detector's answer is not one mask the size of the picture")
            self.asked += 1
            return (masks[0] > 0.5).cpu()
        output = self._detector.execute(
            model=self.model,
            image=frame,
            conditioning=what,
            threshold=SURENESS,
            refine_iterations=REFINE_PASSES,
            individual_masks=True,
        )
        masks, boxes = output.result[0], output.result[1]
        found = boxes[0] if boxes else []
        if not isinstance(masks, torch.Tensor) or masks.ndim != 3 or tuple(masks.shape[1:]) != size or len(found) != int(masks.shape[0]):
            raise ValueError("the detector's answer does not add up to one mask for each match")
        self.asked += 1
        return (masks > 0.5).cpu(), [float(box.get("score", 0.0)) for box in found]

    @staticmethod
    def _same(kind: str, one, other) -> bool:
        if kind == "point":
            return bool(torch.equal(one, other))
        return one[0].shape == other[0].shape and bool(torch.equal(one[0], other[0])) and one[1] == other[1]

    @staticmethod
    def _found(kind: str, answer) -> bool:
        return bool(answer.any()) if kind == "point" else int(answer[0].shape[0]) > 0

    def _careful(self, kind: str, frame, what):
        """One question. When it fails with the quick way on, it is asked
        once more the plain way; a failure the plain way says what to wire."""
        try:
            return self._call(kind, frame, what)
        except Exception as error:  # noqa: BLE001 - told apart just below
            if _stopped_by_user(error) or _out_of_memory(error) or str(error) == NEEDS_SAM3:
                raise
            if self._open is None:
                # A model or a text reader that is not SAM 3's fails
                # somewhere inside; say what to wire instead of showing that.
                raise RuntimeError(f"{NOT_SAM3} ({type(error).__name__}: {error})") from error
            self.close()
        try:
            answer = self._call(kind, frame, what)
        except Exception as error:  # noqa: BLE001
            if _stopped_by_user(error) or _out_of_memory(error):
                raise
            raise RuntimeError(f"{NOT_SAM3} ({type(error).__name__}: {error})") from error
        # The plain way answers where the quick way failed.
        self._distrust("a question failed with it")
        return answer

    def _switch_on(self) -> bool:
        stack = contextlib.ExitStack()
        loaded = stack.enter_context(_loaded_once(self.model))
        read = stack.enter_context(_picture_read_once(self.model))
        if not (loaded or read):
            stack.close()
            return False
        self._open = stack
        return True

    def _distrust(self, why: str) -> None:
        self.close()
        for kind in self.KINDS:
            _TRUST[(self.token, kind)] = False
        warn_once(f"Mask by Touch: asking SAM 3 the quick way is off ({why}); answers are the same, only slower.", _NOTED)

    def _repeats(self, kind: str) -> bool:
        """Does the run's first question of this kind get its answer again?"""
        frame, what, answer = self._first[kind]
        try:
            return self._same(kind, self._call(kind, frame, what), answer)
        except Exception as error:  # noqa: BLE001 - told apart just below
            if _stopped_by_user(error) or _out_of_memory(error):
                raise
            return False

    def _prove(self, kind: str, frame, what):
        """Answer a question while proving the quick way for its kind."""
        if self._open is None and not self._switch_on():
            _TRUST[(self.token, kind)] = False  # nothing here to switch on: do not try again
            return self._careful(kind, frame, what)
        answer = self._careful(kind, frame, what)
        if self._open is None:
            return answer  # it failed with the quick way on and was asked plainly
        # The first question again: this time nothing is read or loaded anew.
        if self._repeats(kind):
            _TRUST[(self.token, kind)] = True
            return answer
        self.close()
        if self._repeats(kind):
            # The plain way repeats its answer, the quick way did not.
            self._distrust("it changed an answer")
        else:
            # This SAM 3 does not answer the same twice: nothing to judge by.
            self._plain_only.add(kind)
            _UNSTEADY[(self.token, kind)] = _UNSTEADY.get((self.token, kind), 0) + 1
            if _UNSTEADY[(self.token, kind)] >= 3:
                _TRUST[(self.token, kind)] = False
        return self._careful(kind, frame, what)

    def _question(self, kind: str, frame, what):
        trust = _TRUST.get((self.token, kind)) if QUICK and kind not in self._plain_only else False
        if trust:
            if self._open is None:
                self._switch_on()
            return self._careful(kind, frame, what)
        if trust is None and kind in self._first:
            return self._prove(kind, frame, what)
        # Not proven for this kind of question (yet): asked the plain way.
        self.close()
        answer = self._careful(kind, frame, what)
        if trust is None and self._found(kind, answer):
            self._first[kind] = (frame, what, answer)
        return answer

    def ask(self, frame, points) -> torch.Tensor:
        """What SAM 3 finds at these points of one picture, read as one
        thing: H x W, True inside."""
        return self._question("point", frame, points)

    def ask_word(self, frame, word: str) -> tuple:
        """Everything SAM 3 calls by this word in one picture: (N x H x W,
        True inside; how sure it is of each, 0 to 1), the surest first."""
        return self._question("word", frame, self._read(word))


class AusBossMaskByTouch:
    CATEGORY = "🆎 AusBoss/Mask"
    DESCRIPTION = (
        "Click a thing on the picture, or paint over it, and get its mask. "
        "No name to type and no MaskEditor. Moving over the picture lights "
        "up what a click would take. A painted stroke takes the thing under "
        "it, or exactly the paint. What is lit is what the mask will be. "
        "When nothing is picked it stops the run with a plain message, so "
        "nothing after it runs on an empty mask (or it can pass an empty "
        "mask on: a setting). It uses ComfyUI's own SAM 3: wire model and "
        "clip from a Load Checkpoint that loads the SAM 3 file. It also "
        "returns the picked area cut out on a see-through background, and "
        "the names of what you picked as text."
    )
    SEARCH_ALIASES = [
        "quick select", "magic wand", "click to mask", "segment", "segment anything",
        "sam", "sam3", "select", "pick", "brush mask", "inpaint mask", "paint mask",
        "point", "tap", "touch", "object mask", "auto mask", "ausboss",
    ]
    # An output node, so the node's own picture can run it on its own.
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The picture to pick from."}),
                "model": (
                    "MODEL",
                    {"tooltip": "SAM 3: MODEL from a Load Checkpoint that loads the SAM 3 file."},
                ),
                "clip": (
                    "CLIP",
                    {"tooltip": "SAM 3's text reader: CLIP from the same Load Checkpoint."},
                ),
                "touches": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": (
                            "What you picked on the node's picture. The node writes this "
                            "itself when you click or paint; Clear on the node empties it."
                        ),
                    },
                ),
                "grow": (
                    "INT",
                    {
                        "default": 0,
                        "min": -128,
                        "max": 256,
                        "step": 1,
                        "tooltip": "Grow the picked area by this many pixels. Below zero shrinks it. 0 keeps the exact outline.",
                    },
                ),
                "soften": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.1,
                        "tooltip": "Soften the mask's edge by this many pixels. 0 keeps a hard edge.",
                    },
                ),
                "smooth": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 64,
                        "step": 1,
                        "tooltip": "Round off a ragged outline by this many pixels. 0 leaves the outline as found.",
                    },
                ),
                "fill_holes": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Closes pinholes inside the picked area. Larger openings "
                            "stay open, like a mug's handle."
                        ),
                    },
                ),
                "if_nothing": (
                    list(IF_NOTHING),
                    {
                        "default": IF_NOTHING[0],
                        "tooltip": (
                            "When nothing is picked. Stop the run: the workflow stops here "
                            "with a message, and nothing after this node runs. Empty mask: "
                            "the run goes on with a mask of nothing."
                        ),
                    },
                ),
            },
            "optional": {
                "free_vram": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Takes SAM 3 out of the graphics card's memory when the "
                            "workflow has run this node. Turn it on in a workflow that "
                            "loads a big model after this node."
                        ),
                    },
                ),
                "invert": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Turns the mask round: white everywhere except what you "
                            "picked. With nothing picked the mask stays empty."
                        ),
                    },
                ),
                "ask": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": (
                            "Used by the node's own picture for a single run. Leave it "
                            "empty: it is never saved with the workflow."
                        ),
                    },
                ),
                "fine_edges": (
                    fine_edge_choices(),
                    {
                        "default": FINE_OFF,
                        "tooltip": (
                            "Hair and fur, strand by strand: where what you picked ends "
                            "at the outline of the picture's main subject, that outline "
                            "is taken from ComfyUI's background-removal model. The "
                            "cut-out also loses the colour of the old background. Off "
                            "keeps the edge as found. The ? page says where to get the "
                            "model file."
                        ),
                    },
                ),
            },
            # ComfyUI hands the node its own id here, so a look can tell this
            # node's face what it has found. Not a widget and not a socket.
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    @classmethod
    def IS_CHANGED(cls, ask="", **_values):
        # A request from the node's own face always runs: the same "scope"
        # asked again is the next round, never ComfyUI's remembered answer.
        # An ordinary run is remembered by its inputs as any node's is.
        return float("nan") if str(ask or "").strip() else ""

    RETURN_TYPES = ("MASK", "IMAGE", "STRING")
    RETURN_NAMES = ("mask", "cut_out", "names")
    OUTPUT_TOOLTIPS = (
        "White where the picked area is. One mask per picture.",
        "The picture with everything but the picked area see-through (RGBA).",
        (
            "The names of the things you picked, in the order you picked them, "
            "like: jacket, hat. Empty when nothing you picked has a name."
        ),
    )
    FUNCTION = "pick"

    def __init__(self):
        # Per instance, so two of these in one graph never overwrite each
        # other's files in ComfyUI's temp folder.
        self._prefix = temp_prefix("mask_by_touch")
        self._files = OrderedDict()
        # What Fine edges is set to in the run at hand: the subject is asked
        # of that model.
        self._edge_choice = FINE_OFF

    # -- what SAM 3 finds ---------------------------------------------------

    def _tap(self, session: _Session, frame, frame_key: str, point):
        """The thing at one point, without its stray specks. None for nothing.

        Hovering's pieces and taps share this, and what it returned is
        remembered, so a tap on a piece that was shown gives that piece."""
        key = (session.token, frame_key, ("tap", int(point[0]), int(point[1])))
        found, answer = _MEMORY.get(key)
        if not found:
            answer = drop_specks(session.ask(frame, [point]), point)
            answer = answer if bool(answer.any()) else None
            _MEMORY.put(key, answer)
        return answer

    def _named(self, session: _Session, frame, frame_key: str, word: str) -> list:
        """Everything in one picture that SAM 3 calls by a word, tidied:
        [(H x W bool, how sure), ...].

        Hovering's named pieces and `name` touches share this, and what it
        returned is remembered, so a touch on a named piece that was shown
        gives that piece."""
        key = (session.token, session.reader, frame_key, ("word", word))
        found, matches = _MEMORY.get_matches(key)
        if not found:
            matches = tidy_matches(*session.ask_word(frame, word))
            _MEMORY.put_matches(key, matches)
        return matches

    def _area(self, session: _Session, frame, frame_key: str, item, strokes: dict):
        """One item's own area on one picture, what it was used as, and
        which matches of its word it is (a `name` or `all` touch only):
        (H x W bool or None, "thing" | "paint" | "none", tuple of match numbers).
        The area of a `paint` touch made with a soft brush is float, 0..1.
        """
        height, width = int(frame.shape[1]), int(frame.shape[2])
        if item.kind in ("subject", "background"):
            # The picture's main subject, as ComfyUI's background-removal
            # model sees it, or everything but it.
            subject = subject_matte(frame, self._edge_choice, frame_key) >= 0.5
            area = subject if item.kind == "subject" else ~subject
            return (area, "thing", ()) if bool(area.any()) else (None, "none", ())
        if item.kind == "all":
            # Every thing called by that word, joined.
            matches = self._named(session, frame, frame_key, item.word) if item.word else []
            if not matches:
                return None, "none", ()
            area = torch.zeros(height, width, dtype=torch.bool)
            for mask, _ in matches:
                area |= mask
            return area, "thing", tuple(range(len(matches)))
        if item.kind in ("tap", "name"):
            if not (0 <= item.x < width and 0 <= item.y < height):
                return None, "none", ()
            if item.kind == "tap":
                answer = self._tap(session, frame, frame_key, (item.x, item.y))
                return (answer, "thing", ()) if answer is not None else (None, "none", ())
            if not item.word:
                return None, "none", ()
            # Of the things called by that word, the smallest at the point.
            matches = self._named(session, frame, frame_key, item.word)
            index = match_under(matches, (item.x, item.y))
            return (None, "none", ()) if index is None else (matches[index][0], "thing", (index,))
        if item.kind not in ("find", "paint"):
            return None, "none", ()
        if item.kind == "paint" and item.soft > 0:
            # A brush with a soft edge: its area fades out (float 0..1).
            # None when the edge is too thin to be soft.
            if (item, "soft") not in strokes:
                strokes[(item, "soft")] = soft_stroke_area(item.pts, item.r, item.soft, height, width)
            if strokes[(item, "soft")] is not None:
                return strokes[(item, "soft")], "paint", ()
        stroke = strokes.get(item)
        if stroke is None:
            stroke = strokes[item] = stroke_area(item.pts, item.r, height, width)
        if item.kind == "paint":
            return stroke, "paint", ()
        key = (session.token, frame_key, ("find", item.r, item.pts))
        found, answer = _MEMORY.get(key)
        if not found:
            many, pair = find_points(item.pts, height, width)
            answer = choose_found(
                session.ask(frame, many) if many else None,
                session.ask(frame, pair) if pair else None,
                stroke,
            )
            _MEMORY.put(key, answer)
        # Over empty space the paint is kept as it is.
        return (answer, "thing", ()) if answer is not None else (stroke, "paint", ())

    def _look(self, session: _Session, frame, key: str, pieces: dict, pointer=None, tell=None) -> dict:
        """Find a picture's pieces for hovering.

        The picture is asked about everyday words (every thing SAM 3 calls
        by a word is a piece with that name) and about points spread over
        it (what no word found). A look works through the whole list of
        questions, from where the last one stopped. It ends early only when
        another job waits in ComfyUI's queue, or after SCOPE_SECONDS_BLIND
        where the queue cannot be read. The pointer's place, when given, is
        asked first, so what the person points at lights up first.

        `tell`, when given, is called with the pieces found so far about
        every LOOK_TELL_SECONDS, and as soon as the pointer's place gave a
        piece.
        """
        height, width = int(frame.shape[1]), int(frame.shape[2])
        queue = _scope_queue(width, height)
        sieve = pieces["sieve"]
        fresh = {}  # (name or None, point) -> (area, is it tidy and remembered)
        started = told = time.perf_counter()
        warm = False

        def answered(known: bool, since: float) -> None:
            # A first answer that took long had to load SAM 3: the look's
            # time starts after it, or a cold look would hand back nothing.
            nonlocal started, warm
            if not known and not warm:
                warm = True
                if time.perf_counter() - since > SCOPE_COLD:
                    started = time.perf_counter()

        def say() -> None:
            nonlocal told
            self._settle(session, frame, key, pieces, fresh)
            tell(pieces)
            told = time.perf_counter()

        if pointer is not None:
            since = time.perf_counter()
            known = _MEMORY.has((session.token, key, ("tap", pointer[0], pointer[1])))
            answer = self._tap(session, frame, key, pointer)
            answered(known, since)
            if answer is not None and sieve.offer(pointer, answer, pointed=True):
                fresh[(None, pointer)] = (answer, True)
                if tell is not None:
                    say()
        asked = 0
        while pieces["next"] < len(queue):
            if asked >= SCOPE_FLOOR:
                waiting = _jobs_waiting()
                if waiting:
                    break  # a click, or a run of the workflow: it goes first
                if waiting is None and time.perf_counter() - started > SCOPE_SECONDS_BLIND:
                    break
            raise_if_interrupted()
            since = time.perf_counter()
            kind, what = queue[pieces["next"]]
            if kind == "word":
                known = _MEMORY.has((session.token, session.reader, key, ("word", what)))
                if not known and not session.knows(what):
                    ahead = []
                    for later_kind, later in queue[pieces["next"]:pieces["next"] + WORDS_AHEAD]:
                        if later_kind != "word":
                            break
                        ahead.append(later)
                    session.read_ahead(ahead, stop=_jobs_waiting)
                matches = self._named(session, frame, key, what)
                for (area, sure), point in zip(matches, match_points(matches)):
                    if point is not None and sieve.offer(point, area, name=what, sure=sure):
                        fresh[(what, point)] = (area, True)
                pieces["words"] += 1
            else:
                memory_key = (session.token, key, ("tap", what[0], what[1]))
                known, answer = _MEMORY.get(memory_key)
                if not known:
                    answer = session.ask(frame, [what])
                    if not bool(answer.any()):
                        _MEMORY.put(memory_key, None)
                        answer = None
                if answer is not None and sieve.offer(what, answer):
                    fresh[(None, what)] = (answer, known)
            answered(known, since)
            pieces["next"] += 1
            asked += 1
            if not QUIET:
                # A new bar each time: only a bar's first report is sent at
                # once, and SAM 3 Detect reports "done" after every call.
                advance_progress(progress_bar(len(queue)), pieces["next"], len(queue))
            if tell is not None and time.perf_counter() - told >= LOOK_TELL_SECONDS:
                say()
        self._settle(session, frame, key, pieces, fresh)
        return pieces

    def _settle(self, session: _Session, frame, key: str, pieces: dict, fresh: dict) -> None:
        """Make the pieces found so far ready to show: their list, smallest
        first, and the small copies packed into planes. `fresh` holds the
        areas found since the last time, and is emptied."""
        height, width = int(frame.shape[1]), int(frame.shape[2])
        small_width, small_height, _ = small_size(width, height)
        sieve = pieces["sieve"]
        before = {ident: slot for slot, ident in enumerate(pieces["ids"])}
        rows = []
        for ident in sieve.settle():
            name, point = ident
            if ident in before:
                entry, small = pieces["list"][before[ident]], None
            else:
                # A piece kept by a look that was stopped half way is asked
                # for again: its answer was not held on to.
                answer, tidy = fresh.get(ident) or (self._piece(session, frame, key, name, point), True)
                if answer is None:
                    continue
                if not tidy:
                    # What a tap at this point gives: the same answer, tidied
                    # the same way, remembered so the tap asks nothing.
                    answer = drop_specks(answer, point)
                    _MEMORY.put((session.token, key, ("tap", point[0], point[1])), answer)
                sure = sieve.sure_of(name, point)
                entry = {
                    "x": point[0], "y": point[1],
                    "share": round(float(answer.sum()) / (height * width), 5), "box": box_of(answer),
                    "kind": "point" if name is None else "name", "name": name,
                    "sure": None if sure is None else round(sure, 3),
                }
                small = to_small(answer, small_width, small_height)
            rows.append((entry["share"], point, name or "", ident, entry, small))
        fresh.clear()
        rows.sort(key=lambda row: row[:3])
        ordered = [row[3] for row in rows]
        if ordered != pieces["ids"] or not pieces["number"]:
            # Pieces shown before keep the small copy that was shown.
            masks = [row[5] if row[5] is not None else plane_piece(pieces["planes"], before[row[3]]) for row in rows]
            pieces["number"] = next(_PIECE_NUMBERS)
            pieces["ids"] = ordered
            pieces["list"] = [row[4] for row in rows]
            pieces["planes"] = pack_planes(masks)

    def _piece(self, session: _Session, frame, key: str, name, point):
        """The area of a piece from what is remembered: a point's answer, or
        the match of a word that the piece's own point stands for."""
        if name is None:
            return self._tap(session, frame, key, point)
        matches = self._named(session, frame, key, name)
        index = match_under(matches, point)
        return None if index is None else matches[index][0]

    # -- files for the node's face -------------------------------------------

    def _write(self, picture: Image.Image, kind: str, extension: str, **options):
        """Save one picture into ComfyUI's temp folder; None when it fails.
        The face is a convenience: the mask is returned either way."""
        try:
            if folder_paths is None:
                raise RuntimeError("ComfyUI's temp folder is not there")
            folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                f"{self._prefix}_{kind}", folder_paths.get_temp_directory(), picture.width, picture.height
            )
            file = f"{name}_{counter:05}_.{extension}"
            picture.save(Path(folder) / file, **options)
        except Exception as error:  # noqa: BLE001 - any failure here is non-fatal
            detail = str(error).encode("ascii", "replace").decode("ascii")
            warn_once(f"Mask by Touch: the node's picture is unavailable ({detail}).", _NOTED, limit=64)
            return None
        return {"filename": file, "subfolder": subfolder, "type": "temp"}

    def _kept(self, what):
        """A file written earlier for the same thing, if it is still there."""
        entry = self._files.get(what)
        if entry is None:
            return None
        try:
            files = entry if isinstance(entry, list) else [entry]
            folder = Path(folder_paths.get_temp_directory())
            if all((folder / file["subfolder"] / file["filename"]).is_file() for file in files):
                self._files.move_to_end(what)
                return entry
        except Exception:  # noqa: BLE001
            pass
        self._files.pop(what, None)
        return None

    def _keep(self, what, entry):
        if entry is not None and (not isinstance(entry, list) or all(file is not None for file in entry)):
            self._files[what] = entry
            while len(self._files) > 12:
                self._files.popitem(last=False)
        return entry

    def _picture_file(self, image, key: str, small_width: int, small_height: int):
        entry = self._kept(("picture", key))
        if entry is None:
            picture = Image.fromarray(small_picture(image, small_width, small_height).numpy())
            entry = self._keep(("picture", key), self._write(picture, "picture", "jpg", format="JPEG", quality=90))
        return entry

    def _pieces_note(self, pieces):
        if pieces is None:
            return None
        planes = self._kept(("pieces", pieces["number"]))
        if planes is None:
            planes = [
                self._write(Image.fromarray(plane.numpy()), "pieces", "png", format="PNG", compress_level=1)
                for plane in pieces["planes"]
            ]
            if any(plane is None for plane in planes):
                return None
            self._keep(("pieces", pieces["number"]), planes)
        return {
            "planes": planes, "list": pieces["list"], "more": pieces["next"] < pieces["total"],
            "words": [pieces["words"], pieces["words_total"]],
        }

    def _areas_note(self, key: str, stamp: str, things: list, small_width: int, small_height: int):
        """Each picked thing's own area at the face's small size, packed like
        the pieces: area n is bit n % 24 of plane n // 24, and `items` says
        which touch it is the area of. None when no thing is picked."""
        if not things:
            return None
        planes = self._kept(("areas", key, stamp))
        if planes is None:
            packed = pack_planes([to_small(area, small_width, small_height) for _, area in things])
            planes = [
                self._write(Image.fromarray(plane.numpy()), "areas", "png", format="PNG", compress_level=1)
                for plane in packed
            ]
            if any(plane is None for plane in planes):
                return None
            self._keep(("areas", key, stamp), planes)
        return {"planes": planes, "items": [index for index, _ in things]}

    # -- the run -------------------------------------------------------------

    def pick(
        self, image, model, clip, touches, grow, soften, smooth, fill_holes, if_nothing,
        free_vram=False, invert=False, ask="", fine_edges=FINE_OFF, unique_id=None,
    ):
        session = _Session(model, clip)
        try:
            return self._run(
                session, image, touches, grow, soften, smooth, fill_holes, if_nothing, invert, ask, unique_id, fine_edges
            )
        finally:
            session.close()
            # Also when the run stops: SAM 3 may have been loaded for it. Not
            # on a run the node's own picture asked for: clicking and
            # hovering would load SAM 3 again every time.
            if free_vram and not str(ask or "").strip():
                if _free_sam3(model, clip):
                    print("[AusBoss] Mask by Touch: SAM 3 unloaded from VRAM.")
                _free_subject_models()

    def _run(
        self, session, image, touches, grow, soften, smooth, fill_holes, if_nothing, invert, ask, unique_id,
        fine_edges=FINE_OFF,
    ):
        if not isinstance(image, torch.Tensor) or image.ndim != 4 or 0 in image.shape:
            raise ValueError(NOT_A_PICTURE)
        height, width = int(image.shape[1]), int(image.shape[2])
        asked, pointer = read_ask(ask, height, width)
        key = picture_key(image)
        picked = parse_touches(touches)
        # Touches made on another picture are not this picture's.
        elsewhere = picked.key not in (None, key) and bool(picked.items)
        items = () if elsewhere else picked.items
        strokes, selections, painted, item_notes = {}, [], [], []
        # Each picked thing's own area on the first picture, for the face.
        things = []
        self._edge_choice = fine_edges
        subject_trouble = None
        # Per word, which of its matches are picked on the first picture. A
        # word is in while it has any, in the order the words were picked.
        named = {}
        keys = []
        for index in range(int(image.shape[0])):
            frame = image[index:index + 1]
            frame_key = key if index == 0 else picture_key(frame)
            keys.append(frame_key)
            selection = torch.zeros(height, width, dtype=torch.bool)
            # Where the last word was paint: that stays exactly as painted,
            # whatever the fine edge would make of it.
            by_paint = torch.zeros(height, width, dtype=torch.bool)
            for item in items:
                raise_if_interrupted()
                try:
                    area, used, which = self._area(session, frame, frame_key, item, strokes)
                except Exception as error:  # noqa: BLE001
                    # The subject could not be asked for (no model file, an
                    # older ComfyUI). A run of the workflow stops with the
                    # reason; a look from the node's own picture goes on
                    # without that pick, and the picture says why.
                    if item.kind not in ("subject", "background") or not asked or _stopped_by_user(error):
                        raise
                    area, used, which = None, "none", ()
                    subject_trouble = str(error)
                if index == 0:
                    share = 0.0 if area is None else round(float(area.sum()) / (height * width), 5)
                    item_notes.append({"ok": used != "none", "share": share, "as": used})
                    if item.kind == "all":
                        item_notes[-1]["count"] = len(which)
                    if area is not None and item.add and item.kind != "paint" and len(things) < AREAS_MAX:
                        things.append((len(item_notes) - 1, area))
                    # A word the face did not show (SAM 3 was not sure of
                    # it) is not given out as a name either.
                    if item.add and which and not item.quiet:
                        named.setdefault(item.word, set()).update(which)
                    elif not item.add and item.word in named:
                        # Taken away again: every match (`all`), or the one at the point.
                        left = set() if item.kind == "all" else named[item.word] - set(which)
                        if left:
                            named[item.word] = left
                        else:
                            del named[item.word]
                if area is not None:
                    before = selection
                    selection = apply_item(selection, area, item.add)
                    if index == 0 and not item.add:
                        # A touch that takes away where nothing was picked
                        # took nothing: the face does not keep it.
                        item_notes[-1]["did"] = before.dtype != selection.dtype or not torch.equal(before, selection)
                    touched = area if area.dtype == torch.bool else area > 0
                    by_paint = torch.where(touched, torch.full_like(by_paint, used == "paint"), by_paint)
            selections.append(selection)
            painted.append(by_paint)
        # On or off, until a brush with a soft edge has painted: then 0..1.
        if any(selection.dtype != torch.bool for selection in selections):
            selections = [selection.to(torch.float32) for selection in selections]
        raw = torch.stack(selections)
        soft = raw.dtype != torch.bool
        if not bool(raw.any()) and not asked and str(if_nothing) != IF_NOTHING[1]:
            # Picks the face may still show, made before the picture
            # changed: say so, not that nothing is picked.
            raise RuntimeError(OTHER_PICTURE if elsewhere else NOTHING_PICKED)
        # A look for pieces (scope) returns no mask anyone uses: no fine edge then.
        fine = wants_fine_edges(fine_edges) and asked != "scope" and bool(raw.any())
        some = raw.flatten(1).any(dim=1)[:, None, None]
        colours, fine_trouble = None, subject_trouble
        if fine:
            # The fine edge is found on the tidied area. Paint stays as painted.
            shaped = shape_mask(raw, int(smooth), bool(fill_holes)) >= 0.5
            try:
                found, clean = find_fine_edges(
                    image, shaped, str(fine_edges), turned=bool(invert), keep_hard=torch.stack(painted), keys=keys,
                )
            except Exception as error:  # noqa: BLE001
                # A run of the workflow stops with the reason. A look the
                # node's own picture asked for goes on with the plain edge,
                # and the picture says why.
                if not asked or _stopped_by_user(error):
                    raise
                fine, fine_trouble = False, str(error)
        if fine and soft:
            # Where a soft brush had the last word its fade stays as painted.
            fade = torch.stack(painted) & (raw > 0) & (raw < 1)
            found = torch.where(fade, raw, found)
        if fine:
            # Grow moves the plain area and lays it over the fine edge;
            # Soften then works on the whole.
            mask = edge_mask(grow_fine(found, shaped, int(grow)), 0, float(soften))
        else:
            mask = finish_mask(raw, int(grow), float(soften), int(smooth), bool(fill_holes))
        if invert:
            # Turned round, but only where something is picked: nothing
            # picked stays an empty mask, never the whole picture.
            mask = torch.where(some, 1.0 - mask, mask)
        if fine:
            cover = torch.where(some, 1.0 - found, found) if invert else found
            colours = shown_colours(image[..., :3].float().cpu(), clean, cover, mask)

        small_width, small_height, scale = small_size(width, height)
        selection_file = None
        if bool(raw[0].any()):
            if soft:
                # Grey where a soft brush painted: the face reads the strength.
                levels = soft_to_small(raw[0], small_width, small_height).mul(255.0).round().to(torch.uint8)
            else:
                levels = to_small(raw[0], small_width, small_height).to(torch.uint8) * 255
            selection_file = self._write(Image.fromarray(levels.numpy()), "selection", "png", format="PNG")
        stamp, mask_share = touch_stamp(touches), round(float(mask[0].mean()), 5)
        # The fine edge at the face's small size: the colours of the cut-out
        # with the mask as their see-through channel, and what it was made with.
        fine_note = None
        if fine:
            small_cut = torch.cat([colours[:1], mask[:1].unsqueeze(-1)], dim=-1).movedim(-1, 1)
            if tuple(small_cut.shape[-2:]) != (small_height, small_width):
                small_cut = F.interpolate(small_cut, size=(small_height, small_width), mode="area")
            pixels = small_cut[0].movedim(0, -1).clamp(0.0, 1.0).mul(255.0).round().to(torch.uint8).numpy()
            file = self._write(Image.fromarray(pixels, "RGBA"), "fine", "png", format="PNG", compress_level=1)
            if file is not None:
                fine_note = {
                    "file": file,
                    "made": fine_made(grow, soften, smooth, fill_holes, invert, fine_edges),
                }
        elif fine_trouble:
            fine_note = {"trouble": fine_trouble}
        areas_note = self._areas_note(key, stamp, things, small_width, small_height)

        def note(pieces) -> dict:
            return {
                "key": key,
                "width": width,
                "height": height,
                "scale": scale,
                "stamp": stamp,
                "picture": self._picture_file(image, key, small_width, small_height),
                "selection": selection_file,
                "items": item_notes,
                "share": mask_share,
                "pieces": self._pieces_note(pieces),
                "fine": fine_note,
                "areas": areas_note,
            }

        pieces_key = (session.token, session.reader, key)
        pieces = _MEMORY.get_pieces(pieces_key)
        if asked == "scope" and (pieces is None or pointer is not None or pieces["next"] < pieces["total"]):
            if pieces is None:
                words = len(WORDS_FIRST) + len(WORDS_MORE)
                pieces = {
                    "sieve": PieceSieve(height, width), "next": 0, "total": len(_scope_queue(width, height)),
                    "words": 0, "words_total": words, "number": 0, "ids": [], "list": [], "planes": [],
                }
                # Remembered from the start: a look that is stopped half way
                # is gone on with, not begun again.
                _MEMORY.put_pieces(pieces_key, pieces)
            # Without the node's id, or outside ComfyUI, there is nobody to tell.
            tell = None if unique_id is None or _server() is None else (lambda found: _tell(unique_id, note(found), False))
            with _quiet() if QUIET else contextlib.nullcontext():
                self._look(session, image[:1], key, pieces, pointer, tell)
            _MEMORY.put_pieces(pieces_key, pieces)
        result = note(pieces)
        if asked == "scope":
            _tell(unique_id, result, True)
        return {"ui": {UI_KEY: [result]}, "result": (mask, cut_out(image if colours is None else colours, mask), ", ".join(named))}


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_MaskByTouch": AusBossMaskByTouch}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_MaskByTouch": "Mask by Touch 🆎"}
