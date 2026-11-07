"""Finishes a MiniMax H3 prompt.

The words come from a typed scene (_h3_script_helpers.py) or from someone's
own six parts. A voice or a song that is connected adds its lines to the right
parts and takes the next free label. Plain text and numpy, so the tests run
without a server.
"""

from __future__ import annotations

import re

import numpy as np

from ._h3_cast_helpers import EDIT, KEEP, NEEDS_NO_WORDS, ONE_GOES, REVOICE, SWAP, Cast, number_pictures, swap_appearances
from ._h3_cast_helpers import TOKEN
from ._h3_script_helpers import (
    ACTION_GOES_ON,
    PRONOUN,
    SPEECH_VERB,
    Moment,
    add_moments,
    add_sound,
    read_script,
    script_parts,
    speakers,
    voice_of,
    without_speech,
)

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
NO_CHANGE = 'Type what changes in the video, like "He wears @1 in place of his cap."'
VOICE_NO_WORDS = (
    "A voice is connected, but nobody speaks. Put what they say in quotes, or "
    "turn the voice off."
)


def split_sections(text):
    """The six parts of a prompt by name, or None when one is missing."""
    found = {}
    current = None
    for line in text.split("\n"):
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


def spoken_line(speaker, words, language, voice_label, on_screen, number=1, lips="", delivery=""):
    """The sentence that carries the words, with the speaker's mouth stated
    the way H3 needs it: moving and then closed on screen, closed in a
    voiceover. lips names a video whose lip movement the words land on."""
    line = f"<d>[{language}] {words}</d>"
    said = f"says {delivery}" if delivery else "says"
    if not speaker.startswith("<"):  # A thing off screen, like a card reader.
        return f"{speaker} (S{number}) {said} from off screen, {line} Nobody on screen moves their lips to these words."
    if on_screen:
        how = f"{said}, each word landing exactly on the lip movement of {lips}," if lips else f"{said},"
        if voice_label:
            landing = f", each word landing exactly on the lip movement of {lips}," if lips else ""
            how = f"speaks using the voice timbre referenced from {voice_label}{landing} and {said},"
        return (
            f"{speaker} (S{number}) {how} {line} The jaw and lips of {speaker} move "
            f"clearly through every word. {speaker} closes the lips."
        )
    timbre = f" The voiceover follows the voice timbre referenced from {voice_label}." if voice_label else ""
    closed = f" while the on-screen version of {speaker} keeps the lips completely closed."
    return f"{speaker} (S{number}) says in an off-screen voiceover, {line}{closed}{timbre}"


# "Altman is @1" and "@1 is Altman" give a name to a person picture, so a later "Altman says" is @1.
NAME_IS = re.compile(r"\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)\s+(?:is|as|plays)\s+@(\d)\b")
IS_NAME = re.compile(r"@(\d)\s+(?:is|as|plays)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)\b")
NOT_A_NAME = {"The", "A", "An", "He", "She", "They", "It", "This", "That", "Then", "And"}
DELIVERY = re.compile(r"^(?:in|with|like)\b[^\"]*$", re.I)


def names_in(moments):
    """{name: @ number} for every person a swap's lines name."""
    names = {}
    for moment in moments:
        for name, slot in NAME_IS.findall(moment.text):
            if name not in NOT_A_NAME:
                names[name.lower()] = slot
        for slot, name in IS_NAME.findall(moment.text):
            if name not in NOT_A_NAME:
                names[name.lower()] = slot
    return names


LINKING_WORDS = {"the", "a", "an", "in", "on", "at", "of", "with", "by", "to", "and", "from", "into", "who", "is"}


def same_person(said_by, who):
    """Whether "The man in the car" names the person a swap's "the man in the
    back of the police car" points at: every word that says who it is
    appears there too. "The man in the cap" is someone else."""
    def words(text):
        return {word for word in re.findall(r"[a-z']+", text.lower()) if word not in LINKING_WORDS}

    named = words(said_by)
    return bool(named) and named <= words(who)


def only_the_words(moment, names=None, last="", goes=()):
    """A swap line's quoted words and the @ number that says them. The video
    supplies the action, so the rest of the line goes. Who speaks is the @ or
    the name in front of the words, else the person a he or she points back
    to; a thing that is no person, like a card reader, speaks from off screen,
    and so does a person the line puts off screen, like "a woman off camera"."""
    before = moment.text.partition(f'"{moment.speech}"')[0]
    who = TOKEN.search(before)
    slot = who.group(1) if who else ""
    if not slot:
        lowered = before.lower()
        slot = next((number for name, number in (names or {}).items() if re.search(rf"\b{re.escape(name)}\b", lowered)), "")
    if not slot and PRONOUN.search(before):
        slot = last
    words = Moment(f'says "{moment.speech}"', at=moment.at, speech=moment.speech, voiceover=moment.voiceover)
    verb = SPEECH_VERB.search(before)
    if verb and DELIVERY.match(before[verb.end() :].strip(" ,:")):
        words.delivery = before[verb.end() :].strip(" ,:")
    said_by = "" if slot else voice_of(before, True, things=True)
    if said_by and not moment.voiceover:
        slot = next((number for who, number in goes if same_person(said_by, who)), "")
    if slot:
        words.text = f"@{slot} {words.text}"
        return words, slot
    words.voice = voice_of(before, moment.voiceover, things=True)
    words.voiceover = words.voiceover or bool(words.voice)
    words.other = bool(said_by) and not words.voice
    return words, last


# A time typed inside a swap line, not at its start: "Dario, at 3.2s, says" or "(00:03.2)".
TIME_IN_LINE = re.compile(r"\b(?:(\d+):(\d\d(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b)", re.I)


def time_in(text):
    match = TIME_IN_LINE.search(text)
    if not match:
        return None
    if match.group(1) is not None:
        return int(match.group(1)) * 60 + float(match.group(2))
    return float(match.group(3))


def swap_lines(moments, goes=()):
    """What a swap keeps of its typed lines: only the words in quotes. goes
    pairs the words for each person who goes with the @ number coming in, so
    a line said by "the old man" is said by whoever replaces him."""
    names = names_in(moments)
    kept, last = [], ""
    for moment in moments:
        who = TOKEN.search(moment.text)
        if not moment.speech:
            last = who.group(1) if who else last
            continue
        words, last = only_the_words(moment, names, last, goes)
        if words.at is None:
            words.at = time_in(moment.text.partition(f'"{moment.speech}"')[0])
        kept.append(words)
    return kept


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


# In "change something" the person comes from the video, so a picture is what
# gets put on them. Pictures open as "person", and a newcomer types plain words.
PUT_ON = r"(?:wears|wearing|wear|puts on|putting on|put on|has on|dons)"
PUT_ON_TOKEN = re.compile(r"\b" + PUT_ON + r"\s+(?:a |an |the )?@(\d)\b|@(\d)\s+(?:in place of|instead of)\b", re.IGNORECASE)
PUT_ON_WORDS = re.compile(r"\b(" + PUT_ON + r")\s+(.+?)(?=\s+(?:in place of|instead of)\b|[,.;!?\n]|\s+and\s|$)", re.IGNORECASE)


def put_on_from_pictures(script, jobs):
    """For "change something": a picture the line puts on someone is an outfit,
    even if its job says person. With one picture and no @ typed, the thing the
    line puts on him ("wears the propeller hat") is that picture."""
    jobs = dict(jobs)
    if len(jobs) == 1 and not TOKEN.search(script):
        slot = next(iter(jobs))
        script, found = PUT_ON_WORDS.subn(lambda m: f"{m.group(1)} @{slot}", script, count=1)
        if not found:
            return script, jobs
    for match in PUT_ON_TOKEN.finditer(script):
        slot = int(match.group(1) or match.group(2))
        if jobs.get(slot) == "person":
            jobs[slot] = "outfit"
    return script, jobs


def write_prompt(script, seconds=15.0, camera="", look="", sound="", language="English", voice=False, song_beats=None,
                 ask=None, jobs=None, video="", soundtrack=False, clip_sound=False, speech=None):
    """The finished prompt.

    A typed scene is read and laid out over seconds; H3's own six parts go
    through as they are. jobs says what each connected picture is for, as
    {number on the node: job}, and video what a connected video is for.
    soundtrack says a video's own sound is connected, for H3 to carry on from.
    clip_sound says a swap's finished clip keeps the video's own sound, so
    every voice in it is heard: lines from anyone but the people coming in are
    left out, and lines with no typed time go where speech finds them in the
    video's sound, as find_speech stretches.
    voice says whether one is connected. song_beats is None with no song, and
    otherwise the beats to land on, which may be an empty list. With a voice
    too, the song goes under the finished clip and H3 hears none. ask(question,
    longest) puts a question to a small model, if one is connected: it fills in
    a one-line idea and the sound of the place."""
    parts = split_sections(script)
    audio = next_label(script, "Audio")
    speaker = None

    if parts is None:
        jobs = jobs if jobs is not None else {1: "person"}
        if video == EDIT:
            script, jobs = put_on_from_pictures(script, jobs)
        cast = Cast(number_pictures(jobs, video), video)
        script, cast.appearances = swap_appearances(script, jobs, video)
        scene = read_script(script)
        problem = cast.problem(" ".join(moment.text for moment in scene.moments))
        if problem:
            raise ValueError(problem)
        if not scene.moments and video == EDIT:
            raise ValueError(NO_CHANGE)
        if not scene.moments and video not in NEEDS_NO_WORDS:
            raise ValueError(NO_SCRIPT)
        if video == SWAP and scene.moments:  # Typed words in a swap say which person goes, for a clip with two.
            cast.name_who_goes([without_speech(moment) for moment in scene.moments])
            if cast.appearances and cast.clip_clothes:
                raise ValueError('Remove "keep the clip\'s clothes" or the looks like line. This appearance hint replaces the whole look.')
            goes = [(who, str(picture.slot)) for who, picture in zip(cast.whos, cast.swappers) if who != ONE_GOES]
            scene.moments = swap_lines(scene.moments, goes)
        if video == SWAP and clip_sound:
            # On real clips, leaving others' words out kept the right mouth moving; naming them as off screen did not.
            cast.clip_sound = True
            # With no words typed, the clip's own speech is still heard, so the new person says it as the video does.
            cast.typed_lines = any(moment.speech for moment in scene.moments)
            cast.speaks_as_video = bool(speech) and not cast.typed_lines
            time_from_sound(scene.moments, speech)
            scene.moments = [moment for moment in scene.moments if not (moment.voice or moment.other)]
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

        def say(words, on_screen=True, who="<Subject 1>", number=1, delivery=""):
            lips = "<Video 1>" if video in (REVOICE, SWAP, EDIT) else ""
            voiced = voice_label if number == 1 else None
            return spoken_line(who, clean_words(words), language, voiced, on_screen, number, lips, delivery)

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


SPEECH_BAND = (250.0, 3500.0)  # Where most of a voice's loudness sits, under hiss and over hum.
SPEECH_GAP = 0.06  # A shorter quiet is the dip between two syllables. place_lines tells lines apart later.
SPEECH_SHORTEST = 0.1  # A shorter sound is a click or a knock.
VOICE_PITCH = (70.0, 390.0)  # A speaking voice's lowest note, in Hz, and just under where pitch reading tops out.
CLEAR_VOICE = 0.5  # How cleanly a frame repeats before its pitch counts.
PITCH_GRID = tuple(float(x) for x in np.log2(np.geomspace(100, 340, 8)))  # Voices to try, in octaves.
SPEAKING_RATES = tuple(2.5 + 0.75 * step for step in range(8))  # Syllables a second, slow to fast.
LONGEST_LINE = 12  # Stretches of speech one line can take.
# Weights for place_lines, tuned on nine real clips against Whisper's times.
GAP_WEIGHT, INNER_GAP_WEIGHT, NOISE_WEIGHT, PITCH_WEIGHT = 1.0, 1.0, 1.5, 6.0


def find_speech(samples, rate):
    """[(start, end, pitch, voiced), ...]: the stretches of a mono track loud
    enough in the voice band to be words, in seconds, with each stretch's
    middle pitch in octaves (log2 Hz), or None where it has too little clear
    voice, and how many seconds of it are clear voice.

    The quiet level is the track's quietest tenth and the loud level its
    loudest twentieth, so music or a crowd under the words raises the bar
    with them. Returns [] for silence."""
    samples = np.asarray(samples, dtype=np.float32)
    hop = max(1, int(rate * 0.01))
    window = hop * 2
    frames = (len(samples) - window) // hop
    if frames < 8 or float(np.abs(samples).max(initial=0.0)) < 1e-4:
        return []
    taper = np.hanning(window)
    pitches = np.fft.rfftfreq(window, 1.0 / rate)
    band = (pitches >= SPEECH_BAND[0]) & (pitches <= SPEECH_BAND[1])
    level = np.array(
        [float((np.abs(np.fft.rfft(samples[index * hop : index * hop + window] * taper))[band] ** 2).sum()) for index in range(frames)]
    )
    level = 10 * np.log10(level + 1e-10)
    level = np.convolve(level, np.ones(5) / 5, "same")
    quiet, loud = np.percentile(level, 10), np.percentile(level, 95)
    if loud - quiet < 6:
        return []
    heard = level > max(quiet + 0.35 * (loud - quiet), quiet + 6)
    stretches, start = [], None
    for index, on in enumerate([*heard, False]):
        if on and start is None:
            start = index
        elif not on and start is not None:
            stretches.append([start * hop / rate, index * hop / rate])
            start = None
    joined = []
    for stretch in stretches:
        if joined and stretch[0] - joined[-1][1] < SPEECH_GAP:
            joined[-1][1] = stretch[1]
        else:
            joined.append(stretch)
    voice = voice_pitch(samples, rate, loudest=float(level.max()))
    return [(round(a, 3), round(b, 3), *middle_pitch(voice, a, b)) for a, b in joined if b - a >= SPEECH_SHORTEST]


def voice_pitch(samples, rate, loudest):
    """(times, octaves, clear) every 20 ms: the pitch where a frame repeats
    best, and whether it repeats cleanly and loudly enough to be a voice."""
    hop = max(1, int(rate * 0.02))
    window = hop * 2
    frames = max(0, (len(samples) - window) // hop)
    shortest, longest = int(rate / VOICE_PITCH[1]), int(rate / VOICE_PITCH[0])
    taper = np.hanning(window)
    pitches = np.fft.rfftfreq(window, 1.0 / rate)
    band = (pitches >= SPEECH_BAND[0]) & (pitches <= SPEECH_BAND[1])
    times, octaves, clear = [], [], []
    for index in range(frames):
        piece = samples[index * hop : index * hop + window]
        loud = 10 * np.log10(float((np.abs(np.fft.rfft(piece * taper))[band] ** 2).sum()) + 1e-10)
        piece = piece - piece.mean()
        repeats = np.fft.irfft(np.abs(np.fft.rfft(piece, 2 * window)) ** 2)[:window]
        lag = shortest + int(np.argmax(repeats[shortest:longest])) if repeats[0] > 1e-9 else 0
        times.append(index * hop / rate + window / 2 / rate)
        octaves.append(float(np.log2(rate / lag)) if lag else 0.0)
        clear.append(bool(lag) and repeats[lag] / repeats[0] >= CLEAR_VOICE and loud >= loudest - 30 and lag > shortest)
    return np.array(times), np.array(octaves), np.array(clear, dtype=bool)


def middle_pitch(voice, start, end):
    """(the middle pitch in octaves, or None, and the seconds of clear voice) between start and end."""
    times, octaves, clear = voice
    inside = clear & (times >= start) & (times < end)
    if inside.sum() < 3:
        return None, 0.0
    return round(float(np.median(octaves[inside])), 3), round(float(inside.sum() * (times[1] - times[0])), 3)


def syllables(words):
    """About how many syllables the words take to say."""
    count = 0
    for word in re.findall(r"[a-z']+", words.lower()):
        sounds = len(re.findall(r"[aeiouy]+", word))
        count += max(1, sounds - (1 if word.endswith("e") and sounds > 1 else 0))
    return max(1, count)


def place_lines(stretches, lines):
    """When each line starts, read from find_speech stretches. lines are
    (words, voice) in order, where voice tells one speaker from another.

    Each line takes a run of stretches, and a stretch may be left out as
    noise. The best split gives each line about the time its syllables need,
    starts lines after long quiets, keeps quiets inside a line short and
    keeps one voice at one pitch. None when there are fewer stretches than
    lines."""
    count, found = len(lines), len(stretches)
    if count < 1 or found < count:
        return None
    sizes = [syllables(words) for words, _ in lines]
    voices = sorted({voice for _, voice in lines})
    best = (np.inf, None)
    for middles in _pitch_choices(len(voices)):
        middle = dict(zip(voices, middles))
        for speed in SPEAKING_RATES:
            cost, starts = _best_split(stretches, lines, [size / speed for size in sizes], middle)
            cost += 0.3 * np.log(speed / 4.5) ** 2
            if starts is not None and cost < best[0]:
                best = (cost, starts)
    return best[1]


def _pitch_choices(voices):
    choices = [()]
    for _ in range(voices):
        choices = [(*choice, pitch) for choice in choices for pitch in PITCH_GRID]
    return choices


def _best_split(stretches, lines, needs, middle):
    found, count = len(stretches), len(lines)
    best = [[(np.inf, None)] * (count + 1) for _ in range(found + 1)]
    best[0][0] = (0.0, [])
    for first in range(found):
        for done in range(count + 1):
            cost, starts = best[first][done]
            if cost == np.inf:
                continue
            start, end = stretches[first][:2]
            noise = cost + NOISE_WEIGHT * (end - start) + 0.2
            if noise < best[first + 1][done][0]:
                best[first + 1][done] = (noise, starts)
            if done == count:
                continue
            before = min(start - stretches[first - 1][1], 1.0) if first else 1.0
            spoken = inner = off_pitch = 0.0
            for last in range(first, min(found, first + LONGEST_LINE)):
                a, b, pitch, voiced = stretches[last]
                spoken += b - a
                if last > first:
                    inner += max(0.0, a - stretches[last - 1][1] - 0.25)
                if pitch is not None:
                    off_pitch += min((pitch - middle[lines[done][1]]) ** 2, 1.0) * voiced
                after = min(stretches[last + 1][0] - b, 1.0) if last + 1 < found else 1.0
                total = (
                    cost
                    + np.log(spoken / needs[done]) ** 2
                    + INNER_GAP_WEIGHT * inner
                    - GAP_WEIGHT * (before + after) / 2
                    + PITCH_WEIGHT * off_pitch
                )
                if total < best[last + 1][done + 1][0]:
                    best[last + 1][done + 1] = (total, [*starts, start])
    return best[found][count]


def time_from_sound(moments, stretches):
    """Puts each line with no typed time where its words start in the clip's
    own sound. Every quoted line counts, whoever says it, since everyone is
    heard. Returns whether the sound gave the times."""
    lines = [(moment.speech, "other" if moment.voice or moment.other else "new") for moment in moments]
    starts = place_lines(stretches or [], lines)
    if starts is None:
        return False
    for moment, start in zip(moments, starts):
        if moment.at is None:
            moment.at = round(float(start), 3)
    return True
