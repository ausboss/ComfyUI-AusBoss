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

from ._h3_script_helpers import LABEL as SETTING_LINE, SIGN_CUE, SPEECH_CUE, clean, read_script

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


# "@1 says", "@1 softly whispers:": a person named right before the marker they say.
SAYS = re.compile(
    r"@(\d+)\s+(?:\w+ly\s+)?(?:says?|said|asks?|whispers?|shouts?|yells?|screams?|mutters?|sings?|raps?|chants?"
    r"|announces?|calls?\s+out|cries|replies|answers?|goes)\b(?:\s+\w+ly)?\s*[:,]?\s*$",
    re.I,
)


def before_each(held):
    """{marker: the words typed before it, back to the end of the last sentence or the last marker}."""
    spans, start = {}, 0
    for found in SPOKEN.finditer(held):
        span = held[start : found.start()]
        spans[found.group(0)] = re.split(r"[.!?;]\s", span)[-1]
        start = found.end()
    return spans


def same_roles(held, answer):
    """Each marker typed right after "@N says" is still said by @N, and each one typed on a sign or a shirt
    is still on one."""
    typed, tidied = before_each(held), before_each(answer)
    for mark, span in typed.items():
        said, now = SAYS.search(span), SAYS.search(tidied.get(mark, ""))
        if said and (not now or now.group(1) != said.group(1)):
            return False
        shown = SIGN_CUE.search(span) and not SPEECH_CUE.search(span)
        if shown and not (SIGN_CUE.search(tidied[mark]) and not SPEECH_CUE.search(tidied[mark])):
            return False
    return True


def reading(text):
    """What the writer reads from the whole script: each spoken line with its shot and timed second, the
    quotes it shows rather than says, the number of cuts and the timed seconds."""
    shot, at, said, shown, times = 0, None, [], [], []
    for moment in read_script(text).moments:
        shot += bool(moment.cut)
        if moment.at is not None:
            at = moment.at
            times.append(moment.at)
        if moment.speech:
            said.append((shot, at, moment.speech))
        else:
            shown += [match.group(1).strip() for match in [re.search(r'"([^"\n]+)"', moment.text)] if match]
    return said, shown, shot, times


def same_reading(typed, tidied):
    """The writer reads the tidied script as it reads the typed one: everything said is still said, in the
    same order, shot and second; nothing it shows on a sign is said; the same cuts and timed seconds. A
    second quote in one sentence, which the writer can't give a voice, may become its own spoken line."""
    said, shown, cuts, times = reading(typed)
    now, _, now_cuts, now_times = reading(tidied)
    rest = iter(now)
    if not all(any(line == other for other in rest) for line in said):
        return False
    return not any(words in [line[2] for line in now] for words in shown) and (cuts, times) == (now_cuts, now_times)


def tidy_line(line, ask, system=TIDY_SYSTEM):
    """One typed line tidied by the model, or as typed when its answer breaks a rule."""
    held, marks, quotes = hold(line)
    longest = min(800, 64 + 3 * len(held.split()))
    answer = LABEL.sub("", str(ask(system, f"Line: {held}\nCleaned:", longest) or "").strip()).strip()
    if "\n" in answer or not answer_ok(held, answer, marks) or not same_roles(held, answer):
        return line
    return put_back(answer, marks, quotes)


def tidy_script(script, ask, system=TIDY_SYSTEM):
    """The script tidied by ask(system, user, longest) one line at a time. Returns (script, tidied). Each
    line's answer is kept only when the whole script still reads the same with it."""
    if not clean(script):
        return script, False
    typed = read_script(script)
    if len(typed.moments) == 1 and not typed.moments[0].speech:
        return script, False  # One idea: Auto prompt fills it out from the line as typed.
    lines = str(script).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = list(lines)
    for index, line in enumerate(lines):
        if not line.strip() or SETTING_LINE.match(clean(line)):
            continue
        tidy = tidy_line(line, ask, system)
        trial = out[:index] + [tidy] + out[index + 1 :]
        if tidy != line and same_reading(script, "\n".join(trial)):
            out = trial
    return ("\n".join(out), True) if out != lines else (script, False)
