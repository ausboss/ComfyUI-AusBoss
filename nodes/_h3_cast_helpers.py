"""Who and what a MiniMax H3 clip is made from, in H3's own labels.

Every picture has one job and the video has one job. This numbers them the way
H3 counts them, and writes what each job needs in subject_definitions and
retention_analysis. Plain text, so the tests run without a server.
"""

from __future__ import annotations

from dataclasses import dataclass
import re

PERSON = "person"
SHEET = "character sheet"
PLACE = "place"
OUTFIT = "outfit"
THING = "thing"
STYLE = "style"
START = "start on it"
END = "end on it"
JOBS = (PERSON, SHEET, PLACE, OUTFIT, THING, STYLE, START, END)
# Not a pick on the node: a thing picture that does the action of a move copy or a swap (a cartoon hand, a toy,
# a mascot). It takes the place a person would, with its own shape and look.
PERFORMER = "thing that moves"
ACTORS = (PERSON, SHEET, PERFORMER)

MOVES = "copy its moves"
SWAP = "swap the person"
KEEP = "keep going"
REVOICE = "new voice"
EDIT = "change something"
VIDEO_JOBS = (MOVES, SWAP, KEEP, REVOICE, EDIT)
KEEPS_ITS_LENGTH = (MOVES, SWAP, REVOICE, EDIT)  # These follow a clip, so the new one runs as long as the old one.
NEEDS_NO_WORDS = (SWAP, KEEP)

TOKEN = re.compile(r"@(\d)\b")
MAIN = "@0"  # The main person, for lines the node writes itself.

BACKGROUND = "The background of {picture} is not kept."
NOTHING_IN = "Connect a picture or a video. H3 needs one to start from."
NEEDS_A_PERSON = {
    SWAP: "To swap the person, connect a picture of the new person and pick person for it.",
}
# A hat or a shirt with no person picture: the user wants the video's own person to wear it.
DRESS_THE_VIDEO_PERSON = 'To put this on the person in your video, pick the video job "change something" and type "He wears @1".'

SWAP_NEEDS_PERSON_THING = (
    'A swap needs a picture of the new person, and pick person for it. To show a thing in the clip, '
    'pick the video job "change something" and type "He holds @1".'
)
SWAP_NEEDS_PERSON_PLACE = (
    'A swap keeps the place of the video. Connect a picture of the new person and pick person for it. '
    'To change the place, pick the video job "change something" and type "It looks like @1".'
)
REVOICE_KEEPS_PERSON = (
    "New voice keeps the person in the clip, so a person picture can't change who is in it. "
    'Take the picture off, or pick the video job "swap the person".'
)
HE_SHE = re.compile(r"\b(?:he|she|they)\b", re.I)

# (what the label is, how it is kept). {picture} is H3's number for the picture.
JOB_WORDS = {
    PERFORMER: (
        "{subject} is the character in {picture}, with the same shape, colours and drawing style.",
        "fully_preserved - the shape, colours and drawing style are retained.",
    ),
    PERSON: (
        "{subject} is the person in {picture}, with the same face, hair and clothes.",
        "fully_preserved - the face, hair and clothes are retained.",
    ),
    SHEET: (
        "{subject} is the single character shown in the views of {picture}, with the same face, build, clothes and colours.",
        "attribute_transfer - the character moves into the target scene, and the views are identity evidence only.",
    ),
    PLACE: (
        "{subject} is the place in {picture}, with the same layout, light and colours. Any people in {picture} are not reused.",
        "fully_preserved - the place is retained.",
    ),
    OUTFIT: (
        "{subject} is the outfit in {picture}. Any person and the background of {picture} are not reused.",
        "attribute_transfer - put only this outfit on {wearer}.",
    ),
    THING: (
        "{subject} is the object in {picture}, with the same shape, colours and lettering.",
        "fully_preserved - the shape, colours and lettering are retained.",
    ),
    STYLE: (
        "{subject} is the visual style of {picture}. Its people and layout are not target content.",
        "attribute_transfer - apply its form, shading and colours to the target scene.",
    ),
    START: (
        "{subject} is the main subject in {picture}, with the same look.",
        "fully_preserved - the look is retained.",
    ),
}
DRESSED = (
    "{subject} is the person in {picture}, with the same face and hair.",
    "partially_preserved - the face and hair are retained, and the clothes change to {outfit}.",
)
REDRAWN = (
    "{subject} is the person in {picture}, {redraw}",
    "attribute_transfer - the hair colour, hairstyle and clothing carry over to the new look.",
)
FIRST_FRAME = "{picture} is the first frame of [Shot 1], in the exact pose and framing of the picture."
LAST_FRAME = "{picture} is the final frame of [Shot {last}], defining the final pose, camera angle, lighting and composition."
FIRST_KEPT = "{picture} ([Shot 1] first frame): fully_preserved - the opening framing, pose and light are retained."
LAST_KEPT = "{picture} ([Shot {last}] last frame): fully_preserved - the final framing, pose and light are retained."

MOVES_ARE = "{moves} is the body motion in <Video 1>: its moves, gestures and timing.\n<Video 1> provides the camera movement."
MOVES_KEPT = (
    "{moves} (appears in {shots}): attribute_transfer - apply only the body motion, choreography and timing to {main}; "
    "keep the source performer's face, body, clothes, props, background and colours out of the target.\n"
    "<Video 1>: attribute_transfer - apply only its camera movement to the target scene."
)
# Copy its moves with no person picture: the person in the video keeps their own moves and goes where the
# script or a place picture says.
OWN_MOVES_ARE = (
    "{main} is the person in <Video 1>, with the same face, hair, body{clothes} and the same moves, gestures and "
    "timing.\n<Video 1> provides the camera movement."
)
OWN_MOVES_KEPT = (
    "{main} (appears in {shots}): {kept}\n"
    "<Video 1>: attribute_transfer - apply its person, their moves and its camera movement to the target scene; {place}"
)
OWN_PLACE_FROM = "the background of <Video 1> is not kept, and the place is {place}."
OWN_PLACE_KEPT = "keep its place unless the script names a new one."
SWAP_VIDEO = "<Video 1> supplies the place, the action, the timing, the camera movement and the look."
SWAP_IS = "{replaced} is {who} in <Video 1>, selected for replacement."
SWAP_VIDEO_KEPT = (
    "<Video 1>: partially_preserved - keep the place, the action, the timing, the camera movement and the look; "
    "change only the {people}."
)
SWAP_KEPT = "{replaced}: removed - replace {who} with {main} throughout."
ONE_GOES = "the original person"
THE_PERSON = "the person in the shot"
APPEARANCE_LINE = re.compile(r'^\s*@([1-4])\s+looks like\s+([^"\n]+?)\s*$', re.I)
# Two ways people type a swap that used to be dropped without a word, so the swap ran with no description and H3
# often gave the clip back: the looks sentence on the same line as the swap sentence, and the clothes on a line of
# their own ("@1 is wearing a black suit").
LOOKS_MID_LINE = re.compile(r"(?<=\S)[ \t]*(?=@[1-4]\s+looks like\b)", re.I)
WEARS_LINE = re.compile(r'^\s*@([1-4])\s+(?:is\s+wearing|wears|is\s+dressed\s+in|has\s+on)\s+([^"@\n]+?)\s*$', re.I)
QUOTE = re.compile(r'["\u201c\u201d]')


def looks_on_own_lines(text):
    """The script with each @N looks like sentence on a line of its own. A spoken line is left alone."""
    text = str(text or "")
    lines = []
    for line in text.splitlines():
        if QUOTE.search(line) or not LOOKS_MID_LINE.search(line):
            lines.append(line)
            continue
        first, *rest = LOOKS_MID_LINE.sub("\n", line).splitlines()
        lines += [re.sub(r"\s+([.,;:])$", r"\1", first), *rest]
    return "\n".join(lines) if len(lines) != len(text.splitlines()) else text


# Hair and face only, no clothes, expression or background. When the line names clothes that differ from what the
# person in the clip wears, H3 tends to open on the picture's own backdrop before cutting to the clip.
DESCRIBE_PERSON = (
    "Describe only the hair and face of the person in this picture, in one short line for a video prompt: hair colour "
    "and style, and glasses, a beard or other face details you can see. No clothes, no expression, no background. "
    "Start with 'a man' or 'a woman'."
)


def add_looks(text, jobs, describe):
    """A swap's script with an @N looks like line for each new person who has none, written by describe(slot), a
    small picture-reading model shown that person's picture. Without such a line H3 kept the original person for the
    first seconds (2026-11-07), so a connected model writes it when the user didn't."""
    text = looks_on_own_lines(text)
    typed = {int(match.group(1)) for match in map(APPEARANCE_LINE.match, text.splitlines()) if match}
    for slot in sorted(jobs):
        if jobs[slot] not in (PERSON, SHEET) or slot in typed:
            continue
        words = next((line for line in str(describe(slot) or "").splitlines() if line.strip()), "")
        words = re.sub(r'["\u201c\u201d]', "", words).strip(" .,;:")
        words = re.sub(r"^(?:the\s+)?(?:person|subject)\s+(?:in\s+the\s+picture\s+)?(?:is|looks\s+like)\s+", "", words, flags=re.I)
        # "and no visible beard": naming what isn't there can put it in the picture.
        words = re.sub(r",?\s*(?:and\s+|with\s+)*(?:no|without)\s+(?:visible\s+)?[^,.;]*", "", words, flags=re.I).strip(" .,;:")
        if words:
            text = f"{text.rstrip()}\n@{slot} looks like {words[:1].lower() + words[1:]}"
    return text


def swap_appearances(text, jobs, video):
    """An optional separate @1 looks like line describes a replacement, not who goes.

    Other jobs and scripts without that exact line keep their original text.
    The number is the visible picture slot, not its compact H3 ordinal.
    """
    if video != SWAP:
        return text, {}
    kept, descriptions, clothes = [], {}, {}
    for line in looks_on_own_lines(text).splitlines():
        worn = WEARS_LINE.fullmatch(line)
        if worn and (jobs or {}).get(int(worn.group(1))) in (PERSON, SHEET):
            clothes.setdefault(int(worn.group(1)), []).append(worn.group(2).strip().rstrip(" ."))
            continue
        match = APPEARANCE_LINE.fullmatch(line)
        if match is None:
            kept.append(line)
            continue
        slot = int(match.group(1))
        if slot not in (jobs or {}):
            raise ValueError(f"Picture {slot} is not connected. Connect the new person's picture or remove its looks like line.")
        if jobs[slot] not in (PERSON, SHEET):
            raise ValueError(f"Picture {slot} must be a person or character sheet for a swap's looks like line.")
        if slot in descriptions:
            raise ValueError(f"Describe Picture {slot} once, in one looks like line.")
        # A sentence on the looks line that names an @ again ("The trees behind @1 stay the same.") is not how
        # the person looks: it goes back to the script as its own line, or H3 reads a raw @1 in the appearance.
        sentences = re.split(r"(?<=[.!?])\s+", match.group(2).strip())
        looks = [sentence for sentence in sentences if not TOKEN.search(sentence)]
        kept.extend(sentence for sentence in sentences if TOKEN.search(sentence))
        description = " ".join(looks).strip().rstrip(" .")
        if not description:
            raise ValueError(f"Say what Picture {slot}'s person looks like, or remove its looks like line.")
        descriptions[slot] = description
    for slot, worn in clothes.items():
        # Clothes typed on their own line join the description; with none typed, the picture still gives the hair.
        descriptions[slot] = f"{descriptions.get(slot, 'the same hair')}, wearing {' and '.join(worn)}"
    return ("\n".join(kept), descriptions) if descriptions else (text, {})


# Where each person stands when two or more go and the script doesn't say, from left to right like the pictures.
SPOTS = {2: ("left", "right"), 3: ("left", "centre", "right"), 4: ("far left", "left", "right", "far right")}
SAYS_WHO = re.compile(
    r"^(?:is|are|replaces|takes\s+the\s+place\s+of|goes\s+in\s+for|swaps?\s+(?:in\s+)?for|in\s+place\s+of|for|as)\b\s*"
    r"|^[:=\-\u2013\u2014>]+\s*",
    re.I,
)
# "he replaces the person at the counter": the words after one of these are who goes, wherever they stand in the line.
REPLACES = re.compile(
    r"\b(?:replaces|replacing|takes\s+the\s+place\s+of|taking\s+the\s+place\s+of|in\s+place\s+of|instead\s+of"
    r"|swaps?\s+(?:in\s+)?for|goes\s+in\s+for|stands?\s+in\s+for)\s+",
    re.I,
)
# A plain sentence: "Replace the man in red with @1", "swap the guy for @1", "make the dancer look like @1",
# "swap @1 in for the singer". The words caught are who goes.
ASKS = re.compile(
    r"^\s*(?:please\s+)?(?:replace|swap(?:\s+out)?|switch(?:\s+out)?|change|turn|make)\s+(?!@\d)(.+?)\s+"
    r"(?:with|for|to|into|by|look\s+like|become)\s+@\d\b"
    r"|^\s*(?:please\s+)?(?:swap|put|place|drop|switch)\s+@\d\s+(?:in\s+)?(?:with|for|over|on|onto|in\s+place\s+of)\s+(.+)",
    re.I,
)
# "the cashier is now @1", "the man on the left becomes @1".
BECOMES = re.compile(
    r"^\s*(.+?)\s+(?:is\s+now|becomes|turns\s+into|is\s+replaced\s+(?:by|with)|gets\s+replaced\s+(?:by|with)"
    r"|is\s+swapped\s+(?:for|with|to)|gets\s+swapped\s+(?:for|with)|->|\u2192)\s*@\d\b",
    re.I,
)
IN_THE_CLIP = re.compile(r"\s+(?:in|from|of)\s+the\s+(?:clip|video|original(?:\s+(?:clip|video))?)\b", re.I)
# "Elon is @1," names the new person, not the one who goes.
# "the man on the left, Dario is" ends where the next person's name starts.
NAMES_NEXT = re.compile(r",?\s*(?:[A-Z][\w'.-]*\s+)+(?:is|as|plays)\s*$")
NAMES_THE_NEW = re.compile(r"^[^@.;]*?\b(?:is|as|plays)\s+@\d\b[\s,.;]*", re.I)
SWAPPED = "attribute_transfer - apply the defined appearance to the original performance; the background of {picture} is not transferred."
# "keeps the outfit", "in the clip's clothes": the new person wears the clothes of the one who goes, not the picture's.
KEEP_CLOTHES = (
    r"\bkeep(?:s|ing)?\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:original\s+|same\s+)?(?:outfit|clothes|clothing)\b"
    r"(?:\s+(?:from|of|in)\s+the\s+(?:clip|video|original))?"
    r"|\b(?:in|wearing|wears)\s+the\s+(?:clip'?s|video'?s|original)\s+(?:outfit|clothes|clothing)\b"
    r"|\b(?:outfit|clothes|clothing)\s+(?:from|of)\s+the\s+(?:clip|video)\b"
)
CLIP_CLOTHES = re.compile(KEEP_CLOTHES, re.I)
CLIP_CLOTHES_CUT = re.compile(rf",?\s*(?:\band\s+)?(?:{KEEP_CLOTHES})", re.I)
CLOTHED_SWAP = "{subject} is the person in {picture}, with the same face and hair, wearing the clothes of {who} in <Video 1>."
CLOTHES_STAY = (
    "attribute_transfer - apply only the face and hair to the original performance; the clothes of {who} in <Video 1> "
    "stay as they are; the background of {picture} is not transferred."
)
KEEP_IS = "<Video 1> is the video being continued, and the target video starts from its last moment."
KEEP_MAIN = "{main} is the main subject in <Video 1>, with the same look."
KEEP_KEPT = "<Video 1> (continuation point): fully_preserved - the place, the light, the colours and the camera carry on from its last moment."
KEEP_KEPT_PLACE = "<Video 1> (continuation point): fully_preserved - the light, the colours and the camera carry on from its last moment."
KEEP_MAIN_KEPT = "{main} (appears in {shots}): fully_preserved - the look is retained."
SOUND_GOES_ON = "<Audio 1> is the soundtrack of <Video 1>, whose sound carries on in the target video."
SOUND_GOES_ON_KEPT = "<Audio 1>: reference - the sound continues without copying the source signal."
EDIT_VIDEO = "<Video 1> supplies {supplies}."
EDIT_IS = "{main} is the person in <Video 1>, kept as they are: the same face, hair, body and movements, with only what the script names changed."
EDIT_VIDEO_KEPT = "<Video 1>: partially_preserved - keep {supplies}; change only what the script names."
EDIT_KEPT = "{main} (appears in {shots}): fully_preserved - the face, hair and every movement are retained; only what the script names changes."
# What a source video gives an edit, less what a connected picture takes over.
EDIT_SUPPLIES = ("the place", "the person", "the action", "the timing", "the camera movement", "the look", "the sound")
# A line that is about someone. An edit or a move copy of a clip with nobody in it (an empty hallway) names nobody.
NAMES_SOMEONE = re.compile(
    r"@0|\b(?:he|she|him|her|his|hers|they|them|their|someone|somebody|anyone|everyone|person|people|man|men|woman|women|"
    r"guy|girl|boy|kid|child|baby|dancer|singer|actor|actress)\b",
    re.IGNORECASE,
)
REVOICE_IS = "<Video 1> is the source video for the target video edit.\n{main} is the person speaking in <Video 1>, with the same face, hair and clothing."
REVOICE_KEPT = (
    "<Video 1> (whole video): fully_preserved - every action, lip movement and camera move is retained.\n"
    "{main} (appears in {shots}): fully_preserved - the face, hair and clothing are retained."
)


# A line only names who goes when it is a noun phrase like "the child in the seat", not an action or a pronoun.
NOUN_PHRASE = re.compile(r"^(?:the|a|an|this|that|these|those|his|her|their|everyone|someone|somebody|both|each|all)\b", re.I)
ACTION_WORD = re.compile(
    r"\b(?:dances|walks|runs|talks|says|sits|stands|smiles|waves|jumps|enters|leaves|laughs|sings|eats|drinks|waits|"
    r"is\s+\w+ing|are\s+\w+ing)\b",
    re.I,
)


def who_goes_in(text):
    """Who a typed swap line says goes, without the rest of the line: "Elon is @1, he replaces the man at the
    counter" is the man at the counter, and so is "Replace the man at the counter with @1."."""
    replaces = REPLACES.search(text)
    plain = None if replaces else next((match for match in (ASKS.search(text), BECOMES.search(text)) if match), None)
    if replaces:
        text = text[replaces.end() :]
    elif plain:
        text = next(group for group in plain.groups() if group)
    else:
        text = NAMES_THE_NEW.sub("", text)
    text = IN_THE_CLIP.sub("", text)
    text = re.split(r"[.;!?]", text.strip(" .;!?"), maxsplit=1)[0]
    text = NAMES_NEXT.sub("", text)
    text = SAYS_WHO.sub("", TOKEN.sub("", text).strip(" .,;")).strip(" .,;")
    text = re.sub(r"\s+and$", "", text).strip(" .,;")
    if not (replaces or plain) and not (NOUN_PHRASE.match(text) and not ACTION_WORD.search(text)):
        return ""  # "@1 dances" or "He dances" says what happens, not who goes.
    return text


def lower_first(text):
    first = text.split(" ", 1)[0]
    return text if text[:1] == "<" or (len(first) > 1 and first.isupper()) else text[:1].lower() + text[1:]


def subject_label(number):
    return f"<Subject {number}>"


def picture_label(number):
    return f"<Picture {number}>"


def shot_list(numbers):
    return ", ".join(f"[Shot {number}]" for number in numbers)


@dataclass
class Picture:
    slot: int  # Its number on the node, and what follows @ in a script.
    job: str
    picture: int  # H3 counts only what is connected.
    subject: int = 0  # A picture that only marks the last frame has none.


def swapped_in(jobs):
    """How many people a swap puts in: one for each person or sheet picture."""
    return max(1, sum(job in ACTORS for job in jobs.values()))


# A thing a line holds, wears or uses stays a prop; any other thing named in a line is the one doing the action.
HELD = re.compile(
    r"\b(?:holds?|holding|carr(?:y|ies|ying)|wears?|wearing|puts? on|picks? up|uses?|using|grabs?|throws?|"
    r"eats?|drinks?|with)\s+(?:\w+\s+){0,2}@(\d)\b",
    re.IGNORECASE,
)


def things_that_perform(script, jobs, video):
    """A move copy or a swap with no person picture: a thing picture the lines make do the action (a cartoon hand
    waving, a toy dancing) takes the moves, or comes in for the one in the video. With nothing typed, a swap's thing
    comes in. A thing that is held or worn stays a thing."""
    if video not in (MOVES, SWAP) or any(job in (PERSON, SHEET) for job in (jobs or {}).values()):
        return jobs
    held = {int(slot) for slot in HELD.findall(script or "")}
    named = {int(slot) for slot in TOKEN.findall(script or "")}
    jobs = dict(jobs)
    for slot, job in jobs.items():
        if job == THING and slot not in held and (slot in named or (video == SWAP and not named)):
            jobs[slot] = PERFORMER
    return jobs


def number_pictures(jobs, video=""):
    """Connected pictures in order, from {number on the node: job}. In a swap
    the people being replaced come first, as <Subject 1>, <Subject 2> and on."""
    pictures = []
    subjects = swapped_in(jobs) if video == SWAP else 0
    for picture, slot in enumerate(sorted(jobs), 1):
        subjects += jobs[slot] != END
        pictures.append(Picture(slot, jobs[slot], picture, 0 if jobs[slot] == END else subjects))
    return pictures


class Cast:
    """The labels of one clip."""

    def __init__(self, pictures, video=""):
        self.pictures = pictures
        self.video = video
        last = max((picture.subject for picture in pictures), default=0)
        self.people = [picture for picture in pictures if picture.job in (*ACTORS, START)]
        self.moves = subject_label(last + 1) if video == MOVES else ""
        # Nobody to give the moves to: the person in the video keeps them and is the main person.
        self.own_moves = video == MOVES and not self.people
        self.video_person = True  # The video's own person is in the result; notice_people can say there is none.
        # In a swap each person or sheet picture takes one person's place in the video, in picture order. The script
        # can name who goes: "the child in the seat", or "@1 the man on the left. @2 the woman in red".
        self.swappers = [picture for picture in pictures if picture.job in ACTORS] if video == SWAP else []
        goes = len(self.swappers)
        self.whos = [f"the person on the {spot}" for spot in SPOTS[goes]] if goes > 1 else [ONE_GOES]
        self.replaced = subject_label(1) if video == SWAP else ""
        self.in_video = subject_label(last + 1) if video in (KEEP, REVOICE, EDIT) or self.own_moves else ""
        if video == KEEP and self.people:  # A person picture is the main person; the video adds no second subject.
            self.in_video = ""
        self.subjects = {picture.slot: subject_label(picture.subject) for picture in pictures if picture.subject}
        self.clip_clothes = False  # A swap that keeps the clothes of whoever goes.
        self.appearances = {}  # Explicit looks-like lines, by the visible replacement picture slot.
        self.clip_sound = False  # A swap whose finished clip keeps the video's own sound.
        self.speaks_as_video = False  # With that sound and no words typed: the new person says what the video says.
        self.typed_lines = False  # The script typed words in quotes for someone to say.

    def notice_people(self, text):
        """An edit or a move copy with no person picture keeps the video's person only when the lines are about
        someone, or something is put on them. A clip of an empty hallway gets no made-up person."""
        if self.video == KEEP:
            if not self.people and (text or "").strip():
                self.video_person = bool(NAMES_SOMEONE.search(text))
        elif self.video == EDIT or self.own_moves:
            self.video_person = bool(self.of(OUTFIT) or NAMES_SOMEONE.search(text or ""))

    @property
    def supplies(self):
        """What the source video of an edit still gives: a place picture brings the place and its look, a style
        picture the look."""
        gone = set()
        if self.of(PLACE):
            gone |= {"the place", "the look"}
        if self.of(STYLE):
            gone.add("the look")
        if not self.video_person:
            gone.add("the person")
        items = [item for item in EDIT_SUPPLIES if item not in gone]
        return ", ".join(items[:-1]) + " and " + items[-1]

    def of(self, *jobs):
        return [picture for picture in self.pictures if picture.job in jobs]

    @property
    def who(self):
        return self.whos[0]

    @who.setter
    def who(self, words):
        self.whos[0] = words

    @property
    def swaps(self):
        """(who goes, the words for them, who comes in) for each person a swap replaces."""
        coming = [subject_label(picture.subject) for picture in self.swappers] or [self.main]
        return [(subject_label(number), who, new) for number, (who, new) in enumerate(zip(self.whos, coming), 1)]

    def goes_for(self, picture):
        """Who a swapping picture's person replaces, in the words of the script."""
        new = subject_label(picture.subject)
        return next((who for _, who, coming in self.swaps if coming == new), self.who)

    def name_who_goes(self, lines):
        """Who each new person replaces, from the lines typed in a swap. With one, the words are who goes. With more,
        each @ names one, or else the lines go in picture order; anything else keeps left to right."""
        self.clip_clothes = any(CLIP_CLOTHES.search(line) for line in lines)
        lines = [CLIP_CLOTHES_CUT.sub("", line).strip() for line in lines]
        lines = [line for line in lines if line.strip(" .")]
        text = ". ".join(line.rstrip(" .") for line in lines)  # Each line ends where its who-goes words end.
        if len(self.whos) == 1:
            self.who = lower_first(who_goes_in(text) or ONE_GOES)
            return
        slots = [picture.slot for picture in self.swappers]
        pieces = re.split(r"@(\d)\b", text)
        named = {int(slot): words for slot, words in zip(pieces[1::2], pieces[2::2]) if int(slot) in slots}
        if not named:
            named = dict(zip(slots, lines)) if len(lines) == len(slots) else {}
        for index, slot in enumerate(slots):
            words = who_goes_in(named.get(slot, ""))
            if words:
                self.whos[index] = lower_first(words)

    @property
    def main(self):
        """Who a line is about when it names nobody."""
        if self.in_video and self.video_person:
            return self.in_video
        if self.people:
            return subject_label(self.people[0].subject)
        return next(iter(self.subjects.values()), subject_label(1))

    @property
    def main_in_shot(self):
        """Whether main is a person or thing the clip defines, so "<Subject N> is in the shot" can name it."""
        if self.in_video and self.video_person and self.main == self.in_video:
            return True
        defined = {subject_label(picture.subject) for picture in self.of(*ACTORS, THING, START)}
        return self.main in defined

    def unclear_speaker(self, moments):
        """A refusal when two or more people are connected and a spoken line does not say which one speaks."""
        if self.video not in ("", MOVES, KEEP) or len(self.people) < 2:
            return ""
        people = {picture.slot for picture in self.people}
        for moment in moments:
            if moment.speech and not moment.voice and not moment.voiceover:
                if not any(int(slot) in people for slot in TOKEN.findall(moment.text)):
                    count = "two people" if len(self.people) == 2 else "more than one person"
                    return f'With {count}, name who speaks: @{self.people[1].slot} says "hello".'
        return ""

    @property
    def opens(self):
        return next(iter(self.of(START)), None)

    @property
    def ends(self):
        return next(iter(self.of(END)), None)

    def labelled(self, text):
        return TOKEN.sub(lambda match: self.subjects.get(int(match.group(1)), self.main), text)

    def problem(self, text):
        """What is wrong with the @ numbers in a script, if anything."""
        if not self.pictures and not self.video:
            return NOTHING_IN
        if self.video in NEEDS_A_PERSON and not self.people:
            if self.of(OUTFIT):
                return DRESS_THE_VIDEO_PERSON
            if self.of(THING):
                return SWAP_NEEDS_PERSON_THING
            if self.of(PLACE):
                return SWAP_NEEDS_PERSON_PLACE
            return NEEDS_A_PERSON[self.video]
        if self.video == REVOICE and self.of(PERSON, SHEET):
            return REVOICE_KEEPS_PERSON
        typed = sorted({int(number) for number in TOKEN.findall(text)} - {0})
        slots = {picture.slot: picture for picture in self.pictures}
        for slot in typed:
            if slot not in slots:
                return f"@{slot} has no picture. Turn Picture {slot} on, or take @{slot} out of your script."
            if slots[slot].job == END:
                return f"Picture {slot} is where the clip ends, so @{slot} can't be in a line. Say what happens on the way there."
        if typed:
            for picture in self.of(*ACTORS, THING, OUTFIT):
                if picture.slot in typed:
                    continue
                # The only person picture is who "He" or "She" means.
                if picture.job in (PERSON, SHEET) and len(self.of(PERSON, SHEET)) == 1 and HE_SHE.search(text):
                    continue
                hint = f' Type who wears it, like "He wears @{picture.slot}."' if picture.job == OUTFIT else ""
                return f"Picture {picture.slot} is on, but no line names @{picture.slot}.{hint}"
        return ""

    def wearers(self, moments):
        """Who wears each outfit: the person named just before it, or else the main person."""
        found = {}
        outfits = {subject_label(picture.subject) for picture in self.of(OUTFIT)}
        default = THE_PERSON if self.main in outfits else self.main  # An outfit is never worn by itself.
        for picture in self.of(OUTFIT):
            found[picture.slot] = default
            token = f"@{picture.slot}"
            for moment in moments:
                before = moment.text.partition(token)[0]
                if token in moment.text:
                    named = [int(number) for number in TOKEN.findall(before)]
                    people = [slot for slot in named if slot in {person.slot for person in self.people}]
                    if people:
                        found[picture.slot] = self.subjects[people[-1]]
                    break
        return found

    def definitions(self, last, redraw, wearers):
        ends = self.ends
        lines = []
        if self.video == EDIT:
            lines.append(EDIT_VIDEO.format(supplies=self.supplies))
            if self.video_person:
                lines.append(EDIT_IS.format(main=self.in_video))
        if self.video == SWAP:
            lines.append(SWAP_VIDEO)
            lines += [SWAP_IS.format(replaced=gone, who=who) for gone, who, _ in self.swaps]
        worn = set(wearers.values())
        for picture in self.pictures:
            if picture.job == END:
                continue
            words = dict(subject=subject_label(picture.subject), picture=picture_label(picture.picture), redraw=redraw)
            if picture.job == START and ends:
                words["picture"] += f" and {picture_label(ends.picture)}"
            elif picture.job == PERSON and redraw:
                lines.append(REDRAWN[0].format(**words))
                continue
            elif self.clip_clothes and picture in self.swappers:
                lines.append(CLOTHED_SWAP.format(who=self.goes_for(picture), **words))
                continue
            elif picture in self.swappers and picture.slot in self.appearances:
                lines.append(
                    f'{words["subject"]} is the person in {words["picture"]}, with the same face and this appearance: '
                    f'{self.appearances[picture.slot]}. The background and lighting of {words["picture"]} are not transferred.'
                )
                continue
            elif picture.job == PERSON and words["subject"] in worn:
                lines.append(DRESSED[0].format(**words))
                continue
            lines.append(JOB_WORDS[picture.job][0].format(**words))
        if self.opens and ends:
            lines.append(FIRST_FRAME.format(picture=picture_label(self.opens.picture)))
        if ends:
            lines.append(LAST_FRAME.format(picture=picture_label(ends.picture), last=last))
        if self.own_moves and not self.video_person:
            lines.append("<Video 1> provides the camera movement.")
        elif self.own_moves:
            clothes = "" if self.of(OUTFIT) else " and clothes,"
            lines.append(OWN_MOVES_ARE.format(main=self.in_video, clothes=clothes or ","))
        elif self.moves:
            lines.append(MOVES_ARE.format(moves=self.moves))
        if self.video == KEEP:
            lines.append(KEEP_IS)
            if self.in_video and self.video_person:
                lines.append(KEEP_MAIN.format(main=self.in_video))
        if self.video == REVOICE:
            lines.append(REVOICE_IS.format(main=self.in_video))
        return "\n".join(lines)

    def kept(self, picture, redraw, wearers):
        """How one picture's subject is kept in the target video."""
        subject = subject_label(picture.subject)
        label = picture_label(picture.picture)
        wearing = [slot for slot, wearer in wearers.items() if wearer == subject]
        if self.video == SWAP and picture.job in ACTORS:
            if self.clip_clothes:
                return CLOTHES_STAY.format(who=self.goes_for(picture), picture=label)
            return SWAPPED.format(picture=label)
        if picture.job == PERSON and redraw:
            words = REDRAWN[1]
        elif picture.job == PERSON and wearing:
            words = DRESSED[1].format(outfit=self.subjects[wearing[0]])
        else:
            wearer = wearers.get(picture.slot, THE_PERSON if picture.job == OUTFIT else self.main)
            words = JOB_WORDS[picture.job][1].format(wearer=wearer)
        if picture.job in (*ACTORS, THING):
            words += " " + BACKGROUND.format(picture=label)
        return words

    def retention(self, shots, redraw, wearers):
        """One line for each label: shots holds the words of each shot, to see who is in it."""
        everywhere = list(range(1, len(shots) + 1))

        def seen(label):
            return [number for number, words in enumerate(shots, 1) if label in words] or everywhere[:1]

        lines = []
        if self.video == EDIT:
            lines.append(EDIT_VIDEO_KEPT.format(supplies=self.supplies))
            if self.video_person:
                lines.append(EDIT_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video))))
        if self.video == SWAP:
            lines.append(SWAP_VIDEO_KEPT.format(people="people" if len(self.swaps) > 1 else "person"))
            lines += [SWAP_KEPT.format(replaced=gone, who=who, main=new) for gone, who, new in self.swaps]
        for picture in self.pictures:
            if picture.job == END:
                continue
            label = subject_label(picture.subject)
            where = everywhere if picture.job == STYLE else seen(label)
            lines.append(f"{label} (appears in {shot_list(where)}): {self.kept(picture, redraw, wearers)}")
        if self.opens and self.ends:
            lines.append(FIRST_KEPT.format(picture=picture_label(self.opens.picture)))
        if self.ends:
            lines.append(LAST_KEPT.format(picture=picture_label(self.ends.picture), last=len(shots)))
        if self.own_moves and not self.video_person:
            places = [self.subjects[picture.slot] for picture in self.of(PLACE)]
            place = OWN_PLACE_FROM.format(place=places[0]) if places else OWN_PLACE_KEPT
            lines.append(f"<Video 1>: attribute_transfer - apply only its camera movement to the target scene; {place}")
        elif self.own_moves:
            outfits = [self.subjects[picture.slot] for picture in self.of(OUTFIT)]
            kept = (
                f"partially_preserved - the face, hair, body, moves and timing are retained, and the clothes change to {outfits[0]}."
                if outfits else "fully_preserved - the face, hair, body, clothes, moves and timing are retained."
            )
            places = [self.subjects[picture.slot] for picture in self.of(PLACE)]
            place = OWN_PLACE_FROM.format(place=places[0]) if places else OWN_PLACE_KEPT
            lines.append(OWN_MOVES_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video)), kept=kept, place=place))
        elif self.moves:
            lines.append(MOVES_KEPT.format(moves=self.moves, shots=shot_list(seen(self.main)), main=self.main))
        if self.video == KEEP:
            lines.append(KEEP_KEPT_PLACE if self.of(PLACE) else KEEP_KEPT)
            if self.in_video and self.video_person:
                lines.append(KEEP_MAIN_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video))))
        if self.video == REVOICE:
            lines.append(REVOICE_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video))))
        return "\n".join(lines)
