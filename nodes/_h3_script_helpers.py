"""Reads a scene someone typed and writes it in MiniMax H3's six parts.

One line for each thing that happens, and a blank line to cut to a new place.
Every moment stays, in the order it was typed, and gets its own second. Code
does all of it, so nothing typed can be lost or moved around. Plain text, so
the tests run without a server.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from ._h3_swap_reader import read_swap
from ._h3_cast_helpers import (
    SAYS_AFTER,
    EDIT,
    KEEP,
    MAIN,
    OUTFIT,
    PERSON,
    PERFORMER,
    PLACE,
    REVOICE,
    SHEET,
    START as START_JOB,
    END as END_JOB,
    STYLE,
    SWAP,
    SOUND_GOES_ON,
    SOUND_GOES_ON_KEPT,
    THING,
    TOKEN,
    things_that_perform,
    ONE_GOES,
    Cast,
    lower_first,
    number_pictures,
    picture_label,
    subject_label,
    swap_appearances,
)

QUOTES = {"“": '"', "”": '"', "‘": "'", "’": "'", "—": " - ", "–": " - ", "…": "..."}

# A word that starts a new moment inside a line. It goes, the order says it.
# "Back then" and "next to her" are not one. "then" starts a moment unless it is part of a phrase like "by then";
# "next" and "later" only after a comma, before who acts.
WHO_ACTS = r"(?=\s*,|\s+(?:she|he|they|it|we|i|you|@\d|the|a|an|everyone|both)\b)"
THEN = (
    r"(?:^\s*then\b,?|,\s*(?:and\s+)?then\b|\s+and\s+then\b|(?<!\bback)(?<!\bsince)(?<!\buntil)(?<!\btill)(?<!\bby)(?<!\bjust)(?<!\beven)(?<!\bonly)(?<!\bright)(?<!\bnow)\s+then\b|,?\s*and\s+after\s+that\b|,?\s*after\s+that\b"
    r"|,?\s*afterwards?\b|,\s*next" + WHO_ACTS + r"|,\s*later" + WHO_ACTS + r"|,?\s*moments?\s+later\b)"
)
# A word that starts a new moment and stays in it.
# Only after a comma or an "and": "She suddenly turns" and "The dance ends with a spin" stay one moment.
TURN = (
    r"(?=(?:,\s*(?:and\s+)?|\s+and\s+)(?:suddenly|all\s+of\s+a\s+sudden|out\s+of\s+nowhere|finally|at\s+last"
    r"|(?:(?:hard|smash|jump)\s+)?cut\s+to|(?:it\s+)?ends?\s+(?:with|on|in|as)|ending\s+(?:with|on|in))\b)"
)
# Where a line breaks into sentences: a full stop that is not a title, the end of a quote, or a semicolon.
# After a quote, a new sentence starts with a capital or an @: in '"Get a job." @1 looks up' the @1 is a new moment,
# or its own words are lost behind the first quote's. So is '"Hi" and @2 says "Bye"': one moment holds one quote.
# "U.S." and "e.g." are not the end of a sentence. Two quotes in one sentence are two moments, in the order typed.
SENTENCE = (
    r"(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bSt\.)(?<!\bMrs\.)(?<!\b[A-Z]\.[A-Z]\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bvs\.)"
    r"(?<=[.!?])\s+(?=\S)|(?<=\x00)\s+(?=[A-Z@])|(?<=\x00),?\s+(?:and|but|while|as)\s+(?=@\d|[^\x00]*\x00)|\s*;\s*"
)
CUT_WORDS = re.compile(r"^(?:hard\s+)?(?:cut|cuts|smash\s+cut|jump\s+cut)\s+(?P<back>back\s+)?to\b[:,]?\s*", re.I)
NEW_SHOT = re.compile(r"^(?:new\s+shot|next\s+shot|shot\s+\d+)\b[:,.\-]?\s*", re.I)
START = re.compile(r"^(?:it\s+|the\s+(?:clip|video|scene|shot)\s+)?(?:starts?|begins?|opens?)(?:\s+with\b[:,]?|\s+(?:on|in|as)\b(?!\s+(?:\d|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|a\s+few)\s+(?:seconds?|minutes?|hours?|days?)\b))[:,]?|\s+at\b(?!\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight)\b)[:,]?|\s*:)\s*", re.I)
END = re.compile(r"^(?:it\s+|the\s+(?:clip|video|scene|shot)\s+)?(?:ends?|ending|finish(?:es)?|closes?)(?:\s+(?:with|on|in|at|as)\b[:,]?|\s*:)\s*", re.I)
FINALLY = re.compile(r"^(?:finally|at\s+the\s+end|in\s+the\s+end)\b(?!\s+of\b)[:,]?\s*", re.I)
UNIT = r"(?:seconds?|secs?|s)\b"
TIMED = re.compile(
    r"^(?P<open>\[\s*|at\s+)?(?:(?P<min>\d+):(?P<sec>\d\d(?:\.\d+)?)|(?P<num>\d+(?:\.\d+)?)\s*(?:" + UNIT + r"|(?=-\s*\d)))"
    r"(?:\s*-\s*(?:\d+:\d\d(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:" + UNIT + r")?)?(?P<close>\s*\]\s*[:,\-]?|\s*[:,\-](?!\d))?\s*",
    re.I,
)
COMPACT_TIME = re.compile(r"\d+(?:\.\d+)?(?:s|secs?)\b", re.I)
NUMBER = re.compile(
    r"^\s*(?:\d+[.):](?!\d)|[-*•]|(?:first|second|third|fourth|fifth|sixth)(?:ly)?\b(?!-|\s+(?:person|aid|time|times|thing|things|place"
    r"|day|days|date|look|light|class|floor|base|step|steps|frame|shot|half|row|line|lady|gear|kiss|snow|impression|of)\b)[:,]?"
    r"|step\s+\d+\s*[:.),])\s*",
    re.I,
)
LABEL = re.compile(r"^(camera|style|look|sound|sounds|audio|music)\s*:\s*(.*)$", re.I)
SPEECH_CUE = re.compile(
    r"\b(?:says?|said|asks?|whispers?|shouts?|yells?|screams?|mutters?|sings?|raps?|chants?|announces?|calls?\s+out|cries"
    r"|replies|answers?|tells?\s+\w+|goes)\b[^\"]{0,24}$",
    re.I,
)
SIGN_CUE = re.compile(
    r"(\b(?:title|titled|called|named|sign|signs|text|caption|card(?!\s+reader)|poster|logo|banner|headline)\b"
    r"|\breads?\b(?![^\"]*\b(?:aloud|out\s+loud)\b)|\b(?:with|in|reads?|reading)\s+the\s+words?\b|\bthe\s+word\b"
    r"|\b(?:t-?shirt|shirt|hoodie|jacket|mug|cap|hat|tattoo|label|note|board|sticker)\s+(?:(?!and\b|while\b)\w+\s+){0,2}?(?:says|reads|saying)\b"
    r"|\b(?:sign|banner|card|poster|text|caption)\s+(?:(?!and\b|while\b)\w+\s+){0,2}?saying\b)"
    r"[^\"]{0,24}$",
    re.I,
)
NO_MUSIC = re.compile(r"\b(?:no|without|skip)\s+(?:any\s+)?(?:background\s+)?(?:music|soundtrack|score)\b|\bjust\s+(?:the\s+)?(?:ambien\w+|sound of|natural sound)\b", re.I)
NO_SOUND = re.compile(
    r"\b(?:(?:no|without)\s+(?:any\s+)?(?:sound|audio)\b|silent\s+(?:film|movie|clip|video)\b|completely\s+silent\b|total\s+silence\b"
    r"|muted\s+(?:audio|sound)\b|on\s+mute\b|mute\s+(?:the\s+)?(?:audio|sound)\b)",
    re.I,
)
ONE_TAKE = re.compile(r"\b(?:one|single|continuous|unbroken)\s+(?:long\s+)?(?:shot|take)\b(?!\s+(?:of|at)\b)|\b(?:no|without)\s+(?:camera\s+)?cuts?\b", re.I)
SIDE_NOTE = re.compile(
    r"^\s*(?:(?:no|without)\s+(?:any\s+)?(?:background\s+|camera\s+)?(?:music|soundtrack|score|sound|audio|cuts?)(?:\s*,?\s*(?:just|only)\s+(?P<only>.+?))?"
    r"|(?:one|single|continuous|unbroken)\s+(?:long\s+)?(?:shot|take)"
    r"|(?:an?\s+)?silent\s+(?:film|movie|clip|video)|completely\s+silent|total\s+silence|silent|muted|on\s+mute"
    r"|(?:muted|mute\s+(?:the\s+)?)(?:audio|sound))\s*[.!]?\s*$",
    re.I,
)
VOICEOVER = re.compile(r"\b(?:voice-?\s?over|narrator|v\.?o\.?(?=\s*:)|(?<!looks\s)(?<!glances\s)(?<!stares\s)(?<!points\s)off-?\s?(?:screen|camera)|behind\s+the\s+camera|a\s+voice(?!\s+crack))\b|\((?:o\.?s|v\.?o)\.?\)", re.I)
# Where a voice comes from, said beside who it is: "A woman off screen says", "Mom (O.S.):".
FROM_OFF_SCREEN = re.compile(
    r"\b(?:(?:(?:in|as)\s+(?:an?\s+)?(?:off-?\s?screen\s+)?)?voice-?\s?over|off-?\s?(?:screen|camera)|behind\s+the\s+camera)\b|\((?:o\.?s|v\.?o)\.?\)", re.I
)
AFTER_VOICEOVER = re.compile(
    r"^\s*[,.]?\s*(?:(?:(?:in|as)\s+(?:an?\s+)?(?:off-?\s?screen\s+)?voice-?\s?over|from\s+off-?\s?(?:screen|camera))\b|\((?:o\.?s|v\.?o)\.?\))\.?",
    re.I,
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
# Words that trail off ("I never thought...") keep going: across the next cut, or past the end of the clip.
TRAILS_OFF = re.compile(r"(?:\.\.\.|\u2026|\u2014|--|\s-)\s*$")
LINE_CARRIES = "<scenetrans> The line from the previous shot continues seamlessly across the cut, and the words are not repeated."
CUT_OFF = "The line is cut off by the end of the video. <cutoff>"


def speech_runs_on(script, seconds):
    """(carried, cut_off): the moments whose words go on across the next cut, and the last moment's words if the
    clip ends mid-line. Words carry on when they trail off with "..." or need more time than their shot has."""
    starts = timeline(script, seconds)
    ends = [*starts[1:], seconds]
    carried, cut_off = set(), None
    for index, moment in enumerate(script.moments):
        if not moment.speech:
            continue
        trails = bool(TRAILS_OFF.search(moment.speech))
        long = len(moment.speech.split()) / WORDS_A_SECOND > ends[index] - starts[index] + 0.5
        following = script.moments[index + 1] if index + 1 < len(script.moments) else None
        if following is not None and following.cut and not script.one_take and (trails or long):
            carried.add(index)
        elif following is None and trails:
            cut_off = index
    return carried, cut_off

HOLD = f"{MAIN} holds still"  # What fills the time before a first moment set later.
KEEP_LOOK = "The target video keeps the look, the light and the colours of {picture}."
KEEP_COLOURS = "The target video keeps the colours and the film grain of {picture}."
OWN_COLOURS = "Each place keeps its own light and colours."
ONE_SHOT = "One continuous shot with no cuts."
EVERY_PLACE = "Every shot is a new place."
AND_THEN = "Then {line}"
STILL_MOVING = "the camera keeps moving the same way."
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
OWN_MOVES = "{main} moves exactly as in <Video 1>, at the same timing."
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
REST_AS_VIDEO = "Everything else stays as it is in <Video 1>."
SAME_AS_VIDEO = "{main} has the same words, mouth movements and moves as in <Video 1>. Everything else stays as it is in <Video 1>."
CARRIES_ON = "The shot carries straight on from the end of <Video 1>."
ACTION_GOES_ON = "The action keeps going the way it was heading, and the camera keeps moving the same way."
VIDEO_LOOKS = {
    SWAP: "Retain the look of <Video 1>.",
    KEEP: "The target video keeps the look, colours and camera of <Video 1>.",
    REVOICE: "The target video keeps the look, light and camera of <Video 1>.",
    EDIT: "Retain the look of <Video 1>.",
}
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
    back: bool = False  # "cut back to": a place already seen.


@dataclass
class Script:
    moments: list = field(default_factory=list)
    camera: str = ""
    look: str = ""
    sound: str = ""
    music: str = ""  # "N/A" is no music.
    silent: bool = False
    one_take: bool = False


SINGLE_QUOTED = re.compile(
    r"\b((?:says?|said|asks?|asked|whispers?|whispered|shouts?|shouted|yells?|yelled|screams?|mutters?|sings?|replies|replied"
    r"|answers?|calls?\s+out|cries)\s*[:,]?\s*)'([^'\n\x01]+?)'(?!\w)",
    re.I,
)


def clean(text):
    for old, new in QUOTES.items():
        text = text.replace(old, new)
    # Words already in double quotes stay as typed, so a quote inside them can't move their ends.
    kept = []

    def keep(match):
        kept.append(match.group(0))
        return f"\x01{len(kept) - 1}\x01"

    text = re.sub(r'"[^"\n]*"', keep, text)
    text = SINGLE_QUOTED.sub(lambda match: f'{match.group(1)}"{match.group(2)}"', text)
    text = re.sub(r"\x01(\d+)\x01", lambda match: kept[int(match.group(1))], text)
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
            bit = re.sub(r"^[\s,;]*and\s+", "", bit, flags=re.I)
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
    text = mask_quotes(text)[0]
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
    sign, spoken = SIGN_CUE.search(before), SPEECH_CUE.search(before)
    if sign and spoken and re.search(r",|\b(?:and|while|then)\b", before[sign.end(1) : spoken.start()]):
        sign = None  # "holds up a sign and shouts": the shout is the last thing done, so it is said.
    if not (sign or (words.isupper() and not spoken)):
        moment.speech = words
        moment.voiceover = VOICEOVER.search(before) is not None or AFTER_VOICEOVER.match(moment.text[match.end() :]) is not None
        moment.voice = voice_of(before, moment.voiceover)


def one_or_more(text, match):
    """What an opening or an ending is on: two words or more, or one when it is
    set apart with a colon or is black or white ("Start on black.")."""
    rest = text[match.end() :].strip(" .")
    return len(rest.split()) > 1 or (bool(rest) and (match.group(0).rstrip().endswith(":") or rest.lower() in ("black", "white")))


def read_moment(moment):
    text = moment.text
    timed = TIMED.match(text)
    marked = timed and (timed.group("open") or timed.group("close") or timed.group("min") is not None or COMPACT_TIME.match(text))
    if timed and not marked:
        timed = None  # "7 seconds remain on the clock" is something that happens; "3s she waves" is a time.
    if timed:
        if timed.group("min") is not None:
            moment.at = int(timed.group("min")) * 60 + float(timed.group("sec"))
        else:
            moment.at = float(timed.group("num"))
        text = text[timed.end() :]
    cut = CUT_WORDS.match(text) or NEW_SHOT.match(text)
    if cut:
        moment.cut = True
        moment.back = bool(cut.groupdict().get("back"))
        text = text[cut.end() :]
    start = START.match(text)
    end = END.match(text) or FINALLY.match(text)
    if start and one_or_more(text, start):
        moment.start = True
        text = text[start.end() :]
    elif end and one_or_more(text, end):
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
        shot = count  # Where the shot that camera: and sound: lines belong to starts.

        def hand_on(shot):
            """camera: and sound: typed so far go to the shot they were typed in."""
            if shot < len(script.moments) and (script.camera or script.sound):
                moment = script.moments[shot]
                moment.camera, moment.sound = script.camera or moment.camera, script.sound or moment.sound
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
                read_moment(moment)
                if not moment.text:
                    after_gap = after_gap or moment.cut  # "Shot 2:" on its own line cuts before the next moment.
                    continue
                after_gap = False
                if moment.cut and len(script.moments) > count:  # "Shot 2:" inside a block starts a shot of its own.
                    hand_on(shot)
                    shot = len(script.moments)
                script.moments.append(moment)
        hand_on(shot)
        typed = script.camera, script.sound
        script.camera, script.sound = whole_clip
        if len(script.moments) == count:
            script.camera, script.sound = typed[0] or script.camera, typed[1] or script.sound
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
    carried, cut_off = speech_runs_on(script, seconds)
    for index, (moment, start, end) in enumerate(zip(script.moments, starts, [*starts[1:], seconds])):
        unseen = UNSEEN.search(without_speech(moment))
        if unseen:
            return f'A camera can\'t see "{unseen.group(0).lower()}". Say what we would see, like "she smiles".'
        takes = len(moment.speech.split()) / WORDS_A_SECOND
        if takes > end - start + 0.5 and index not in carried and index != cut_off:
            return f"A spoken line takes about {takes:.0f} seconds to say, and its moment has {end - start:.0f}. Give it more room."
    return ""


def swap_reading(text, jobs):
    """What a swap's lines were read as, for the node: who each new person replaces and how they look, from the
    same reading the prompt uses, and the words a swap does not use."""
    jobs = things_that_perform(text, jobs, SWAP)
    read = read_swap(text, jobs)
    cast = Cast(number_pictures(jobs, SWAP), SWAP)
    cast.name_who_goes(read, text)
    descriptions = read.descriptions
    people = [
        {"slot": picture.slot, "goes": who, "looks": descriptions.get(picture.slot, ""), "named": picture.slot in read.goes}
        for picture, who in zip(cast.swappers, cast.whos)
    ]
    return {"people": people, "unused": read.unused, "keeps_clip_clothes": cast.clip_clothes}


GOES = re.compile(r"^(<Subject \d+>) is (.+) in <Video 1>, selected for replacement\.$")
COMES = re.compile(r"^(<Subject \d+>) is (.*?<Picture \d>)(?:, (.+?))?\.(?: The background .*)?$")
TAKES = re.compile(r"^(<Subject \d+>): removed - replace .+ with (<Subject \d+>) throughout\.$", re.M)
SAYS = re.compile(r"(<Subject \d+>)(?:(?!<Subject \d+>).)*?<d>(?:\[[^\]]*\]\s*)?(.*?)</d>")


def swap_cast(text, jobs):
    """A swap's cast as the Ref2VA prompt names it, one short line each, taken from the prompt the writer writes:
    who leaves the clip, who takes their place and how they look, and who says what."""
    from ._h3_prompt_helpers import split_sections, write_prompt

    parts = split_sections(write_prompt(text, jobs=jobs, video=SWAP))
    replaced = {new: old for old, new in TAKES.findall(parts.get("retention_analysis", ""))}
    lines = []
    for line in parts.get("subject_definitions", "").splitlines():
        goes = GOES.match(line)
        comes = COMES.match(line)
        if goes:
            lines.append(f"{goes.group(1)} {goes.group(2)} in <Video 1> \u2192 removed")
        elif comes:
            subject, who, rest = comes.groups()
            rest = (rest or "").removeprefix("with the same face and this appearance: ").removeprefix("with ")
            place = f", takes {replaced[subject]}'s place" if subject in replaced else ""
            lines.append(f"{subject} = {who}{place}{': ' + rest if rest else ''}")
    for subject, words in SAYS.findall(parts.get("detailed_description", "")):
        lines.append(f"{subject} says <d>{words}</d>")
    return lines


def script_report(text, seconds, jobs=None, video=""):
    """What a script will do, for the timeline on the node."""
    reading = None
    if video == SWAP and jobs is not None:
        try:
            reading = swap_reading(text, jobs)
            reading["cast"] = swap_cast(text, jobs)
        except ValueError as error:
            # The writer refuses these lines when it runs; say why now, on the node.
            reading = {"people": [], "unused": [], "keeps_clip_clothes": False, "problem": str(error)}
    # The optional swap description is not a second timed action.
    if not (reading and "problem" in reading):
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
    jobs = things_that_perform(text, jobs, video) if jobs is not None else None
    cast = Cast(number_pictures(jobs, video), video) if jobs is not None else None
    report = {"moments": moments, "seconds": seconds, "warning": script_warning(script, seconds, cast)}
    if reading is not None:
        report["read"] = reading
    return report


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
    after = AFTER_VOICEOVER.sub("", after)
    return " ".join(part.strip(" ,:") for part in (before, after) if part.strip(" ,:."))


def moment_words(moment, say, cast):
    if moment.speech and cast.as_typed and not moment.voice and f'"{moment.speech}"' in moment.text:
        # More than one person: the line as typed, with only the words put in H3's speech tag.
        typed = with_labels(moment.text.replace(f'"{moment.speech}"', "\x02", 1), cast)
        if moment.start:
            typed = "The shot opens on " + lower_first(typed)
        elif moment.end:
            typed = "The shot ends on " + lower_first(typed)
        typed = typed.strip()
        typed = typed if typed.endswith("\x02") else sentence(typed)
        return typed.replace("\x02", say(moment.speech, not moment.voiceover, bare=True))
    words = with_labels(without_speech(moment), cast)
    if moment.start:
        words = "The shot opens on " + lower_first(words)
    elif moment.end:
        words = "The shot ends on " + lower_first(words)
    line = sentence(words) if words else ""
    if moment.speech:
        line = f"{line} {say(moment.speech, not moment.voiceover)}".strip()
    return line


def speaker_of(moment, cast):
    """Who says a moment's words: an off-screen voice, the person named right
    before them ("@2 says"), the first person the moment names, or the main
    person. With more than one person and no voice, as_typed means nobody is
    picked at all."""
    if moment.voice:
        return moment.voice
    people = {picture.slot for picture in cast.people}
    quote = moment.text.find('"')
    before = moment.text[:quote] if quote >= 0 else moment.text
    named = [slot for slot in SAYS_AFTER.findall(before) if int(slot) in people]
    if named:
        return cast.subjects[int(named[-1])]
    for slot in TOKEN.findall(moment.text):
        if int(slot) in people:
            return cast.subjects[int(slot)]
    return cast.main


def speakers(moments, cast):
    """Everyone who speaks, in the order H3 numbers them."""
    found = []
    for moment in moments:
        who = moment.voice if cast.as_typed else speaker_of(moment, cast)
        if moment.speech and who and who not in found:
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
                         else f"has the shape, colours and drawing style of the character in {picture_label(picture.picture)}"
                         if picture.job == PERFORMER
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
    places = [subject_label(picture.subject) for picture in cast.of(PLACE)]
    if places and not any(place in text for place in places):
        notes.append(IN_THE_PLACE.format(place=places[0]))
    people = people_in(text, cast)
    if len(people) > 1 and not any(person in text for person in people) and cast.video != SWAP:
        # "They sit down" names nobody, so H3 is told who they are. Where they stand is the script's to say.
        notes.append(f"{', '.join(people[:-1])} and {people[-1]} are in the shot.")
    for slot, wearer in wearers.items():
        outfit = cast.subjects[slot]
        # An edit has no person picture: the person in the video wears an outfit that no line names.
        if outfit not in text and (wearer in people or wearer in text or (cast.video == EDIT and wearer == cast.in_video)):
            notes.append(WEARS.format(wearer=wearer, outfit=outfit))
    return notes


def after_the_action(text, cast):
    """What H3 needs to hear about a shot once its action has been said."""
    notes = []
    if cast.moves and cast.video_person and cast.main in text:
        notes.append(OWN_MOVES.format(main=cast.main) if cast.own_moves else THE_MOVES.format(main=cast.main, moves=cast.moves))
    if cast.video == EDIT:
        notes.append(SAME_AS_VIDEO.format(main=cast.main) if cast.video_person else REST_AS_VIDEO)
    if cast.video in (SWAP, EDIT):
        notes.append(FOLLOWS_CAMERA)
    for picture in cast.of(SHEET):
        subject = subject_label(picture.subject)
        if subject in text or len(cast.people) == 1:
            notes.append(ON_SHEET.format(subject=subject, picture=picture_label(picture.picture)))
    return notes


def cut_to(words, text, cast, back=False):
    """How a later shot opens, and what is left of its first moment to say."""
    if back:
        return f"the camera cuts back to {lower_first(words)}", ""
    if FRAME_WORDS.match(words):
        return f"the camera cuts to {lower_first(words)}", ""
    places = [subject_label(picture.subject) for picture in cast.of(PLACE)]
    named = next((place for place in places if place in text), None)
    if named:
        return f"the camera cuts to {named}.", words
    return f"the camera cuts to {'a new view' if places else 'a new place'}.", words


def shot_lines(script, seconds, say, cast, wearers, move="", hold=""):
    """One line for each shot. H3 jumps at a timed [Shot] mark whatever the words
    say, so the moments of one take are sentences inside one shot."""
    starts = timeline(script, seconds)
    talking = speakers(script.moments, cast)
    quiet = " ".join(QUIET.format(speaker=speaker) for speaker in talking if speaker.startswith("<"))
    carried, cut_off = speech_runs_on(script, seconds)
    lines = []
    for number, shot in enumerate(shots_of(script), 1):
        shot_camera = script.moments[shot[0]].camera
        shot_camera = CAMERAS.get(shot_camera.lower().strip(), shot_camera and sentence(shot_camera)).replace("<Subject 1>", cast.main)
        moving = MOVING.search(shot_camera or move)
        said = []
        for index in shot:
            moment = script.moments[index]

            def speak(words, on_screen=True, moment=moment, bare=False):
                if bare:  # Only the speech tag: the typed line around it says who.
                    return say(words, on_screen, None)
                who = speaker_of(moment, cast)
                if moment.delivery:
                    return say(words, on_screen, who, talking.index(who) + 1, delivery=moment.delivery)
                return say(words, on_screen, who, talking.index(who) + 1)

            words = " ".join(
                [
                    moment_words(moment, speak, cast),
                    *([quiet] if quiet and not moment.speech else []),
                ]
            ).strip()
            said.append(words)
        text = " ".join(said)
        first = shot[0]
        head, said[0] = (cut_to(said[0], text, cast, script.moments[first].back) if number > 1 else ("", said[0]))
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
        line = " ".join(part for part in body if part)
        if shot[0] - 1 in carried:
            # The speaker is mid-line as the shot opens, so the mouth is not closed here.
            line = f"{LINE_CARRIES} " + re.sub(r" ?<Subject \d+> stays silent with the lips closed\.", "", line, count=1)
        if shot[-1] in carried:
            # The speaker is still talking at the cut, so the mouth does not close here.
            line = re.sub(r" <Subject \d+> closes the lips\.", "", line) + " <scenetrans>"
        if shot[-1] == cut_off:
            line = re.sub(r" <Subject \d+> closes the lips\.", "", line) + f" {CUT_OFF}"
        lines.append(f"[Shot {number}] " + line)
    if cast.video_person and cast.main_in_shot and not any(cast.main in line for line in lines):
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
        where = "" if cast.of(PLACE) else " in the same place"
        return f"[{tag}] The target video continues directly from the end of <Video 1>{where}."
    talking = [who for who in speakers(script.moments, cast) if who.startswith("<")]
    who_speaks = f"{' and '.join(talking)} speak" if len(talking) > 1 else f"{cast.main} speaks"
    # With more than one person the summary keeps the typed line and only stands
    # "a line" in for the words, which the description already carries once.
    said = (lambda moment: re.sub(r'"[^"]*"', "a line", moment.text)) if cast.as_typed else without_speech
    opening = with_labels(said(script.moments[0]), cast) or who_speaks
    later = [with_labels(said(script.moments[shot[0]]), cast) for shot in shots_of(script)[1:]]
    if cast.opens and cast.ends:
        moving = f"moving from {picture_label(cast.opens.picture)} to {picture_label(cast.ends.picture)}"
        return f"[{task}] In the target video, {lower_first(opening.rstrip('.!? '))}, {moving}."
    summary = f"[{task}] In the target video, {lower_first(sentence(opening))}"
    summary += "".join(f" {AND_THEN.format(line=lower_first(sentence(line)))}" for line in later if line)
    if cast.moves and cast.video_person:
        summary += " " + (OWN_MOVES.format(main=cast.main) if cast.own_moves else THE_MOVES.format(main=cast.main, moves=cast.moves))
    return f"{summary} {EVERY_PLACE}" if new_places else summary


def script_parts(script, seconds, camera="", look="", sound="", say=None, cast=None, soundtrack=False):
    """H3's six parts, from a Script. say turns spoken words into H3's line.
    cast says what each picture and the video are for. soundtrack says a
    video's own sound is connected."""
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
    lines = shot_lines(script, seconds, say, cast, wearers, move, hold)
    last = len(lines)
    cuts = [script.moments[shot[0]] for shot in shots_of(script)[1:]]
    new_view = [not moment.back and not FRAME_WORDS.match(without_speech(moment)) for moment in cuts]
    new_places = last > 1 and not cast.of(PLACE) and any(new_view) and all(new_view)
    # Only a place, a start frame or a person sets the look; an outfit, a thing or a style never does.
    first = next(iter(cast.of(PLACE) or cast.of(START_JOB) or cast.of(PERSON, SHEET, PERFORMER, END_JOB)), None)
    if not style and cast.video == EDIT and not cast.of(PLACE):
        style = VIDEO_LOOKS[EDIT]
    if not style and len(cast.of(PLACE)) > 1:
        style = OWN_COLOURS
    elif not style and (first or cast.video in VIDEO_LOOKS):
        words = KEEP_LOOK if cast.opens else KEEP_COLOURS
        style = (cast.video != EDIT and VIDEO_LOOKS.get(cast.video)) or words.format(picture=picture_label(first.picture if first else 1))
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
        "detailed_description": "\n".join([*[" ".join(part for part in (style, move, *takes) if part)] * bool(style or move or takes), *lines]),
        "overall_soundscape": ambience,
        "non_diegetic_music": tune,
    }
