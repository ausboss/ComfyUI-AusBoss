"""Tidy up: a small text model rewrites a typed script in plain, ordered sentences.

Each typed line is tidied on its own, so blank lines (cuts), timed lines and the order of lines
never move; camera:, sound:, music: and look: lines are not sent. The model never sees the quoted
words of a line: code holds each one out as SPOKEN (or SPOKEN1, SPOKEN2, ...), the model moves the
markers next to whoever says them, and code puts the words back exactly as typed. A line's answer
is used only when it keeps every marker once and the same @ people, and the writer reads it as it
reads the typed line: the same words said in the same order, each typed "@N says" pair kept, nothing
on a sign said, the same cuts and timed seconds. Any other line goes on as typed. A one-line idea is
left for Auto prompt to fill out.

The instructions were picked from 25 versions tried on Qwen3-VL 8B: right speaker on
38 of 38 lines it had not seen, every check passed on 77 of 79.
"""

from __future__ import annotations

import re

from ._h3_cast_helpers import SAYS_AFTER
from ._h3_script_helpers import LABEL as SETTING_LINE, clean, read_script

TIDY_SYSTEM = (
    'You tidy up lines of a video script.\n'
    '\n'
    'Examples:\n'
    '\n'
    'Line: @2 waves while @1 says SPOKEN\n'
    'Cleaned: @2 waves while @1 says SPOKEN.\n'
    '\n'
    'Line: @1 stares at @2 who goes SPOKEN\n'
    'Cleaned: @1 stares at @2. @2 says SPOKEN.\n'
    '\n'
    'Line: @2 hugs @1 and whispers SPOKEN\n'
    'Cleaned: @2 hugs @1. @2 whispers SPOKEN.\n'
    '\n'
    'Line: @2 tells @1 SPOKEN\n'
    'Cleaned: @2 tells @1 SPOKEN.\n'
    '\n'
    'Line: @2 snaps at @1 SPOKEN\n'
    'Cleaned: @2 snaps at @1 SPOKEN.\n'
    '\n'
    'Line: the nurse checks the chart and says SPOKEN\n'
    'Cleaned: The nurse checks the chart. The nurse says SPOKEN.\n'
    '\n'
    'Line: SPOKEN @1 yells running to the door\n'
    'Cleaned: @1 runs to the door. @1 yells SPOKEN.\n'
    '\n'
    'Line: @1 asks SPOKEN1 n @2 shrugs SPOKEN2\n'
    'Cleaned: @1 asks SPOKEN1. @2 shrugs. @2 says SPOKEN2.\n'
    '\n'
    'Line: shot 1: @1 sits down. shot 2: he smiles at @2 n @2 goes SPOKEN\n'
    'Cleaned: Shot 1: @1 sits down. Shot 2: He smiles at @2. @2 says SPOKEN.\n'
    '\n'
    'Line: Voiceover: SPOKEN the man on the right opens the door\n'
    'Cleaned: The man on the right opens the door as a voiceover says SPOKEN.\n'
    '\n'
    'Line: camera: slow pan left\n'
    '@1 waves at @2 and asks SPOKEN\n'
    'Cleaned: camera: slow pan left\n'
    '@1 waves at @2. @1 asks SPOKEN.\n'
    '\n'
    'Line: the cat jumps on the table\n'
    'Cleaned: The cat jumps on the table.\n'
    '\n'
    'Rules:\n'
    '- Keep @1, @2, @3 exactly as written. Each one is a person. Never give a tag to someone the user did not tag: keep "she", "he", "the man on the left" as the user wrote them.\n'
    '- SPOKEN stands for words someone says out loud. Write each SPOKEN marker exactly once, straight after the person who says it and a speaking verb, like "@2 says SPOKEN."\n'
    '- Put the speaker right before the speaking verb: "@2 says SPOKEN", never "... and says SPOKEN" or "who says SPOKEN".\n'
    '- The one who does the action right before SPOKEN is the speaker, even when another tag comes after the action: in "@1 yells at @2 SPOKEN", @1 yells SPOKEN.\n'
    '- When the user names someone without a tag ("the waiter", "she"), keep those words for them; never swap in a tag or "he".\n'
    "- Keep the user's speaking verb (asks, whispers, shouts, replies).\n"
    '- Add nothing the user did not write: no new actions, sounds, music, camera moves, places, moods or lighting.\n'
    '- Fix spelling and grammar. Use short sentences.\n'
    '- Keep the labels the user wrote, such as "Shot 1:", "camera:" and "sound:", with their words.\n'
    '- Answer with the cleaned line only.\n'
)

QUOTED = re.compile(r'"([^"\n]*)"|“([^”\n]*)”')
HELD = re.compile(r"\x03(\d+)\x03")
TAG = re.compile(r"@(\d+)")
SPOKEN = re.compile(r"\bSPOKEN\d*\b")
LABEL = re.compile(r"^\s*(?:cleaned(?:\s+line)?|answer)\s*:\s*", re.I)


def marker(index, count):
    return "SPOKEN" if count == 1 else f"SPOKEN{index + 1}"


def hold(script):
    """(held script, markers, quotes): each quoted span swapped for its marker, the words as typed.

    Quotes are taken out before any cleanup, so a quote inside a quote or a curly mark can't
    move where one ends. Words in single quotes after "says" become a quote in the cleanup and
    are held out after it."""
    quotes = []

    def keep(words):
        quotes.append(words)
        return f"\x03{len(quotes) - 1}\x03"

    text = QUOTED.sub(lambda match: keep(match.group(1) if match.group(1) is not None else match.group(2)), str(script or ""))
    text = re.sub(r'"([^"\n]*)"', lambda match: keep(match.group(1)), clean(text))
    order = [int(found.group(1)) for found in HELD.finditer(text)]
    marks = {index: marker(place, len(order)) for place, index in enumerate(order)}
    held = HELD.sub(lambda found: marks[int(found.group(1))], text)
    return held, [marks[index] for index in order], [quotes[index] for index in order]


def put_back(answer, marks, quotes):
    """The answer with each marker swapped for its words, in one pass."""
    words = dict(zip(marks, quotes))
    return SPOKEN.sub(lambda found: f'"{words[found.group(0)]}"', answer)


def answer_ok(held, answer, marks):
    """The answer keeps every marker once, the same @ people, and adds no long stretch of its own."""
    if not answer.strip() or sorted(SPOKEN.findall(answer)) != sorted(marks):
        return False
    if sorted(set(TAG.findall(answer))) != sorted(set(TAG.findall(held))):
        return False
    return len(answer) <= 2 * len(held) + 40


def said_pairs(text):
    """(person, words) for each "@N says "words"" typed with the person right before the words."""
    return [(found.group(1), quote.group(1)) for found in SAYS_AFTER.finditer(text)
            for quote in [re.match(r'\s*[:,]?\s*"([^"\n]*)"', text[found.end():])] if quote]


def same_reading(typed, tidied):
    """The writer reads the tidied line as it reads the typed one. Everything said is still said, in the same
    order, by the same named person; a quote the writer shows on a sign or shirt is not said; the cuts and
    timed seconds are the same. A second quote in one sentence, which the writer can't give a voice, may
    become its own spoken line."""
    before, after = read_script(typed), read_script(tidied)
    said = [moment.speech for moment in before.moments if moment.speech]
    now = [moment.speech for moment in after.moments if moment.speech]
    rest = iter(now)
    if not all(any(words == other for other in rest) for words in said):
        return False  # something said is lost, or the order changed
    shown = [match.group(1).strip() for moment in before.moments if not moment.speech
             for match in [re.search(r'"([^"\n]+)"', moment.text)] if match]
    if any(words in now for words in shown):
        return False
    pairs = said_pairs(clean(tidied))
    if any(pair not in pairs for pair in said_pairs(clean(typed))):
        return False
    if sum(moment.cut for moment in before.moments) != sum(moment.cut for moment in after.moments):
        return False
    return [moment.at for moment in before.moments if moment.at is not None] == [moment.at for moment in after.moments if moment.at is not None]


def tidy_line(line, ask):
    """One typed line tidied, or as typed."""
    held, marks, quotes = hold(line)
    longest = min(800, 64 + 3 * len(held.split()))
    answer = LABEL.sub("", str(ask(TIDY_SYSTEM, f"Line: {held}\nCleaned:", longest) or "").strip()).strip()
    if "\n" in answer or not answer_ok(held, answer, marks):
        return line
    answer = put_back(answer, marks, quotes)
    return answer if same_reading(line, answer) else line


def tidy_script(script, ask):
    """The script tidied by ask(system, user, longest) one line at a time. Returns (script, tidied)."""
    if not clean(script):
        return script, False
    typed = read_script(script)
    if len(typed.moments) == 1 and not typed.moments[0].speech:
        return script, False  # One idea: Auto prompt fills it out from the line as typed.
    lines = str(script).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = [line if not line.strip() or SETTING_LINE.match(clean(line)) else tidy_line(line, ask) for line in lines]
    return ("\n".join(out), True) if out != lines else (script, False)
