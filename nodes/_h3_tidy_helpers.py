"""Tidy up: a small text model rewrites a typed script in plain, ordered sentences.

The quoted words never reach the model. Code holds each one out as SPOKEN (or SPOKEN1,
SPOKEN2, ...), the model moves the markers next to whoever says them, and code puts the
words back exactly as typed. An answer that loses or repeats a marker, or changes the
@ tags, is thrown away and the script goes on as typed.

The instructions were picked from 25 versions tried on Qwen3-VL 8B: right speaker on
38 of 38 lines it had not seen, every check passed on 77 of 79.
"""

from __future__ import annotations

import re

from ._h3_script_helpers import clean

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

QUOTED = re.compile(r'"([^"\n]*)"')
TAG = re.compile(r"@\d")
SPOKEN = re.compile(r"\bSPOKEN\d*\b")
LABEL = re.compile(r"^\s*(?:cleaned(?:\s+line)?|answer)\s*:\s*", re.I)


def marker(index, count):
    return "SPOKEN" if count == 1 else f"SPOKEN{index + 1}"


def hold(script):
    """(held script, markers, quotes): each double-quoted span swapped for its marker."""
    found = list(QUOTED.finditer(script))
    marks = [marker(i, len(found)) for i in range(len(found))]
    held, last = [], 0
    for mark, match in zip(marks, found):
        held += [script[last : match.start()], mark]
        last = match.end()
    held.append(script[last:])
    return "".join(held), marks, [match.group(1) for match in found]


def answer_ok(held, answer, marks):
    """The answer keeps every marker once, the same @ tags, and adds no long stretch of its own."""
    if not answer.strip() or sorted(SPOKEN.findall(answer)) != sorted(marks):
        return False
    if sorted(set(TAG.findall(answer))) != sorted(set(TAG.findall(held))):
        return False
    return len(answer) <= 2 * len(held) + 40


def tidy_script(script, ask):
    """The script tidied by ask(system, user, longest), or the script as typed when the answer fails a check.

    Returns (script, tidied)."""
    typed = clean(script)
    if not typed:
        return script, False
    held, marks, quotes = hold(typed)
    longest = min(800, 64 + 3 * len(held.split()))
    answer = LABEL.sub("", str(ask(TIDY_SYSTEM, f"Line: {held}\nCleaned:", longest) or "").strip()).strip()
    if not answer_ok(held, answer, marks):
        return script, False
    for mark, words in zip(marks, quotes):
        answer = re.sub(rf"\b{mark}\b", lambda _match, words=words: f'"{words}"', answer)
    return answer, True
