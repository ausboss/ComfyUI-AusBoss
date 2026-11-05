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

MOVES = "copy its moves"
SWAP = "swap the person"
KEEP = "keep going"
REVOICE = "new voice"
VIDEO_JOBS = (MOVES, SWAP, KEEP, REVOICE)
KEEPS_ITS_LENGTH = (SWAP, REVOICE)  # These change a clip, so the new one runs as long as the old one.
NEEDS_NO_WORDS = (SWAP, KEEP)

TOKEN = re.compile(r"@(\d)\b")
MAIN = "@0"  # The main person, for lines the node writes itself.

BACKGROUND = "The background of {picture} is not kept."
NOTHING_IN = "Connect a picture or a video. H3 needs one to start from."
NEEDS_A_PERSON = {
    MOVES: "To copy the moves, connect a picture of your person and pick person for it.",
    SWAP: "To swap the person, connect a picture of the new person and pick person for it.",
}

# (what the label is, how it is kept). {picture} is H3's number for the picture.
JOB_WORDS = {
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
SWAP_VIDEO = "<Video 1> supplies the place, the action, the timing, the camera movement and the look."
SWAP_IS = "{replaced} is {who} in <Video 1>, selected for replacement."
SWAP_VIDEO_KEPT = (
    "<Video 1>: partially_preserved - keep the place, the action, the timing, the camera movement and the look; "
    "change only the {people}."
)
SWAP_KEPT = "{replaced}: removed - replace {who} with {main} throughout."
ONE_GOES = "the original person"
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
KEEP_IS = (
    "<Video 1> is the video being continued, and the target video starts from its last moment.\n"
    "{main} is the main subject in <Video 1>, with the same look."
)
KEEP_KEPT = (
    "<Video 1> (continuation point): fully_preserved - the place, the light, the colours and the camera carry on from its last moment.\n"
    "{main} (appears in {shots}): fully_preserved - the look is retained."
)
SOUND_GOES_ON = "<Audio 1> is the soundtrack of <Video 1>, whose sound carries on in the target video."
SOUND_GOES_ON_KEPT = "<Audio 1>: reference - the sound continues without copying the source signal."
REVOICE_IS = "<Video 1> is the source video for the target video edit.\n{main} is the person speaking in <Video 1>, with the same face, hair and clothing."
REVOICE_KEPT = (
    "<Video 1> (whole video): fully_preserved - every action, lip movement and camera move is retained.\n"
    "{main} (appears in {shots}): fully_preserved - the face, hair and clothing are retained."
)


def who_goes_in(text):
    """Who a typed swap line says goes, without the rest of the line: "Elon is @1, he replaces the man at the
    counter" is the man at the counter."""
    replaces = REPLACES.search(text)
    text = text[replaces.end() :] if replaces else NAMES_THE_NEW.sub("", text)
    text = re.split(r"[.;!?]", text.strip(" .;!?"), maxsplit=1)[0]
    text = NAMES_NEXT.sub("", text)
    text = SAYS_WHO.sub("", TOKEN.sub("", text).strip(" .,;")).strip(" .,;")
    return re.sub(r"\s+and$", "", text).strip(" .,;")


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
    return max(1, sum(job in (PERSON, SHEET) for job in jobs.values()))


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
        self.moves = subject_label(last + 1) if video == MOVES else ""
        # In a swap each person or sheet picture takes one person's place in the video, in picture order. The script
        # can name who goes: "the child in the seat", or "@1 the man on the left. @2 the woman in red".
        self.swappers = [picture for picture in pictures if picture.job in (PERSON, SHEET)] if video == SWAP else []
        goes = len(self.swappers)
        self.whos = [f"the person on the {spot}" for spot in SPOTS[goes]] if goes > 1 else [ONE_GOES]
        self.replaced = subject_label(1) if video == SWAP else ""
        self.in_video = subject_label(last + 1) if video in (KEEP, REVOICE) else ""
        self.people = [picture for picture in pictures if picture.job in (PERSON, SHEET, START)]
        self.subjects = {picture.slot: subject_label(picture.subject) for picture in pictures if picture.subject}
        self.clip_clothes = False  # A swap that keeps the clothes of whoever goes.
        self.clip_sound = False  # A swap whose finished clip keeps the video's own sound.
        self.speaks_as_video = False  # With that sound and no words typed: the new person says what the video says.
        self.typed_lines = False  # The script typed words in quotes for someone to say.

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
        if self.in_video:
            return self.in_video
        if self.people:
            return subject_label(self.people[0].subject)
        return next(iter(self.subjects.values()), subject_label(1))

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
            return NEEDS_A_PERSON[self.video]
        typed = sorted({int(number) for number in TOKEN.findall(text)} - {0})
        slots = {picture.slot: picture for picture in self.pictures}
        for slot in typed:
            if slot not in slots:
                return f"@{slot} has no picture. Turn Picture {slot} on, or take @{slot} out of your script."
            if slots[slot].job == END:
                return f"Picture {slot} is where the clip ends, so @{slot} can't be in a line. Say what happens on the way there."
        if typed:
            for picture in self.of(PERSON, SHEET, THING, OUTFIT):
                if picture.slot not in typed:
                    return f"Picture {picture.slot} is on, but no line names @{picture.slot}."
        return ""

    def wearers(self, moments):
        """Who wears each outfit: the person named just before it, or else the main person."""
        found = {}
        for picture in self.of(OUTFIT):
            found[picture.slot] = self.main
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
            elif picture.job == PERSON and words["subject"] in worn:
                lines.append(DRESSED[0].format(**words))
                continue
            lines.append(JOB_WORDS[picture.job][0].format(**words))
        if self.opens and ends:
            lines.append(FIRST_FRAME.format(picture=picture_label(self.opens.picture)))
        if ends:
            lines.append(LAST_FRAME.format(picture=picture_label(ends.picture), last=last))
        if self.moves:
            lines.append(MOVES_ARE.format(moves=self.moves))
        if self.video == KEEP:
            lines.append(KEEP_IS.format(main=self.in_video))
        if self.video == REVOICE:
            lines.append(REVOICE_IS.format(main=self.in_video))
        return "\n".join(lines)

    def kept(self, picture, redraw, wearers):
        """How one picture's subject is kept in the target video."""
        subject = subject_label(picture.subject)
        label = picture_label(picture.picture)
        wearing = [slot for slot, wearer in wearers.items() if wearer == subject]
        if self.video == SWAP and picture.job in (PERSON, SHEET):
            if self.clip_clothes:
                return CLOTHES_STAY.format(who=self.goes_for(picture), picture=label)
            return SWAPPED.format(picture=label)
        if picture.job == PERSON and redraw:
            words = REDRAWN[1]
        elif picture.job == PERSON and wearing:
            words = DRESSED[1].format(outfit=self.subjects[wearing[0]])
        else:
            wearer = wearers.get(picture.slot, self.main)
            words = JOB_WORDS[picture.job][1].format(wearer=wearer)
        if picture.job in (PERSON, SHEET, THING):
            words += " " + BACKGROUND.format(picture=label)
        return words

    def retention(self, shots, redraw, wearers):
        """One line for each label: shots holds the words of each shot, to see who is in it."""
        everywhere = list(range(1, len(shots) + 1))

        def seen(label):
            return [number for number, words in enumerate(shots, 1) if label in words] or everywhere[:1]

        lines = []
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
        if self.moves:
            lines.append(MOVES_KEPT.format(moves=self.moves, shots=shot_list(seen(self.main)), main=self.main))
        if self.video == KEEP:
            lines.append(KEEP_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video))))
        if self.video == REVOICE:
            lines.append(REVOICE_KEPT.format(main=self.in_video, shots=shot_list(seen(self.in_video))))
        return "\n".join(lines)
