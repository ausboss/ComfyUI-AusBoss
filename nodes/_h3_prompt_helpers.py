"""Finishes a MiniMax H3 prompt.

The words come from a typed scene (_h3_script_helpers.py) or from someone's
own six parts. A voice or a song that is connected adds its lines to the right
parts and takes the next free label. Plain text and numpy, so the tests run
without a server.
"""

from __future__ import annotations

import re

import numpy as np

from ._h3_cast_helpers import KEEP, NEEDS_NO_WORDS, REVOICE, SWAP, Cast, number_pictures
from ._h3_script_helpers import ACTION_GOES_ON, Moment, add_moments, add_sound, lower_first, read_script, script_parts, speakers

SECTIONS = (
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
)

CUT = re.compile(r"(\bAt )(\d\d):(\d\d\.\d{3})")

NO_SCRIPT = "Type what happens first: one line for each moment."
VOICE_NO_WORDS = (
    "A voice is connected, but nobody speaks. Put what they say in quotes, or "
    "turn the voice off."
)


def split_sections(text):
    """The six parts of a prompt by name, or None when one is missing."""
    found = {}
    current = None
    for line in text.splitlines():
        name = line.strip().rstrip(":")
        if line.strip().endswith(":") and name in SECTIONS:
            current = found.setdefault(name, [])
        elif current is not None:
            current.append(line)
    if len(found) != len(SECTIONS):
        return None
    return {name: "\n".join(found[name]).strip() for name in SECTIONS}


def join_sections(parts):
    return "\n\n".join(f"{name}:\n{parts[name]}" for name in SECTIONS)


def next_label(text, kind):
    """The next free number of a label kind: <Audio 1> in use makes it 2."""
    used = [int(number) for number in re.findall(rf"<{kind} (\d+)>", text)]
    return max(used, default=0) + 1


def one_line(text):
    return " ".join((text or "").split())


def clean_words(text):
    """Spoken words: one line, no tags, ending the way H3 wants a line to end."""
    text = one_line(text).replace("<", "").replace(">", "")
    if text and text[-1] not in ".?!":
        text += "."
    return text


def add_task(summary, task):
    """Adds a task to the [a + b] tag the summary opens with."""
    match = re.match(r"\[([^\]]*)\]", summary)
    if match is None:
        return f"[{task}] {summary}"
    tasks = [part.strip() for part in match.group(1).split("+")]
    if task not in tasks:
        tasks.append(task)
    return "[" + " + ".join(tasks) + "]" + summary[match.end() :]


def spoken_line(speaker, words, language, voice_label, on_screen, number=1, lips=""):
    """The sentence that carries the words, with the speaker's mouth stated
    the way H3 needs it: moving and then closed on screen, closed in a
    voiceover. lips names a video whose lip movement the words land on."""
    line = f"<d>[{language}] {words}</d>"
    if on_screen:
        how = "says,"
        if voice_label:
            landing = f", each word landing exactly on the lip movement of {lips}," if lips else ""
            how = f"speaks using the voice timbre referenced from {voice_label}{landing} and says,"
        return (
            f"{speaker} (S{number}) {how} {line} The jaw and lips of {speaker} move "
            f"clearly through every word. {speaker} closes the lips."
        )
    timbre = f" The voiceover follows the voice timbre referenced from {voice_label}." if voice_label else ""
    closed = f" while the on-screen version of {speaker} keeps the lips completely closed."
    return f"{speaker} (S{number}) says in an off-screen voiceover, {line}{closed}{timbre}"


def snap_cuts(detailed, beats, gap=0.4):
    """Moves every timed moment to the nearest beat, keeping them in order and
    at least `gap` seconds apart."""
    last = 0.0

    def move(match):
        nonlocal last
        time = int(match.group(2)) * 60 + float(match.group(3))
        options = [beat for beat in beats if beat >= last + gap]
        if options:
            time = min(options, key=lambda beat: abs(beat - time))
        last = time
        minutes, seconds = divmod(time, 60)
        return f"{match.group(1)}{int(minutes):02d}:{seconds:06.3f}"

    return CUT.sub(move, detailed)


def add_voice(parts, label, speaker=None):
    speaker = speaker or ("<Subject 1>" if "<Subject 1>" in parts["subject_definitions"] else None)
    who = f"{speaker} (S1)" if speaker else "the off-screen voice (S1)"
    parts["subject_definitions"] += f"\n{label} is the voice-timbre reference for {who}."
    parts["summary"] = add_task(parts["summary"], "audio reference")
    guided = speaker or "the off-screen voice"
    parts["summary"] += f" {label} guides the voice timbre of {guided} without copying the original audio signal."
    parts["retention_analysis"] += (
        f"\n{label}: reference - the target speaker follows {label}'s voice "
        "timbre and delivery without copying the source signal."
    )


def cut_on_beat(parts, beats):
    if beats:
        parts["detailed_description"] = snap_cuts(parts["detailed_description"], beats).replace(
            "the camera cuts to", "the camera cuts on the beat to"
        )


def add_song(parts, label, beats):
    parts["subject_definitions"] += f"\n{label} is the complete source soundtrack reused in the target video."
    parts["summary"] = add_task(parts["summary"], "audio reuse")
    if beats:
        parts["summary"] += f" Every moment lands on a beat of {label}."
    parts["retention_analysis"] += (
        f"\n{label}: fully_copy - {label} is reused 1:1 as the target video's complete final audio track."
    )
    parts["overall_soundscape"] = "N/A"
    parts["non_diegetic_music"] = f"{label} is directly reused as the complete audience-only score."
    cut_on_beat(parts, beats)


def add_song_under(parts, beats):
    """A song to lay under the finished clip. H3 drops a song it is asked to
    keep when someone also speaks, so it hears none and makes no music."""
    parts["non_diegetic_music"] = "N/A"
    cut_on_beat(parts, beats)


def write_prompt(script, seconds=15.0, camera="", look="", sound="", language="English", voice=False, song_beats=None,
                 ask=None, jobs=None, video="", soundtrack=False):
    """The finished prompt.

    A typed scene is read and laid out over seconds; H3's own six parts go
    through as they are. jobs says what each connected picture is for, as
    {number on the node: job}, and video what a connected video is for.
    soundtrack says a video's own sound is connected, for H3 to carry on from.
    voice says whether one is connected. song_beats is None with no song, and
    otherwise the beats to land on, which may be an empty list. With a voice
    too, the song goes under the finished clip and H3 hears none. ask(question,
    longest) puts a question to a small model, if one is connected: it fills in
    a one-line idea and the sound of the place."""
    parts = split_sections(script)
    audio = next_label(script, "Audio")
    speaker = None

    if parts is None:
        cast = Cast(number_pictures(jobs if jobs is not None else {1: "person"}, video), video)
        scene = read_script(script)
        problem = cast.problem(" ".join(moment.text for moment in scene.moments))
        if problem:
            raise ValueError(problem)
        if not scene.moments and video not in NEEDS_NO_WORDS:
            raise ValueError(NO_SCRIPT)
        if video == SWAP and scene.moments:  # Typed words in a swap say which person goes, for a clip with two.
            cast.who = lower_first(" ".join(moment.text for moment in scene.moments).rstrip(". "))
            scene.moments = []
        if not scene.moments:
            scene.moments.append(Moment(ACTION_GOES_ON if video == KEEP else ""))
        if voice and not any(moment.speech for moment in scene.moments):
            raise ValueError(VOICE_NO_WORDS)
        if ask is not None:
            add_moments(scene, seconds, ask, jobs)
            add_sound(scene, ask, jobs)
        audio += soundtrack and video == KEEP
        speaker = next(iter(speakers(scene.moments, cast)), None)

    voice_label = f"<Audio {audio}>" if voice else None
    language = one_line(language) or "English"

    if parts is None:

        def say(words, on_screen=True, who="<Subject 1>", number=1):
            lips = "<Video 1>" if video == REVOICE else ""
            return spoken_line(who, clean_words(words), language, voice_label if number == 1 else None, on_screen, number, lips)

        keeps_song = song_beats is not None and not voice  # The song is then all the sound there is.
        parts = script_parts(
            scene, seconds, camera=camera, look=look, sound=sound, say=say, cast=cast, sounds=not keeps_song, soundtrack=soundtrack
        )

    if voice:
        add_voice(parts, voice_label, speaker)
    if song_beats is not None and voice:
        add_song_under(parts, song_beats)
    elif song_beats is not None:
        add_song(parts, f"<Audio {audio}>", song_beats)
    return re.sub(r"[ \t]{2,}", " ", join_sections(parts)).replace(" \n", "\n").strip()


def find_beats(samples, rate, seconds=30.0):
    """Beat times in seconds of a mono track, read as one steady grid.

    Listens for the moments the sound jumps, finds the tempo that lines up
    with the most of them, then tries every offset of that grid. A clip is 15
    seconds at most, so a steady grid is close enough, and the first 30
    seconds are plenty. Returns [] for silence."""
    samples = np.asarray(samples, dtype=np.float32)[: int(seconds * rate)]
    hop = max(1, round(rate * 256 / 22050))
    window = hop * 4
    frames = (len(samples) - window) // hop
    if frames < 8 or float(np.abs(samples).max(initial=0.0)) < 1e-4:
        return []
    taper = np.hanning(window)
    spectra = np.stack(
        [np.abs(np.fft.rfft(samples[index * hop : index * hop + window] * taper)) for index in range(frames)]
    )
    rise = np.maximum(np.diff(np.log1p(1000 * spectra), axis=0), 0).sum(axis=1)
    rise = np.maximum(rise - np.convolve(rise, np.ones(43) / 43, "same"), 0)
    if rise.max() <= 0:
        return []
    rise = rise / rise.max()

    per_second = rate / hop
    repeat = np.fft.irfft(np.abs(np.fft.rfft(rise, 2 * len(rise))) ** 2)[: len(rise)]
    low, high = int(per_second * 60 / 190), min(int(per_second * 60 / 55), len(rise) - 1)
    if high <= low:
        return []
    lags = np.arange(low, high)
    leaning = np.exp(-0.5 * (np.log2(60 * per_second / lags / 110)) ** 2)  # people tap near 110 BPM
    guess = lags[int(np.argmax(repeat[low:high] * leaning))]

    best = (-1.0, 0.0, float(guess))
    for period in np.arange(guess * 0.97, guess * 1.03, 0.02):
        grid = np.arange(0.0, len(rise) - 1, period)
        for offset in np.arange(0.0, period, 0.5):
            hits = np.round(grid + offset).astype(int)
            hits = hits[hits < len(rise)]
            score = float(rise[hits].mean()) if len(hits) else 0.0
            if score > best[0]:
                best = (score, float(offset), float(period))
    _, offset, period = best
    # A frame is heard at the middle of its window, one step on from where it starts.
    start = offset / per_second + (window / 2 + hop) / rate
    step = period / per_second
    count = int((len(samples) / rate - start) / step) + 1
    return [round(start + index * step, 3) for index in range(max(count, 0))]
