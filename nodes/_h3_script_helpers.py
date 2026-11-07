"""Reads a scene someone typed and writes it in MiniMax H3's six parts.

One line for each thing that happens, and a blank line to cut to a new place.
Every moment stays, in the order it was typed, and gets its own second. Code
does all of it, so nothing typed can be lost or moved around. Plain text, so
the tests run without a server.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from ._h3_cast_helpers import (
    EDIT,
    KEEP,
    MAIN,
    OUTFIT,
    PERSON,
    PLACE,
    REVOICE,
    SHEET,
    STYLE,
    SWAP,
    SOUND_GOES_ON,
    SOUND_GOES_ON_KEPT,
    THING,
    TOKEN,
    ONE_GOES,
    SPOTS,
    Cast,
    lower_first,
    number_pictures,
    picture_label,
    subject_label,
    swap_appearances,
)

QUOTES = {"“": '"', "”": '"', "‘": "'", "’": "'", "—": " - ", "–": " - ", "…": "..."}

# A word that starts a new moment inside a line. It goes, the order says it.
THEN = r"(?:,?\s*(?:and\s+)?then\b|,?\s*and\s+after\s+that\b|,?\s*after\s+that\b|,?\s*afterwards?\b|,\s*next\b|,\s*later\b|,?\s*moments?\s+later\b)"
# A word that starts a new moment and stays in it.
TURN = r"(?=,?\s*\b(?:suddenly|all\s+of\s+a\s+sudden|out\s+of\s+nowhere|finally|at\s+last|(?:hard\s+)?cut\s+to|(?:it\s+|and\s+|(?<!\bit\s))ends?\s+(?:with|on|in|as)|ending\s+(?:with|on|in))\b)"
# Where a line breaks into sentences: a full stop that is not a title, the end of a quote, or a semicolon.
SENTENCE = r"(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bSt\.)(?<!\bMrs\.)(?<=[.!?])\s+(?=\S)|(?<=\x00)\s+(?=[A-Z])|\s*;\s*"
CUT_WORDS = re.compile(r"^(?:hard\s+)?(?:cut|cuts|smash\s+cut|jump\s+cut)\s+to\b[:,]?\s*", re.I)
NEW_SHOT = re.compile(r"^(?:new\s+shot|next\s+shot|shot\s+\d+)\b[:,.\-]?\s*", re.I)
START = re.compile(r"^(?:it\s+|the\s+(?:clip|video|scene|shot)\s+)?(?:starts?|begins?|opens?)(?:\s+(?:with|on|in|at|as)\b[:,]?|\s*:)\s*", re.I)
END = re.compile(r"^(?:it\s+|the\s+(?:clip|video|scene|shot)\s+)?(?:ends?|ending|finish(?:es)?|closes?)(?:\s+(?:with|on|in|at|as)\b[:,]?|\s*:)\s*", re.I)
FINALLY = re.compile(r"^(?:finally|at\s+the\s+end|in\s+the\s+end)\b[:,]?\s*", re.I)
UNIT = r"(?:seconds?|secs?|s)\b"
TIMED = re.compile(
    r"^\[?(?:at\s+)?(?:(\d+):(\d\d(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:" + UNIT + r"|(?=-\s*\d)))"
    r"(?:\s*-\s*\d+(?:\.\d+)?\s*(?:" + UNIT + r")?)?\]?\s*[:,\-]?\s*",
    re.I,
)
NUMBER = re.compile(r"^\s*(?:\d+[.)](?!\d)|[-*•]|(?:first|second|third|fourth|fifth|sixth)(?:ly)?\b[:,]?|step\s+\d+[:.]?)\s*", re.I)
LABEL = re.compile(r"^(camera|style|look|sound|sounds|audio|music)\s*:\s*(.*)$", re.I)
SPEECH_CUE = re.compile(
    r"\b(?:says?|said|asks?|whispers?|shouts?|yells?|screams?|mutters?|sings?|raps?|chants?|announces?|calls?\s+out|cries"
    r"|replies|answers?|tells?\s+\w+|goes)\b[^\"]{0,24}$",
    re.I,
)
SIGN_CUE = re.compile(
    r"\b(?:title|titled|called|named|sign|signs|text|caption|card(?!\s+reader)|poster|reads?|saying|logo|banner|headline|words?)\b"
    r"[^\"]{0,24}$",
    re.I,
)
NO_MUSIC = re.compile(r"\b(?:no|without|skip)\s+(?:any\s+)?(?:music|soundtrack|score)\b|\bjust\s+(?:the\s+)?(?:ambien\w+|sound of|natural sound)\b", re.I)
NO_SOUND = re.compile(r"\b(?:no\s+sound|no\s+audio|silent\s+(?:film|movie|clip|video)|completely\s+silent|total\s+silence|mute(?:d)?\b)", re.I)
ONE_TAKE = re.compile(r"\b(?:one|single|continuous|unbroken)\s+(?:long\s+)?(?:shot|take)\b|\b(?:no|without)\s+cuts?\b", re.I)
SIDE_NOTE = re.compile(
    r"^\s*(?:(?:no|without)\s+(?:any\s+)?(?:music|soundtrack|score|sound|audio|cuts?)(?:\s*,?\s*(?:just|only)\s+(?P<only>.+?))?"
    r"|one\s+(?:long\s+)?(?:shot|take)|single\s+(?:shot|take)|continuous\s+(?:shot|take))\s*[.!]?\s*$",
    re.I,
)
VOICEOVER = re.compile(r"\b(?:voice-?\s?over|narrator|off-?\s?(?:screen|camera)|behind\s+the\s+camera|a\s+voice)\b|\((?:o\.?s|v\.?o)\.?\)", re.I)
# Where a voice comes from, said beside who it is: "A woman off screen says", "Mom (O.S.):".
FROM_OFF_SCREEN = re.compile(
    r"\b(?:(?:(?:in|as)\s+(?:an?\s+)?(?:off-?\s?screen\s+)?)?voice-?\s?over|off-?\s?(?:screen|camera)|behind\s+the\s+camera)\b|\((?:o\.?s|v\.?o)\.?\)", re.I
)
PRONOUN = re.compile(r"\b(?:he|she|they|him|her|them)\b", re.I)
PERSON_WORDS = re.compile(
    r"\b(?:man|men|woman|women|person|people|guy|girl|boy|kid|child|lady|gentleman|cashier|customer|clerk|waiter"
    r"|waitress|driver|worker|singer|rapper|dancer|host|friend|everyone|someone|somebody)\b",
    re.I,
)
# "says in a flat robot voice": how it is said, kept out of who says it.
SPEECH_VERB = re.compile(r"\b(?:says?|said|asks?|whispers?|shouts?|yells?|screams?|mutters?|sings?|raps?|chants?|announces?|calls?\s+out|cries|replies|answers?)\b", re.I)
SAID_BY = re.compile(r"^(?:(?:the|a|an)\s+[\w\s-]+|someone|somebody)$", re.I)
A_NAME = re.compile(r"^[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)?$")
UNSEEN = re.compile(r"\b(?:feels?|thinks?|remembers?|reali[sz]es?|decides?|wants?|hopes?|wonders?|knows?|understands?|believes?|imagines?)\b", re.I)
MOVING = re.compile(r"\b(?:pov|walks?|walking|runs?|running|forward|follows?|tracks?)\b", re.I)
FRAME_WORDS = re.compile(r"^(?:(?:an?|the)\s+(?:[\w-]+\s+){0,2}?(?:close-?up|wide|medium|shot|view|angle|overhead|profile|insert|aerial)\b|black\b)", re.I)

# What a small model is asked. It adds to a script; it never holds what was typed.
NEXT = (
    "This is a {seconds} second video.\nFirst this happens: {first}\n\n"
    "Write {count} short lines for what happens after that, in order, one thing per line. Each line follows from the one "
    "before, and in each line something clearly changes on screen. Write what is seen, in plain words, under twelve words "
    "a line. Stay in the same place. No speech. Nobody new unless asked. Write only the lines."
)
HEARD = (
    "This happens in a video:\n{lines}\n\nList the sounds you would hear there, the ones that never stop. Write one "
    "sentence of under fifteen words, like: Low hum of the fridges, faint traffic outside, a ticking clock."
)
LINE_WORDS = 18  # A longer line is the model telling a story, not naming a moment.
SOUND_WORDS = 22
NAMED = {PLACE: "the place", OUTFIT: "the outfit", THING: "the thing"}  # What @2 reads as to the small model.

WORDS_A_SECOND = 3  # How fast H3 speaks.
HOLD = f"{MAIN} holds still"  # What fills the time before a first moment set later.
KEEP_LOOK = "The target video keeps the look, the light and the colours of {picture}."
KEEP_COLOURS = "The target video keeps the colours and the film grain of {picture}."
OWN_COLOURS = "Each place keeps its own light and colours."
ONE_SHOT = "One continuous shot with no cuts."
EVERY_PLACE = "Every shot is a new place."
AND_THEN = "Then {line}"
STILL_MOVING = "the camera keeps moving forward."
QUIET = "{speaker} stays silent with the lips closed."
ONE_LINE = "No other words are spoken."
PLACE_SOUND = "The steady sound of the place continues throughout."
EACH_PLACE = "The sound of each place carries through its shot."
ROOM_TONE = "Quiet room tone continues throughout with faint fabric movement and soft breathing."
OLD_SOUND = "The sound of <Audio 1> continues throughout the target video."

OPENING = "{subject} is as in {picture}."
OPENS_ON = "The shot begins from {picture}."
ENDS_ON = "The shot ends on {picture}."
ON_SHEET = "{subject} appears once, without the panels, labels or other views of {picture}."
THE_MOVES = "{main} performs the same moves as {moves}, at the same timing."
IN_THE_PLACE = "The shot takes place in {place}."
WEARS = "{wearer} wears {outfit}."
IN_THE_SHOT = "{main} is in the shot."
TAKES_OVER = "{main} takes the place of {who} and does the same thing at the same pace."
ONE_PERSON = "Show one person throughout."
OTHERS_STAY = "Everyone else stays as they are in <Video 1>."
# With the clip's own sound, every voice in it is heard, so the new person's lips say only their own lines.
OWN_LINES_ONLY = "{main} keeps the lips closed whenever {main} is not saying a line of {main}'s own."
SAYS_NOTHING = "{main} keeps the lips closed and says nothing the whole time."
SPEAKS_AS_VIDEO = "{main} speaks as in <Video 1>, each word landing exactly on the lip movement of <Video 1>."
CLIP_SOUND = "The original sound of <Video 1> continues throughout."
FOLLOWS_CAMERA = "The camera follows the movement of <Video 1>."
SAME_AS_VIDEO = "{main} has the same words, mouth movements and moves as in <Video 1>. Everything else stays as it is in <Video 1>."
CARRIES_ON = "The shot carries straight on from the end of <Video 1>."
ACTION_GOES_ON = "The action keeps going the way it was heading, and the camera keeps moving the same way."
FACES_US = "{main} faces the camera as in <Video 1>."
VIDEO_LOOKS = {
    SWAP: "Retain the look of <Video 1>.",
    KEEP: "The target video keeps the look, colours and camera of <Video 1>.",
    REVOICE: "The target video keeps the look, light and camera of <Video 1>.",
    EDIT: "Retain the look of <Video 1>.",
}
NAMES_A_SPOT = re.compile(r"\b(?:left|right|behind|in\s+front|foreground|background)\b", re.I)
OPENS_ON_THEM = re.compile(r"^(?:She|He)\b")
FOLLOWS_A_COMMA = re.compile(r"^(?:A|An|The|She|He|They|It|Her|His|Their|Its|This|That|These|Those|There|Someone|Everyone|Nobody)\b")

# How someone asks for a camera, in the words H3 follows.
CAMERAS = {
    "handheld": "The camera is handheld and shakes slightly throughout.",
    "shaky": "The camera is handheld and shakes strongly throughout.",
    "walking pov": "The whole clip is a first-person POV shot that moves forward at fast speed and shakes strongly with every step.",
    "push in": "The camera pushes in on <Subject 1> at slow speed throughout.",
    "pull back": "The camera pulls back from <Subject 1> at slow speed throughout.",
    "orbit": "The camera arcs around <Subject 1> with large amplitude throughout.",
    "follow": "The camera tracks <Subject 1> from behind throughout.",
    "still": "The camera stays static throughout.",
}

# (the whole look, how the subject changes, what later shots repeat). A new
# subject line tells H3 to redraw the person, not to paint over a photo. Each
# shot is drawn on its own, so later shots say the look again.
LOOKS = {
    "anime": (
        "The target video is a 1990s Japanese television anime: hand-drawn cel animation, bold outlines, flat saturated "
        "colours, painted backgrounds and light film grain. Every frame is drawn, nothing is photographic.",
        "redrawn as a hand-drawn 1990s anime character with the same hair colour, hairstyle and clothing.",
        "Still hand-drawn anime, nothing photographic.",
    ),
    "watercolor": (
        "The target video is a hand-painted watercolour animation: soft washes of colour, wet edges, visible paper texture "
        "and loose brush lines. Every frame is painted, nothing is photographic.",
        "redrawn as a hand-painted watercolour character with the same hair colour, hairstyle and clothing.",
        "Still a hand-painted watercolour, nothing photographic.",
    ),
    "pencil sketch": (
        "The target video is a black pencil sketch on white paper: rough hand-drawn lines, shading by hatching and the "
        "paper showing through. Every frame is drawn, nothing is photographic.",
        "redrawn as a pencil sketch with the same hair colour, hairstyle and clothing.",
        "Still a black pencil sketch on white paper, nothing photographic.",
    ),
    "comic book": (
        "The target video is an American comic book come to life: thick black ink outlines, flat bold colours and halftone "
        "dots. Every frame is drawn, nothing is photographic.",
        "redrawn as a comic book character with the same hair colour, hairstyle and clothing.",
        "Still a comic book drawing, nothing photographic.",
    ),
}

# What a moment sounds like, said where it happens. H3 leaves a clip close to
# silent between big events unless each sound is named in its own moment.
MOMENT_SOUNDS = tuple(
    (re.compile(pattern, re.I), line)
    for pattern, line in (
        (r"\b(?:lights?|lamps?|bulbs?|neon)\b.*\b(?:flicker\w*|buzz\w*|go(?:es)?\s+(?:out|off|dark)|dim\w*)\b", "The lights buzz and crackle."),
        (r"\b(?:screens?|tvs?|televisions?|monitors?)\b.*\b(?:flicker\w*|static|glitch\w*|go(?:es)?\s+(?:black|dark|off)|turn\w*\s+(?:on|off|to))\b", "Static hisses and crackles."),
        (r"\b(?:thunder|lightning)\b", "Thunder cracks loudly."),
        (r"\b(?:rain|rainy|raining|downpour)\b", "Rain hisses on the ground."),
        (r"\b(?:wind|windy|gusts?|gale)\b", "The wind howls."),
        (r"\b(?:the|ocean|sea|big|huge|giant|crashing|breaking|rolling)\s+(?:\w+\s+)?waves\b|\bwaves\s+(?:crash|break|roll|pound|hit|rise|swell)\w*\b|\bsurf\b", "The water crashes and roars."),
        (r"\b(?:splash\w*|puddles?)\b", "Water splashes."),
        (r"\b(?:explo[ds]\w*|blasts?)\b", "A deep boom shakes the air."),
        (r"\b(?:fire|flames?|burns?|burning)\b", "Flames crackle and roar."),
        (r"(?<!a )\b(?:breaks?|breaking)\b(?!\s+(?:into|down|out|free|away|up|off|through))|\b(?:shatter\w*|smash\w*)\b", "Something shatters with a loud crack."),
        (r"\bdoors?\b.*\b(?:opens?|opening|closes?|closing|slams?|swings?|swung|shuts?)\b(?!-)|\b(?:opens?|opening|closes?|closing|slams?|shuts?)\b(?!-).*\bdoors?\b", "The door creaks and thuds."),
        (r"\b(?:engine|motorbike|motorcycle)\b|\b(?:car|truck)\b.*\b(?:speeds?|drives?|races?|pulls?\s+away)\b", "The engine roars."),
        (r"\btrains?\b", "The train rumbles on the rails."),
        (r"\bflash(?:es)?\b(?!\s+(?:a|her|his|their)\b)|\bshutter\b|\btakes? a (?:photo|picture)\b", "The camera shutter clicks loudly."),
        (r"\b(?:birds?|crows?)\b", "Wings flap."),
        (r"\b(?:runs?|running)\b(?!\s+(?:her|his|their|one|a)\b)|\b(?:sprints?|sprinting|flees?|fleeing)\b", "Fast footsteps hit the ground."),
        (r"\b(?:walks?|walking|strides?|striding)\b", "Footsteps sound on the ground."),
        (r"(?<!night )(?<!snow )(?<!hair )(?<!tears )(?<!silence )(?<!darkness )\b(?:falls?|falling)\b(?!\s+(?:asleep|silent|quiet|still|in\s+love))|\b(?:drops?|dropping|crash(?:es)?|collapses?|slams?)\b", "It lands with a heavy thud."),
    )
)
# What stays once it has happened: how it starts, what would change it, what to
# say as it happens, and the line that holds it. H3 draws each moment on its
# own, so the lights come back on in the next moment unless that moment says not.
LASTING = tuple(
    (re.compile(started, re.I), re.compile(topic, re.I), now, line)
    for started, topic, now, line in (
        (
            r"\blights?\b.*\b(?:go(?:es)?\s+(?:out|off|dark)|die|dies|cut\s+out)\b|\bblackout\b|\b(?:goes|go|went)\s+dark\b",
            r"\b(?:lights?|lamps?|bulbs?|dark\w*)\b",
            "The whole place goes dark.",
            "The lights stay off.",
        ),
        (r"\b(?:rain|raining|downpour)\b", r"\b(?:rain|raining)\b", "", "The rain keeps falling."),
        (r"(?<!static )(?<!tv )\bsnow(?:s|ing|fall|storms?)?\b", r"\bsnow", "", "The snow keeps falling."),
        (
            r"\b(?:screens?|tvs?|televisions?|monitors?)\b.*\b(?:go(?:es)?\s+(?:black|dark|off)|turn\w*\s+(?:black|off))\b",
            r"\b(?:screens?|tvs?|televisions?|monitors?)\b",
            "",
            "The screens stay dark.",
        ),
        (r"\bon\s+fire\b|\bcatch(?:es)?\s+fire\b|\bbursts?\s+into\s+flames\b", r"\b(?:fire|flames?)\b", "", "The fire keeps burning."),
    )
)
NAMES_A_SOUND = re.compile(r"\b(?:sounds?|hears?|heard|noises?|loud\w*|silen\w*|quiet\w*|rumbl\w*|bangs?|booms?|roars?|hiss\w*|creak\w*|buzz\w*|howl\w*)\b", re.I)


@dataclass
class Moment:
    text: str
    cut: bool = False  # A new shot starts here.
    at: float | None = None  # A second the person asked for.
    speech: str = ""
    voiceover: bool = False  # Heard, not seen saying it.
    start: bool = False  # The person said this is how it starts.
    end: bool = False  # The person said this is how it ends.
    camera: str = ""  # A camera: line typed in this shot's block.
    sound: str = ""  # A sound: line typed in this shot's block.
    line: int | None = None  # The typed line this moment opens, counted from 0.
    voice: str = ""  # Who says the words when it is nobody on screen: "The card reader".
    delivery: str = ""  # How a swap line is said: "in a flat robot voice".
    other: bool = False  # Said by someone who is in no picture, like the man at the counter.


@dataclass
class Script:
    moments: list = field(default_factory=list)
    camera: str = ""
    look: str = ""
    sound: str = ""
    music: str = ""  # "N/A" is no music.
    silent: bool = False
    one_take: bool = False


def clean(text):
    for old, new in QUOTES.items():
        text = text.replace(old, new)
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def mask_quotes(line):
    """Hides quoted words so a full stop inside them can't split a moment."""
    found = []

    def hide(match):
        found.append(match.group(0))
        return f"\x00{len(found) - 1}\x00"

    return re.sub(r'"[^"\n]*"', hide, line), found


def unmask(text, found):
    return re.sub(r"\x00(\d+)\x00", lambda match: found[int(match.group(1))], text)


def split_line(line):
    """One typed line as its moments, in order."""
    masked, found = mask_quotes(line)
    pieces = []
    for part in re.split(SENTENCE, masked):
        for bit in re.split(THEN + r"\s+|" + TURN, part, flags=re.I):
            bit = re.sub(r"[\s,;]*\band$", "", bit, flags=re.I)
            if bit and bit.strip(" ,.;"):
                pieces.append(unmask(bit.strip(" ,;"), found))
    return pieces


def take_label(line, script):
    """camera: look: sound: music: lines go to their own part."""
    match = LABEL.match(line)
    if not match:
        return False
    name, value = match.group(1).lower(), match.group(2).strip()
    if name == "camera":
        script.camera = value
    elif name in ("style", "look"):
        script.look = value
    elif name in ("sound", "sounds", "audio"):
        script.sound = value
    else:
        script.music = "N/A" if value.lower().rstrip(".") in ("none", "no", "n/a", "off") else value
    return True


def read_notes(text, script):
    if NO_SOUND.search(text):
        script.silent = True
    if NO_MUSIC.search(text):
        script.music = "N/A"
    if ONE_TAKE.search(text):
        script.one_take = True


def voice_of(before, voiceover, things=False):
    """Who says a line from off screen, named by the words in front of it:
    "A woman off screen says" is a woman and "a card reader off screen says"
    a card reader. With things, a thing needs no "off screen": "The card
    reader beeps and says" is the card reader. An @, a he or she, or no name
    at all is someone on screen or the main person's own voiceover, so that
    gives ""."""
    if TOKEN.search(before) or PRONOUN.search(before):
        return ""
    verb = SPEECH_VERB.search(before)
    action = FROM_OFF_SCREEN.sub("", before[: verb.start()] if verb else before)
    action = re.sub(r"[\s,]*\band\s*$", "", action.strip(" ,:")).split(",")[0].strip(" ,:")
    if len(action.split()) > 2 and action.endswith("s"):  # "The card reader beeps": what it does goes.
        action = action.rsplit(" ", 1)[0]
    # "Narrator" and "a voice" name no one, so they stay the main person's voiceover.
    if voiceover and (A_NAME.match(action) or SAID_BY.match(action)) and not VOICEOVER.search(action):
        return action
    if things and SAID_BY.match(action) and not PERSON_WORDS.search(action):
        return action
    return ""


def quoted_words(moment):
    """Quoted words after a sign word stay on screen, as does a bare ALL CAPS
    quote. Any other quote is words someone says."""
    match = re.search(r'"([^"\n]+)"', moment.text)
    if not match:
        return
    before = moment.text[: match.start()]
    words = match.group(1).strip()
    if not (SIGN_CUE.search(before) or (words.isupper() and not SPEECH_CUE.search(before))):
        moment.speech = words
        moment.voiceover = VOICEOVER.search(before) is not None
        moment.voice = voice_of(before, moment.voiceover)


def read_moment(moment):
    text = moment.text
    timed = TIMED.match(text)
    if timed:
        if timed.group(1) is not None:
            moment.at = int(timed.group(1)) * 60 + float(timed.group(2))
        else:
            moment.at = float(timed.group(3))
        text = text[timed.end() :]
    cut = CUT_WORDS.match(text) or NEW_SHOT.match(text)
    if cut:
        moment.cut = True
        text = text[cut.end() :]
    start = START.match(text)
    end = END.match(text) or FINALLY.match(text)
    if start and len(text[start.end() :].split()) > 1:
        moment.start = True
        text = text[start.end() :]
    elif end and len(text[end.end() :].split()) > 1:
        moment.end = True
        text = text[end.end() :]
    text = re.sub(r"\s+", " ", text).strip(" ,.")
    moment.text = text[:1].upper() + text[1:] if text else ""
    quoted_words(moment)


def put_in_order(script):
    """An opening or an ending goes first or last, wherever it was typed. Lines
    that all name their second play by the second."""
    moments = script.moments
    if moments and all(moment.at is not None for moment in moments):
        moments.sort(key=lambda moment: moment.at)
    starts = [moment for moment in moments if moment.start]
    ends = [moment for moment in moments if moment.end]
    rest = [moment for moment in moments if not moment.start and not moment.end]
    moments[:] = starts + rest + ends
    if moments:
        if moments[0].at:
            moments.insert(0, Moment(HOLD, at=0.0))
        moments[0].cut = False


def read_script(text):
    """Whatever was typed, as a Script. A blank line or "cut to" starts a new
    shot. camera: and sound: lines belong to the shot they are typed in; on
    their own, or in a clip of one shot, they are for the whole clip."""
    script = Script()
    raw_text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = clean(text)
    # Where the cleaned text starts among the typed lines, so each moment can
    # name its line for the timeline.
    first_line = raw_text[: len(raw_text) - len(raw_text.lstrip())].count("\n")
    found = 0
    for number, block in enumerate(re.split(r"\n\s*\n", text)):
        found = max(text.find(block, found), found)
        block_line = first_line + text.count("\n", 0, found)
        found += len(block)
        after_gap = number > 0
        count = len(script.moments)
        whole_clip = script.camera, script.sound
        script.camera = script.sound = ""
        for offset, raw in enumerate(block.split("\n")):
            line = raw.strip()
            if not line or take_label(line, script):
                continue
            opens = block_line + offset
            for piece in split_line(NUMBER.sub("", line).strip()):
                note = SIDE_NOTE.match(piece)
                if note:  # "no music, just rain" on its own is a note, not a moment.
                    read_notes(piece, script)
                    if note.group("only"):
                        script.sound = note.group("only").strip(" .")
                    continue
                moment = Moment(piece, cut=after_gap, line=opens)
                opens = None
                after_gap = False
                read_moment(moment)
                if moment.text:
                    script.moments.append(moment)
        typed = script.camera, script.sound
        script.camera, script.sound = whole_clip
        if len(script.moments) > count:
            script.moments[count].camera, script.moments[count].sound = typed
        else:
            script.camera, script.sound = typed[0] or script.camera, typed[1] or script.sound
    read_notes(text, script)
    put_in_order(script)
    if script.one_take or not any(moment.cut for moment in script.moments):
        for moment in script.moments:
            script.camera, script.sound = moment.camera or script.camera, moment.sound or script.sound
            moment.camera = moment.sound = ""
    return script


def most_moments(seconds):
    """H3 plays about one clear moment a second."""
    return max(3, int(seconds))


def timeline(script, seconds):
    """When each moment starts. A second someone asked for stays; the others
    share what is left, one after the other."""
    moments = script.moments
    if not moments:
        return []
    starts = [moment.at for moment in moments]
    starts[0] = starts[0] or 0.0
    index = 1
    while index < len(starts):
        if starts[index] is not None:
            starts[index] = max(starts[index], starts[index - 1])
            index += 1
            continue
        after = index
        while after < len(starts) and starts[after] is None:
            after += 1
        last = starts[after] if after < len(starts) else seconds
        step = max(last - starts[index - 1], 0.0) / (after - index + 1)
        for place in range(index, after):
            starts[place] = starts[place - 1] + step
        index = after
    return [round(min(start, seconds), 3) for start in starts]


def moments_for(seconds):
    """How many moments a one-line idea grows to: one for about each 2.5 seconds."""
    return max(2, round(seconds / 2.5))


def answer_lines(answer):
    """The lines of a model's answer, without numbers or bullets."""
    lines = (NUMBER.sub("", line).strip() for line in str(answer).split("\n"))
    return [line for line in lines if line]


def bare(line):
    return line.strip(" ,.!?").lower()


def usable_line(line, kept):
    words = line.split()
    return 1 < len(words) <= LINE_WORDS and not set(line) & set('"<>[]{}') and all(bare(line) != bare(other) for other in kept)


def plain_names(text, jobs):
    """The line with each @ swapped for what that picture is."""
    return TOKEN.sub(lambda match: NAMED.get((jobs or {}).get(int(match.group(1))), "the person"), text)


def add_moments(script, seconds, ask, jobs=None):
    """One typed line in a clip with time to spare: a small model adds what
    happens next. The typed line stays first, and a line that fails the check
    is left out, so a bad answer costs nothing."""
    if len(script.moments) != 1 or script.moments[0].speech:
        return
    wanted = moments_for(seconds) - 1
    first = plain_names(script.moments[0].text, jobs)
    kept = [first]
    for line in answer_lines(ask(NEXT.format(seconds=seconds, first=first, count=wanted), 256)):
        if len(kept) <= wanted and usable_line(line, kept):
            kept.append(line)
            script.moments.append(Moment(line.strip(" ,.")))


def add_sound(script, ask, jobs=None):
    """What this place sounds like, unless someone said."""
    if script.sound or script.silent:
        return
    lines = "\n".join(plain_names(moment.text, jobs) for moment in script.moments)
    answer = " ".join(answer_lines(ask(HEARD.format(lines=lines), 64)))
    if 1 < len(answer.split()) <= SOUND_WORDS and not set(answer) & set('"<>[]{}'):
        script.sound = answer


def script_warning(script, seconds, cast=None):
    """What to tell someone before they spend a run on this."""
    problem = cast.problem(" ".join(moment.text for moment in script.moments)) if cast else ""
    if problem:
        return problem
    count = len(script.moments)
    if count > most_moments(seconds):
        return f"{count} moments in {seconds:g} seconds. H3 plays about one a second, so some may be skipped."
    if any((moment.at or 0.0) >= seconds for moment in script.moments):
        return f"A moment starts after the clip ends, at {seconds:g} seconds."
    starts = timeline(script, seconds)
    for moment, start, end in zip(script.moments, starts, [*starts[1:], seconds]):
        unseen = UNSEEN.search(without_speech(moment))
        if unseen:
            return f'A camera can\'t see "{unseen.group(0).lower()}". Say what we would see, like "she smiles".'
        takes = len(moment.speech.split()) / WORDS_A_SECOND
        if takes > end - start + 0.5:
            return f"A spoken line takes about {takes:.0f} seconds to say, and its moment has {end - start:.0f}. Give it more room."
    return ""


def script_report(text, seconds, jobs=None, video=""):
    """What a script will do, for the timeline on the node."""
    # The optional swap description is not a second timed action.
    text, _ = swap_appearances(text, jobs, video)
    script = read_script(text)
    starts = timeline(script, seconds)
    ends = [*starts[1:], seconds]
    moments = [
        {
            "start": start,
            "end": end,
            "text": moment.text.replace(HOLD, "Holds still"),
            "cut": moment.cut,
            "speech": bool(moment.speech),
            "line": moment.line,
        }
        for moment, start, end in zip(script.moments, starts, ends)
    ]
    cast = Cast(number_pictures(jobs, video), video) if jobs is not None else None
    return {"moments": moments, "seconds": seconds, "warning": script_warning(script, seconds, cast)}


def stamp(seconds):
    minutes, rest = divmod(seconds, 60)
    return f"{int(minutes):02d}:{rest:06.3f}"




def after_comma(text):
    """A sentence carried on after "At 00:03.000,". Names keep their capital."""
    return text[:1].lower() + text[1:] if FOLLOWS_A_COMMA.match(text) else text


def sentence(text):
    text = text.strip()
    return text if text[-1:] in '.!?"' else text + "."


def capital(text):
    return sentence(text[:1].upper() + text[1:])


def without_speech(moment):
    """A moment's words with what is said taken out, and what says it."""
    if not moment.speech:
        return moment.text
    before, _, after = moment.text.partition(f'"{moment.speech}"')
    spoken = SPEECH_CUE.search(before)
    if spoken:
        # "She looks up and says" keeps "She looks up". In "She says" the words
        # in front only name who speaks.
        action = before[: spoken.start()].rstrip()
        linked = re.search(r",?\s*\band(?:\s+\w+ly)?$", action, re.I)
        before = action[: linked.start()] if linked else action.rpartition(",")[0]
    if VOICEOVER.search(before):
        before = ""
    return " ".join(part.strip(" ,:") for part in (before, after) if part.strip(" ,:."))


def moment_words(moment, say, cast):
    words = with_labels(without_speech(moment), cast)
    if moment.start:
        words = "The shot opens on " + lower_first(words)
    elif moment.end:
        words = "The shot ends on " + lower_first(words)
    line = sentence(words) if words else ""
    if moment.speech:
        line = f"{line} {say(moment.speech, not moment.voiceover)}".strip()
    return line


def moment_sound(moment, script):
    """The sound of a moment, unless its words or the sound of the place already say it."""
    words = without_speech(moment)
    if NAMES_A_SOUND.search(words):
        return ""
    for pattern, line in MOMENT_SOUNDS:
        if pattern.search(words):
            return "" if pattern.search(script.sound) else line
    return ""


def still_true(moments):
    """For each moment, the lines that hold what earlier moments changed. A
    moment that speaks of the same thing again decides for itself, and a new
    place starts clean."""
    held, found = {}, []
    for moment in moments:
        seen = without_speech(moment)
        if moment.cut and not FRAME_WORDS.match(seen):
            held = {}
        lines = [line for topic, line in held.items() if not topic.search(seen)]
        for started, topic, now, line in LASTING:
            if started.search(seen):
                held[topic] = line
                lines += [now] if now else []
        found.append(lines)
    return found


def speaker_of(moment, cast):
    """Who says a moment's words: an off-screen voice, the first person it names, or the main person."""
    if moment.voice:
        return moment.voice
    people = {picture.slot for picture in cast.people}
    for slot in TOKEN.findall(moment.text):
        if int(slot) in people:
            return cast.subjects[int(slot)]
    return cast.main


def speakers(moments, cast):
    """Everyone who speaks, in the order H3 numbers them."""
    found = []
    for moment in moments:
        who = speaker_of(moment, cast)
        if moment.speech and who not in found:
            found.append(who)
    # A voice from off screen, like a card reader, comes after the people, who keep the low numbers.
    return [who for who in found if who.startswith("<")] + [who for who in found if not who.startswith("<")]


def with_labels(words, cast):
    """@1 in H3's label. A line that opens on She or He is the one person, when
    there is one."""
    if len(cast.people) == 1 or cast.in_video:
        words = OPENS_ON_THEM.sub(MAIN, words)
    return cast.labelled(words)


def shots_of(script):
    """The moments of each shot, as positions. Only a real cut starts a new one."""
    shots = []
    for index, moment in enumerate(script.moments):
        if not shots or (moment.cut and not script.one_take):
            shots.append([])
        shots[-1].append(index)
    return shots


def people_in(text, cast):
    """Who a shot's words name. A shot that names nobody has everyone, as in "they sit down"."""
    named = [cast.subjects[picture.slot] for picture in cast.people if cast.subjects[picture.slot] in text]
    if named or any(label in text for label in cast.subjects.values()):
        return named
    return [cast.subjects[picture.slot] for picture in cast.people]


def before_the_action(number, text, cast, wearers):
    """What H3 needs to hear about a shot before anything happens in it."""
    notes = []
    opens = cast.opens
    if number == 1 and opens:
        words = OPENS_ON if cast.ends else OPENING
        notes.append(words.format(subject=subject_label(opens.subject), picture=picture_label(opens.picture)))
    if cast.video == SWAP:
        for _, who, new in cast.swaps:
            picture = next((p for p in cast.swappers if subject_label(p.subject) == new), None)
            appearance = cast.appearances.get(picture.slot) if picture else None
            if picture:
                # Every swap gets the firm wording. Without it H3 kept the original person for the first seconds,
                # or for the whole clip at Fast preview; with it the new
                # person is there from the first frame. An @1 looks like line only adds its own words.
                looks = (f"has the defined appearance from {picture_label(picture.picture)}: {appearance}" if appearance
                         else f"has the face, hair and clothes of the person in {picture_label(picture.picture)}")
                notes.append(
                    f"{new} occupies the starting position of {who} and follows the same route, movements, timing and pace. "
                    f"{new} {looks}. "
                    f"The replacement stays present throughout, from the first frame, ending at the original performance's final position. "
                    f"Do not show {who} in that role at any time; there is no transition or morph into the replacement."
                )
            else:
                notes.append(TAKES_OVER.format(main=new, who=who))
        notes.append(ONE_PERSON if cast.whos == [ONE_GOES] else OTHERS_STAY)
        for _, _, new in cast.swaps if cast.clip_sound else []:
            if cast.speaks_as_video:
                notes.append(SPEAKS_AS_VIDEO.format(main=new))
            elif cast.typed_lines:
                notes.append((OWN_LINES_ONLY if f"{new} (S" in text else SAYS_NOTHING).format(main=new))
    if number == 1 and cast.video == KEEP:
        notes += [CARRIES_ON]
    if number == 1 and cast.video == REVOICE:
        notes += [FACES_US.format(main=cast.main)]
    places = [subject_label(picture.subject) for picture in cast.of(PLACE)]
    if places and not any(place in text for place in places):
        notes.append(IN_THE_PLACE.format(place=places[0]))
    people = people_in(text, cast)
    if len(people) > 1 and not NAMES_A_SPOT.search(text) and cast.video != SWAP:  # A swap's people stand where the video has them.
        spots = [f"{person} is on the {spot}" for person, spot in zip(people, SPOTS[len(people)])]
        notes.append(sentence(", ".join(spots[:-1]) + f" and {spots[-1]} of the frame"))
    for slot, wearer in wearers.items():
        outfit = cast.subjects[slot]
        if outfit not in text and (wearer in people or wearer in text):
            notes.append(WEARS.format(wearer=wearer, outfit=outfit))
    return notes


def after_the_action(text, cast):
    """What H3 needs to hear about a shot once its action has been said."""
    notes = []
    if cast.moves and cast.main in text:
        notes.append(THE_MOVES.format(main=cast.main, moves=cast.moves))
    if cast.video == EDIT:
        notes.append(SAME_AS_VIDEO.format(main=cast.main))
    if cast.video in (SWAP, EDIT):
        notes.append(FOLLOWS_CAMERA)
    for picture in cast.of(SHEET):
        subject = subject_label(picture.subject)
        if subject in text or len(cast.people) == 1:
            notes.append(ON_SHEET.format(subject=subject, picture=picture_label(picture.picture)))
    return notes


def cut_to(words, text, cast):
    """How a later shot opens, and what is left of its first moment to say."""
    if FRAME_WORDS.match(words):
        return f"the camera cuts to {lower_first(words)}", ""
    places = [subject_label(picture.subject) for picture in cast.of(PLACE)]
    named = next((place for place in places if place in text), None)
    if named:
        return f"the camera cuts to {named}.", words
    return f"the camera cuts to {'a new view' if places else 'a new place'}.", words


def shot_lines(script, seconds, say, cast, wearers, move="", hold="", sounds=True):
    """One line for each shot. H3 jumps at a timed [Shot] mark whatever the words
    say, so the moments of one take are sentences inside one shot."""
    starts = timeline(script, seconds)
    talking = speakers(script.moments, cast)
    quiet = " ".join(QUIET.format(speaker=speaker) for speaker in talking if speaker.startswith("<"))
    kept = still_true(script.moments)
    lines = []
    for number, shot in enumerate(shots_of(script), 1):
        shot_camera = script.moments[shot[0]].camera
        shot_camera = CAMERAS.get(shot_camera.lower().strip(), shot_camera and sentence(shot_camera)).replace("<Subject 1>", cast.main)
        moving = MOVING.search(shot_camera or move)
        said = []
        for index in shot:
            moment = script.moments[index]

            def speak(words, on_screen=True, moment=moment):
                who = speaker_of(moment, cast)
                if moment.delivery:
                    return say(words, on_screen, who, talking.index(who) + 1, delivery=moment.delivery)
                return say(words, on_screen, who, talking.index(who) + 1)

            words = " ".join(
                [
                    moment_words(moment, speak, cast),
                    *kept[index],
                    *([quiet] if quiet and not moment.speech else []),
                ]
            ).strip()
            if sounds and not script.silent:
                words = f"{words} {moment_sound(moment, script)}".strip()
            said.append(words)
        text = " ".join(said)
        first = shot[0]
        head, said[0] = (cut_to(said[0], text, cast) if number > 1 else ("", said[0]))
        if not head and starts[first] > 0:  # A swap's first words can start late in the video.
            said[0] = f"At {stamp(starts[first])}, {after_comma(said[0])}"
        for place, index in enumerate(shot[1:], 1):
            lead = f"{STILL_MOVING} " if moving else ""
            said[place] = f"At {stamp(starts[index])}, {lead}{after_comma(said[place])}"
        body = [
            f"At {stamp(starts[first])}, {head}" if head else "",
            *before_the_action(number, text, cast, wearers),
            shot_camera,
            *said,
            *after_the_action(text, cast),
            *([hold] if number > 1 else []),
            capital(script.moments[first].sound) if script.moments[first].sound and not script.silent else "",
        ]
        lines.append(f"[Shot {number}] " + " ".join(part for part in body if part))
    if not any(cast.main in line for line in lines):
        lines[0] = lines[0].replace("[Shot 1] ", f"[Shot 1] {IN_THE_SHOT.format(main=cast.main)} ", 1)
    return lines


def script_sound(script, sound, places=False):
    """The two sound parts. Words in the script win over the pick."""
    if script.silent or sound == "none":
        return "N/A", "N/A"
    typed = capital(script.sound) if script.sound else (EACH_PLACE if places else PLACE_SOUND)
    return typed, capital(script.music) if script.music not in ("", "N/A") else "N/A"


def task_of(cast):
    """The tag a summary opens with."""
    if cast.video in (SWAP, REVOICE, EDIT):
        return "video editing"
    if cast.video == KEEP:
        return "video continuation"
    if cast.opens and cast.ends:
        return "keyframe completion"
    return "reference generation + keyframe completion" if cast.ends else "reference generation"


def summary_of(script, cast, new_places, soundtrack):
    task = task_of(cast)
    if cast.video == SWAP:
        swaps = " and ".join(f"{gone} with {new}" for gone, _, new in cast.swaps)
        return f"[{task}] Replace {swaps} while preserving the original action, place, camera and look of <Video 1>."
    if cast.video == REVOICE:
        return (
            f"[{task}] The target video is an edited version of <Video 1>. The picture, the timing and the lip movement "
            f"stay as they are, and {cast.main} speaks in a new voice."
        )
    if cast.video == EDIT:
        changes = " ".join(sentence(with_labels(without_speech(moment), cast)) for moment in script.moments)
        return f"[{task}] {changes} Everything else in <Video 1> is kept."
    if cast.video == KEEP:
        tag = f"{task} + audio reference" if soundtrack else task
        return f"[{tag}] The target video continues directly from the end of <Video 1> in the same place."
    opening = with_labels(without_speech(script.moments[0]), cast) or f"{cast.main} speaks"
    later = [with_labels(without_speech(script.moments[shot[0]]), cast) for shot in shots_of(script)[1:]]
    if cast.opens and cast.ends:
        moving = f"moving from {picture_label(cast.opens.picture)} to {picture_label(cast.ends.picture)}"
        return f"[{task}] In the target video, {lower_first(opening.rstrip('.!? '))}, {moving}."
    summary = f"[{task}] In the target video, {lower_first(sentence(opening))}"
    summary += "".join(f" {AND_THEN.format(line=lower_first(sentence(line)))}" for line in later if line)
    if cast.moves:
        summary += " " + THE_MOVES.format(main=cast.main, moves=cast.moves)
    return f"{summary} {EVERY_PLACE}" if new_places else summary


def script_parts(script, seconds, camera="", look="", sound="", say=None, cast=None, sounds=True, soundtrack=False):
    """H3's six parts, from a Script. say turns spoken words into H3's line.
    cast says what each picture and the video are for. sounds says H3 makes
    the sound, so each moment names its own. soundtrack says a video's own
    sound is connected."""
    say = say or (lambda words, on_screen=True, speaker="", number=1: words)
    cast = cast or Cast(number_pictures({1: PERSON}))
    style, redraw, hold = LOOKS.get(look, ("", "", ""))
    if script.look:
        style, redraw, hold = LOOKS.get(script.look.lower().strip(), (sentence(script.look), "", ""))
    for picture in cast.of(STYLE)[:1]:
        subject = subject_label(picture.subject)
        style, redraw, hold = f"The target video uses the visual style of {subject}.", "", f"Still in the visual style of {subject}."
    typed = script.camera.lower().strip()
    move = CAMERAS.get(typed, script.camera and sentence(script.camera)) or CAMERAS.get(camera, "")
    move = move.replace("<Subject 1>", cast.main)
    wearers = cast.wearers(script.moments)
    lines = shot_lines(script, seconds, say, cast, wearers, move, hold, sounds)
    last = len(lines)
    cuts = [script.moments[shot[0]] for shot in shots_of(script)[1:]]
    moved = any(not FRAME_WORDS.match(without_speech(moment)) for moment in cuts)
    new_places = last > 1 and not cast.of(PLACE) and moved and all(not FRAME_WORDS.match(without_speech(moment)) for moment in cuts)
    first = next(iter(cast.of(PLACE) or cast.pictures), None)
    if not style and cast.video == EDIT:
        style = VIDEO_LOOKS[EDIT]
    if not style and len(cast.of(PLACE)) > 1:
        style = OWN_COLOURS
    elif not style and not (first and first.job == THING):
        words = KEEP_LOOK if cast.opens else KEEP_COLOURS
        style = VIDEO_LOOKS.get(cast.video) or words.format(picture=picture_label(first.picture if first else 1))
    takes = [EVERY_PLACE] if new_places else []
    if last == 1 and (len(script.moments) > 1 or cast.moves or script.one_take):
        takes = [ONE_SHOT]
    if cast.ends:
        lines[-1] += " " + ENDS_ON.format(picture=picture_label(cast.ends.picture))
    subjects = cast.definitions(last, redraw, wearers)
    kept = cast.retention(lines, redraw, wearers)
    ambience, tune = script_sound(script, sound, new_places)
    if soundtrack and cast.video == KEEP:
        subjects += f"\n{SOUND_GOES_ON}"
        kept += f"\n{SOUND_GOES_ON_KEPT}"
        ambience = OLD_SOUND
    if cast.video == REVOICE and ambience == PLACE_SOUND:
        ambience = ROOM_TONE
    if (cast.clip_sound or cast.video == EDIT) and ambience == PLACE_SOUND:  # The clip's own sound is what plays, unless the script says the sound.
        ambience = CLIP_SOUND
    # With the clip's own sound, words the prompt leaves out are still heard.
    if ambience != "N/A" and any(moment.speech for moment in script.moments) and not cast.clip_sound and cast.video != EDIT:
        ambience = f"{ambience} {ONE_LINE}"
    return {
        "subject_definitions": subjects,
        "summary": summary_of(script, cast, new_places, soundtrack),
        "retention_analysis": kept,
        "detailed_description": "\n".join([" ".join(part for part in (style, move, *takes) if part), *lines]),
        "overall_soundscape": ambience,
        "non_diegetic_music": tune,
    }
