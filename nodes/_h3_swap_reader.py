"""How H3 Prompt Writer reads the lines typed for a swap.

The text is cut into sentences (quotes and "Mr." stay whole), each sentence into one stretch of words per @, and
each stretch is read for two things: who in the clip goes, and how the new person looks. Whatever a sentence says
beyond that is kept as "not used", so the node can show it instead of losing it. A swap keeps the clip's action and
camera, so only spoken lines go on to the prompt from there.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re

PERSONS = ("person", "character sheet")
SWAPPERS = (*PERSONS, "thing that moves")  # A moving thing can come in too; only people get a look.
TOKEN = re.compile(r"@([1-4])\b")
QUOTE_MARKS = '"“”'
HAS_QUOTE = re.compile(r'["“”]')
ABBREVIATION = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc)\.$", re.I)
# "keeps the outfit", "in the clip's clothes": the new person wears the clothes of the one who goes.
KEEP_CLOTHES_WORDS = (
    r"\bkeep(?:s|ing)?\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:(?:clip|video)'?s\s+)?(?:original\s+|same\s+)?"
    r"(?:outfit|clothes|clothing)\b(?:\s+(?:from|of|in)\s+the\s+(?:clip|video|original))?"
    r"|\b(?:in|wearing|wears)\s+the\s+(?:clip'?s|video'?s|original)\s+(?:outfit|clothes|clothing)\b"
    r"|\b(?:outfit|clothes|clothing)\s+(?:from|of)\s+the\s+(?:clip|video)\b"
)
KEEP_CLOTHES = re.compile(rf",?\s*(?:\b(?:and|but)\s+)?(?:{KEEP_CLOTHES_WORDS})", re.I)
IN_THE_CLIP = re.compile(r"\s+(?:in|from|of)\s+the\s+(?:clip|video|original(?:\s+(?:clip|video))?)\b", re.I)
PRONOUN = re.compile(r"^(?:him|her|them|it|he|she|they|his\s+\w+|her\s+\w+|their\s+\w+|the\s+person)$", re.I)
NAME = r"[A-Z][a-z][\w'.-]*(?:\s+[A-Z][a-z][\w'.-]*)?"
SPOT = r"(?:far\s+left|far\s+right|left|right|middle|centre|center|front|back)"

# The words to the left of an @ that say who goes. Each pattern ends where the @ starts.
ASKS = re.compile(
    r"^(?:please\s+)?(?:replace|swap|switch|exchange|substitute|change|trade)\s+(?:out\s+)?(?P<x>.+?)\s+(?:out\s+)?"
    r"(?:with|for|by|to)\s*$",
    re.I,
)
MAKE = re.compile(r"^(?:please\s+)?(?:make|turn)\s+(?P<x>.+?)\s+(?:into|look\s+like|become|be)\s*$", re.I)
SHORT_ASK = re.compile(r"^(?P<x>.+?)\s+(?:with|for|by)\s*$", re.I)  # "and the girl in blue with @2", after a replace.
REPLACED = re.compile(
    r"^(?P<x>.+?)\s+(?:is|gets|will\s+be)\s+(?:replaced|swapped(?:\s+out)?)\s+(?:by|with|for)\s*$"
    r"|^(?P<y>.+?)\s+(?:becomes|turns\s+into|is\s+now|is|->|→|=>|=)\s*$",
    re.I,
)
IN_BRACKETS = re.compile(r"^(?P<x>.+?)\s*\(\s*$")
PUTS = re.compile(r"^(?:please\s+)?(?:put|place|drop|swap|switch|insert)\s*$", re.I)
LEFT_SIDE = (ASKS, MAKE, REPLACED, IN_BRACKETS)

# The words to the right of an @, read one piece at a time.
POSSESSIVE = re.compile(r"^'s\s+(?:face|head|body|look)\b", re.I)
BRACKET = re.compile(r"^\s*\((?P<p>[^)]*)\)")
COMMA_LOOKS = re.compile(
    r"^\s*,\s*(?P<looks>(?:a|an)\s+.+?)\s*(?=,\s*(?:and\s+)?(?:he|she|they|who|replaces|replacing|takes)\b|,\s*and\b|;|$)", re.I
)
WEARS = re.compile(
    r"^\s*,?\s*(?:who\s+(?:is\s+)?(?:wears|wearing)|wearing|wears|is\s+wearing|dressed\s+in|in)\s+"
    r"(?P<wear>(?:a|an|some)\s+.+?)\s*(?=,|\s+and\s+|;|$)",
    re.I,
)
HAS = re.compile(r"^\s*,?\s*(?:who\s+has|who\s+is|with)\s+(?P<looks>.+?)\s*(?=,\s*and\b|\s+and\s+(?:he|she|says|replaces)\b|;|$)", re.I)
LOOKS_LIKE = re.compile(r"^\s+(?:looks\s+like|is|has)\s+(?P<looks>(?:a|an|long|short|\w+\s+hair).+?)\s*(?=,\s*and\b|;|$)", re.I)
IS_WHO = re.compile(r"^\s*(?:,|\s+is)\s+(?P<x>the\s+.+?)\s*(?=,\s*(?:and|then|while|but)\b|\s+and\s+|;|$)", re.I)
IS_NAME = re.compile(rf"^\s+is\s+{NAME}\s*(?=,|$|\s+and\b)")
IS_NEW = re.compile(r"^\s+is\s+the\s+new\s+\w+", re.I)
GOES_FOR = re.compile(
    r"^\s*,?\s*(?:and\s+)?(?:(?:he|she|they)\s+)?(?:replaces|is\s+replacing|replacing|takes\s+(?:over\s+)?(?:the\s+)?(?:place|role|spot)\s+of"
    r"|swaps?\s+(?:in\s+)?(?:for|with)|in\s+for|goes\s+in\s+for|stands?\s+in\s+for|in\s+place\s+of|instead\s+of|for|as|plays)\s+"
    r"(?P<x>.+?)\s*(?=,\s*(?:and|then|while|but)\b|\s+and\s+(?:the|says|then|make|add|keep|have)\b|;|$)",
    re.I,
)
ON_SPOT = re.compile(rf"^\s+(?:on|at|in)\s+the\s+(?P<spot>{SPOT})\b", re.I)
NOUN = re.compile(r"^\s+(?P<x>(?:the|a|an|his|her|their)\s+.+?)\s*(?=,\s*(?:and|then|while|but)\b|\s+and\s+|;|$)", re.I)
ARROW = re.compile(r"^\s*(?:->|→|=>|=|:)\s*(?P<x>.+?)\s*$")
# Lines with no @ that still say something about the one new person: "she has red hair", "he replaces the man".
SAYS_LOOKS = re.compile(
    r"^(?:and\s+)?(?:she|he|they)\s+(?:(?P<wear>wears|is\s+wearing|is\s+dressed\s+in)|has|have|looks\s+like|is\s+(?=a\b|an\b))\s+(?P<looks>.+)$",
    re.I,
)
SAYS_GOES = re.compile(
    r"^(?:and\s+)?(?:she|he|they)\s+(?:replaces|takes\s+the\s+place\s+of|goes\s+in\s+for|stands\s+in\s+for)\s+(?P<x>.+)$", re.I
)
LOOKS_LINE = re.compile(r"^\s*@([1-4])\s+looks\s+like(?:\s+(?P<looks>.+?))?\s*$", re.I)
BARE_WHO = re.compile(r"^(?:the|a|an|this|that|everyone|both)\b", re.I)
ACTION = re.compile(
    r"\b(?:dances|walks|runs|talks|says|sits|stands|smiles|waves|jumps|enters|leaves|laughs|sings|eats|drinks|waits|"
    r"zooms|pans|is\s+\w+ing|are\s+\w+ing)\b",
    re.I,
)
BOUNDARY = re.compile(r";\s*|,\s*and\s+|\s+and\s+|,\s*then\s+|\s+then\s+|,\s*but\s+|,\s+")
FILLER = re.compile(
    r"^(?:(?:both|all|the)\s+(?:two\s+|three\s+|four\s+)?(?:people|persons|of\s+them)\s+(?:are|get)\s+(?:replaced|swapped)|and|then|but|so|please|also|he|she|they|it|him|her|them|ok|okay|thanks|says?|said|@\d|\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?:?"
    r"|at\s+\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?|[\W_]+)$",
    re.I,
)


@dataclass
class SwapRead:
    """What a swap's typed lines say: who goes (by picture number), how each new person looks, and the words that
    went nowhere."""

    goes: dict = field(default_factory=dict)
    looks: dict = field(default_factory=dict)
    wears: dict = field(default_factory=dict)
    unused: list = field(default_factory=list)
    names: dict = field(default_factory=dict)

    @property
    def descriptions(self):
        """How each new person looks, as one phrase. Clothes alone keep the picture's hair."""
        out = {}
        for slot in sorted({*self.looks, *self.wears}):
            looks = ", ".join(self.looks.get(slot, []))
            worn = " and ".join(self.wears.get(slot, []))
            out[slot] = f"{looks or 'the same hair'}, wearing {worn}" if worn else looks
        return out


def sentences(text):
    """The text cut into sentences: at each line end, and at . ! ? outside quotes that are not part of "Mr."."""
    out = []
    for line in str(text or "").splitlines():
        start, quoted, index = 0, False, 0
        while index < len(line):
            char = line[index]
            if char in QUOTE_MARKS:
                quoted = not quoted
            elif char in ".!?" and not quoted:
                while index + 1 < len(line) and line[index + 1] in ".!?":
                    index += 1
                at_end = index + 1 == len(line) or line[index + 1].isspace()
                if at_end and not ABBREVIATION.search(line[start : index + 1]):
                    out.append(line[start : index + 1])
                    start = index + 1
            index += 1
        out.append(line[start:])
    return [piece.strip() for piece in out if piece.strip(" .!?\t")]


def clean_who(words):
    words = IN_THE_CLIP.sub("", words.strip()).strip(" ,.;:")
    words = re.sub(r"^(?:out\s+)", "", words, flags=re.I)
    return "" if not words or PRONOUN.match(words) else words


def tidy(words):
    return re.sub(r"\s+", " ", words).strip(" ,.;:")


class Reader:
    def __init__(self, jobs):
        self.jobs = dict(jobs or {})
        self.swappers = [slot for slot in sorted(self.jobs) if self.jobs[slot] in SWAPPERS]
        self.explicit = set()  # Pictures with an "@N looks like" line, which wins over any other description.
        self.read = SwapRead()
        self.last = self.swappers[0] if len(self.swappers) == 1 else None
        self.bare = []  # Lines that only name someone, for line-order matching.

    # ---- the parts of one sentence

    def name_aliases(self, text):
        """ "Elon is @1", "@1 is Elon", "Elon (@1)", "with Elon, @1": the name stands for the picture from here on."""
        for pattern in (
            rf"(?P<name>{NAME})\s+is\s+@(?P<slot>[1-4])\b",
            rf"@(?P<slot>[1-4])\s+is\s+(?P<name>{NAME})\b(?!\s+(?:of|on|in)\b)",
            rf"(?P<name>{NAME})\s*\(\s*@(?P<slot>[1-4])\s*\)",
            rf"(?<=\bwith\s)(?P<name>{NAME}),\s*@(?P<slot>[1-4])\b",
        ):
            for match in re.finditer(pattern, text):
                name = match.group("name")
                if not re.match(r"(?:The|A|An|This|That|Left|Right)\b", name):
                    self.read.names[name] = int(match.group("slot"))

    def with_names_as_pictures(self, text):
        for name, slot in self.read.names.items():
            text = re.sub(rf"{re.escape(name)}\s+is\s+@{slot}\b", f"@{slot}", text)
            text = re.sub(rf"@{slot}\s+is\s+{re.escape(name)}\b", f"@{slot}", text)
            text = re.sub(rf"{re.escape(name)}\s*\(\s*@{slot}\s*\)", f"@{slot}", text)
            text = re.sub(rf"{re.escape(name)},\s*@{slot}\b", f"@{slot}", text)
            text = re.sub(rf"\b{re.escape(name)}\b(?!\s*[,(]?\s*@)", f"@{slot}", text)
        return text

    def goes(self, slot, words):
        words = clean_who(words)
        if words and slot in self.swappers and slot not in self.read.goes:
            self.read.goes[slot] = words

    def looks(self, slot, words, explicit=False):
        words = tidy(words or "")
        if not words:
            if explicit:
                raise ValueError(f"Say what Picture {slot}'s person looks like, or remove its looks like line.")
            return
        if explicit:
            if slot not in self.jobs:
                raise ValueError(f"Picture {slot} is not connected. Connect the new person's picture or remove its looks like line.")
            if self.jobs[slot] not in PERSONS:
                raise ValueError(f"Picture {slot} must be a person or character sheet for a swap's looks like line.")
            if slot in self.explicit:
                raise ValueError(f"Describe Picture {slot} once, in one looks like line.")
            self.explicit.add(slot)
            self.read.unused.extend(self.read.looks.pop(slot, []))
        elif slot in self.explicit:
            self.read.unused.append(words)
            return
        if slot in self.swappers and self.jobs.get(slot) in PERSONS:
            self.read.looks.setdefault(slot, []).append(words)

    def wears(self, slot, words):
        words = tidy(words)
        if words and slot in self.swappers and self.jobs.get(slot) in PERSONS:
            self.read.wears.setdefault(slot, []).append(words)

    def left_of(self, slot, left, verb_before):
        """Reads the words before an @. Returns whether they were used."""
        left = re.sub(r"^\s*(?:,|and\b|;)\s*", "", left).strip()
        if not left:
            return True
        for pattern in LEFT_SIDE + ((SHORT_ASK,) if verb_before else ()):
            match = pattern.match(left)
            if match:
                who = next(group for group in match.groups() if group)
                if pattern is REPLACED and re.fullmatch(NAME, who.strip()):
                    return True  # "Elon is @1" names the new person.
                self.goes(slot, who)
                return True
        return bool(PUTS.match(left))

    def right_of(self, slot, right, verb_before, first=True):
        """Reads the words after an @, piece by piece. Returns what is left over."""
        right = re.sub(r"^\s*\)", "", right)
        first = first  # "@1 the man on the left": a plain who-goes right after an @ that starts its words.
        while right.strip(" ,.;:"):
            for pattern, use in (
                (POSSESSIVE, None),
                (KEEP_CLOTHES_AT_START, None),
                (COMMA_LOOKS, "looks"),
                (IS_NEW, None),
                (IS_WHO, "goes"),
                (BRACKET, "bracket"),
                (GOES_FOR, "goes"),
                (WEARS, "wear"),
                (HAS, "looks"),
                (LOOKS_LIKE, "looks"),
                (IS_NAME, None),
                (IS_NEW, None),
                (ON_SPOT, "spot"),
                (ARROW, "goes"),
                (NOUN, "goes"),
            ):
                if pattern is NOUN and not (verb_before or first):
                    continue
                match = pattern.match(right)
                if not match:
                    continue
                if use == "looks":
                    self.looks(slot, match.group("looks"))
                elif use == "wear":
                    self.wears(slot, match.group("wear"))
                elif use == "goes":
                    self.goes(slot, match.group("x"))
                elif use == "spot":
                    self.goes(slot, f"the person on the {match.group('spot').lower()}")
                elif use == "bracket":
                    words = match.group("p").strip()
                    if not re.fullmatch(NAME, words):
                        self.looks(slot, words)
                right = right[match.end() :]
                first = False
                break
            else:
                return right
        return ""

    def sentence(self, text):
        """Reads one sentence. Returns the words it did not use."""
        if HAS_QUOTE.search(text):
            # Spoken words go on to the prompt; only the words before the line are read here.
            quote = HAS_QUOTE.search(text).start()
            cuts = [match.start() for match in BOUNDARY.finditer(text[:quote])]
            text = text[: cuts[-1]] if cuts else ""
            spoken = True
        else:
            spoken = False
        text = KEEP_CLOTHES.sub("", text).strip()
        if not text.strip(" .!?"):
            return []
        line = LOOKS_LINE.match(text.rstrip(" .!?"))
        if line:
            self.looks(int(line.group(1)), line.group("looks"), explicit=True)
            self.last = int(line.group(1))
            return []
        tokens = list(TOKEN.finditer(text))
        if not tokens:
            return self.no_picture(text.rstrip(" .!?"), spoken)
        leftover = []
        verb_before = False
        start = 0
        for index, token in enumerate(tokens):
            slot = int(token.group(1))
            self.last = slot
            end = len(text)
            if index + 1 < len(tokens):
                end = self.cut(text[token.end() : tokens[index + 1].start()], verb_before or self.asks(text[start : token.start()]))
                end += token.end()
            left = text[start : token.start()]
            used_left = self.left_of(slot, left, verb_before)
            verb_before = verb_before or bool(ASKS.match(left.strip()) or re.search(r"\breplaces?\b|\bswap\b", left + text[token.end() : end], re.I))
            if not used_left:
                leftover.append(left)
            right = text[token.end() : end]
            rest = self.right_of(slot, right, verb_before, first=not left.strip())
            if rest.strip(" ,.;:!?"):
                leftover.append(f"@{slot}{rest}" if rest == right and not left.strip() else rest)
            start = end
        return [] if spoken else leftover

    @staticmethod
    def asks(left):
        return bool(ASKS.match(re.sub(r"^\s*(?:,|and\b)\s*", "", left).strip()))

    @staticmethod
    def cut(between, verb_before):
        """Where the words between two @s stop being about the first one: at the earliest break after which the
        rest reads as the second one's start, or at the end."""
        for match in BOUNDARY.finditer(between):
            after = between[match.end() :].strip()
            if not after:
                return match.start()
            for pattern in LEFT_SIDE + ((SHORT_ASK,) if verb_before else ()):
                if pattern.match(after):
                    return match.start()
        return len(between)

    def no_picture(self, text, spoken):
        """A sentence with no @: about the one new person ("she has red hair"), only who goes ("the man in the hat"),
        or something a swap does not use."""
        who = self.last if self.last in self.swappers else (self.swappers[0] if len(self.swappers) == 1 else None)
        looks = SAYS_LOOKS.match(text)
        if looks and who:
            (self.wears if looks.group("wear") else self.looks)(who, looks.group("looks"))
            return []
        goes = SAYS_GOES.match(text)
        if goes and who:
            self.goes(who, re.split(r",\s*(?:and|then)\b|\s+and\s+(?:the|then)\b", goes.group("x"))[0])
            return []
        if spoken:
            return []
        if BARE_WHO.match(text) and not ACTION.search(text) and not re.match(r"^(?:make|add|keep|turn)\b", text, re.I):
            self.bare.append(text)
            return []
        return [text]

    def run(self, text):
        self.name_aliases(text)
        text = self.with_names_as_pictures(text)
        for piece in sentences(text):
            for words in self.sentence(piece):
                for part in BOUNDARY.split(words):
                    part = tidy(part)
                    if part and not FILLER.match(part) and re.search(r"[A-Za-z]{3,}", part):
                        self.read.unused.append(part)
        missing = [slot for slot in self.swappers if slot not in self.read.goes]
        if self.bare and len(self.bare) == len(missing) or (self.bare and len(missing) == 1):
            for slot, who in zip(missing, self.bare):
                self.goes(slot, who)
        elif self.bare:
            self.read.unused.extend(self.bare)
        return self.read


KEEP_CLOTHES_AT_START = re.compile(r"^" + KEEP_CLOTHES.pattern, re.I)


def read_swap(text, jobs):
    """What a swap's typed lines say, read once. jobs is {picture number: job}."""
    return Reader(jobs).run(text)
