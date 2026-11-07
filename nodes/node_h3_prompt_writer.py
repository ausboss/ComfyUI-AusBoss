"""H3 Prompt Writer 🆎."""

from __future__ import annotations

import sys

from ._h3_cast_helpers import EDIT, JOBS, KEEP, KEEPS_ITS_LENGTH, PERSON, PLACE, START, SWAP, THING, VIDEO_JOBS
from ._h3_prompt_helpers import find_beats, find_speech, split_sections, write_prompt
from ._h3_script_helpers import CAMERAS, LOOKS, script_report
from ._route_errors import safe_route_error


VOICE_SECONDS = 15.0  # A longer clip only costs memory.
SONG_UNDER_LEVEL = 0.035  # H3 speaks at about 0.05, so the words stay clear.
FRAME_RATE = 24
LONGEST_SECONDS = 15
KEEP_FRAMES = 44  # What H3 reads to carry a clip on: about its last 2 seconds. H3 reads a video from its start.
LONGEST_SCRIPT = 20000  # All the timeline reads of what is sent to it.
PICTURES = (1, 2, 3, 4)
NO_SHAPE = (1344, 756)  # For a pasted prompt with nothing connected: H3's own width, wide.

AS_TYPED = "as typed"
FROM_PICTURE = "from the picture"

JOB_HELP = (
    "What this picture is for. Person goes wherever your lines say. Place is where it happens. Outfit and thing work "
    "best with nobody in the picture. Style gives only the look. Start on it and end on it fix the first or last moment."
)
NEEDS_TEXT_GENERATE = "This ComfyUI has no Generate Text node. Update ComfyUI, or disconnect the model on clip."
SAMPLING = {
    "sampling_mode": "on",
    "temperature": 0.5,
    "top_k": 20,
    "top_p": 0.9,
    "min_p": 0.0,
    "repetition_penalty": 1.0,
    "presence_penalty": 0.0,
    "seed": 1,
}


def _core_nodes() -> dict:
    """ComfyUI's own node classes, by key. Empty outside ComfyUI."""
    mappings = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", None)
    return mappings if isinstance(mappings, dict) else {}


def with_sound_and_music(script, sound, music):
    """The Sound and Music boxes, as the whole-clip sound: and music: lines a script can carry.

    H3's own six parts go through as they are, so the boxes add nothing to them."""
    extra = [f"{name}: {text.strip()}" for name, text in (("sound", sound), ("music", music)) if str(text or "").strip()]
    if not extra or split_sections(script) is not None:
        return script
    return "\n\n".join([script.rstrip(), *extra]) if script.strip() else "\n\n".join(extra)


def model_asker(clip, image):
    """ask(question, longest) for a text model, by ComfyUI's own Generate Text."""
    generate = _core_nodes().get("TextGenerate")
    if generate is None or not hasattr(generate, "execute"):
        raise RuntimeError(NEEDS_TEXT_GENERATE)

    def ask(question, longest):
        output = generate.execute(clip=clip, prompt=question, max_length=longest, sampling_mode=SAMPLING, image=image)
        return output.result[0]

    return ask


def fill_picture(pictures, jobs):
    """What the small model may look at: the scene, never a person's photo, whose place may not be the clip's."""
    return next((pictures[slot] for job in (PLACE, START) for slot in pictures if jobs.get(slot) == job), None)


def clip_shape(video, picture):
    """(width, height) of the clip: the video's when there is one, or else the first picture's."""
    source = video if video is not None else picture
    if source is None:
        return NO_SHAPE
    return int(source.shape[2]), int(source.shape[1])


def clip_frames(seconds):
    """The nearest length H3 can make: 5 frames plus steps of 17."""
    return max(1, round((seconds * FRAME_RATE - 5) / 17)) * 17 + 5


def video_frames(frames):
    """A clip's own length, on H3's grid and within what it can make."""
    longest = LONGEST_SECONDS * FRAME_RATE
    return max(1, (min(frames, longest) - 5) // 17) * 17 + 5


def cut_audio(audio, start, seconds, name):
    """The part of a ComfyUI AUDIO that H3 should hear."""
    rate = int(audio["sample_rate"])
    waveform = audio["waveform"]
    first = int(round(start * rate))
    if first >= waveform.shape[-1]:
        raise ValueError(f"{name} ends before the second it should start from. Pick an earlier start.")
    return {"waveform": waveform[..., first : first + int(round(seconds * rate))], "sample_rate": rate}


def last_of_clip(video, sound):
    """The end of a clip, picture and sound, to carry on from."""
    if sound is not None:
        rate = int(sound["sample_rate"])
        sound = {"waveform": sound["waveform"][..., -int(round(KEEP_FRAMES / FRAME_RATE * rate)) :], "sample_rate": rate}
    return video[-KEEP_FRAMES:], sound


def under_voice(song):
    """A song at one steady level, so a loud master sits as low as a quiet one. It is never turned up."""
    waveform = song["waveform"]
    level = float(waveform.pow(2).mean().sqrt())
    return {"waveform": waveform * min(1.0, SONG_UNDER_LEVEL / max(level, 1e-6)), "sample_rate": song["sample_rate"]}


def mono_samples(audio):
    """One channel of a ComfyUI AUDIO, as numbers."""
    return audio["waveform"][0].mean(dim=0).float().cpu().numpy()


class AusBossH3PromptWriter:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "Type what happens, one line for each moment, and leave a blank line to "
        "cut to a new place. Connect up to four pictures, give each one a job "
        "such as person, place or outfit, and name them @1 and @2 in your "
        "lines. Connect a video to copy its moves or carry it on. Add a voice "
        "or a song and it writes the lines H3 needs. H3's own six parts go "
        "through as they are. Connect a small text model and it fills in a "
        "one-line idea."
    )
    SEARCH_ALIASES = [
        "h3 prompt",
        "minimax prompt",
        "pika prompt",
        "scene script",
        "timeline",
        "cut on beat",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "script": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": False,
                        "tooltip": (
                            "What happens, one line for each moment. A blank "
                            "line cuts to a new place. @1 is Picture 1. Start "
                            "a line with 3s: to put it on that second."
                        ),
                    },
                ),
                "seconds": (
                    "INT",
                    {
                        "default": 8,
                        "min": 5,
                        "max": 15,
                        "step": 1,
                        "tooltip": "How long the clip is. Plan on about one moment a second at most.",
                    },
                ),
            },
            "optional": {
                "clip": (
                    "CLIP",
                    {
                        "tooltip": (
                            "Optional: a small text model such as Qwen3-VL 8B. It adds "
                            "moments after a one-line idea and matches the sound to the place."
                        ),
                    },
                ),
                "picture_1": ("IMAGE", {"tooltip": "Your first picture. Type @1 to name it in a line."}),
                "picture_2": ("IMAGE", {"tooltip": "Optional: a second picture, with its own job. Type @2 to name it."}),
                "picture_3": ("IMAGE", {"tooltip": "Optional: a third picture, with its own job. Type @3 to name it."}),
                "picture_4": ("IMAGE", {"tooltip": "Optional: a fourth picture, with its own job. Type @4 to name it."}),
                "video": ("IMAGE", {"tooltip": "Optional: the frames of a video. Pick what it is for under Video does."}),
                "video_sound": (
                    "AUDIO",
                    {"tooltip": "Optional: the video's own sound. Only keep going uses it."},
                ),
                "voice": (
                    "AUDIO",
                    {"tooltip": "A clip of the voice to use, about 10 seconds."},
                ),
                "song": (
                    "AUDIO",
                    {"tooltip": "The music to use. Each moment moves onto its beat."},
                ),
                "camera": (
                    [AS_TYPED, *CAMERAS],
                    {
                        "default": AS_TYPED,
                        "tooltip": "How the camera moves the whole way through. As typed leaves it to your words.",
                    },
                ),
                "look": (
                    [FROM_PICTURE, *LOOKS],
                    {
                        "default": FROM_PICTURE,
                        "tooltip": "From the picture keeps your photo's look. The others redraw it in that style.",
                    },
                ),
                "song_start": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.1,
                        "tooltip": (
                            "The second of the song to start from, so the "
                            "clip gets the good part."
                        ),
                    },
                ),
                "cut_on_beat": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Moves each moment onto the nearest beat of the "
                            "song. Pick off to keep your own seconds."
                        ),
                    },
                ),
                "language": (
                    "STRING",
                    {
                        "default": "English",
                        "dynamicPrompts": False,
                        "tooltip": "The language of the words in quotes.",
                    },
                ),
                "job_1": (list(JOBS), {"default": PERSON, "tooltip": JOB_HELP}),
                "job_2": (list(JOBS), {"default": PERSON, "tooltip": JOB_HELP}),
                "job_3": (list(JOBS), {"default": PERSON, "tooltip": JOB_HELP}),
                "job_4": (list(JOBS), {"default": THING, "tooltip": JOB_HELP}),
                "video_job": (
                    list(VIDEO_JOBS),
                    {
                        "default": VIDEO_JOBS[0],
                        "tooltip": (
                            "What the video is for: copy its moves, swap the person in it, keep it going, give it "
                            "a new voice, or change something in it and keep the person (a hat, a shirt). Swap, "
                            "new voice and change something ignore Seconds and keep the video's length."
                        ),
                    },
                ),
                "sound": (
                    "STRING",
                    {
                        "default": "",
                        "dynamicPrompts": False,
                        "tooltip": "What you hear the whole way through, like rain on a window. Leave it empty for none.",
                    },
                ),
                "music": (
                    "STRING",
                    {
                        "default": "",
                        "dynamicPrompts": False,
                        "tooltip": "The music, like a slow lo-fi beat. A clip with music comes out louder. Empty means no music.",
                    },
                ),
                "clip_sound": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Turn on when a swap keeps the video's own sound. Each line is timed from that sound, "
                            "and words from anyone else are left out so only the new person's mouth moves."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "AUDIO", "AUDIO", "AUDIO", "AUDIO", "INT", "INT", "INT", "BOOLEAN")
    RETURN_NAMES = (
        "prompt",
        "picture_1",
        "picture_2",
        "picture_3",
        "picture_4",
        "video",
        "video_sound",
        "voice",
        "song",
        "song_under",
        "frames",
        "width",
        "height",
        "keeps_clip_sound",
    )
    OUTPUT_TOOLTIPS = (
        "The finished prompt. Wire it into H3's prompt.",
        "Your pictures in the order the prompt counts them. Wire it into H3's first ref_image.",
        "The next picture. Wire it into H3's second ref_image. Empty when there is no such picture.",
        "The next picture. Wire it into H3's third ref_image. Empty when there is no such picture.",
        "The next picture. Wire it into H3's fourth ref_image. Empty when there is no such picture.",
        "The video, or only its end to keep going from. Wire it into H3's first ref_video.",
        "The video's sound, when it should reach H3. Wire it into H3's first ref_video_audio.",
        "The voice, 15 seconds at most. Wire it into H3's first ref_audio.",
        "The song, cut to the clip. Wire it into H3's next ref_audio. Empty when a voice is connected too.",
        "With a voice and a song, the song to mix under the finished clip's sound. Wire it into Audio Merge.",
        "The clip's length in frames. Wire it into H3's length.",
        "The width of your video, or else of your first picture. Wire it into H3's width.",
        "The height of your video, or else of your first picture. Wire it into H3's height.",
        "On when the finished clip should keep your video's own sound: with clip_sound on, or always for change something.",
    )
    FUNCTION = "write"

    def write(self, script, seconds, clip=None, picture_1=None, picture_2=None, picture_3=None, picture_4=None, video=None,
              video_sound=None, voice=None, song=None, camera=AS_TYPED, look=FROM_PICTURE, song_start=0.0, cut_on_beat=True,
              language="English", job_1=PERSON, job_2=PERSON, job_3=PERSON, job_4=THING, video_job=VIDEO_JOBS[0],
              sound="", music="", clip_sound=False):
        # A clip that keeps its own sound has no room for a score: the finished clip plays the video's sound.
        if video is not None and (video_job == EDIT or (video_job == SWAP and clip_sound)):
            music = ""
        script = with_sound_and_music(script, sound, music)
        pictures = {1: picture_1, 2: picture_2, 3: picture_3, 4: picture_4}
        given = {slot: picture for slot, picture in pictures.items() if picture is not None}
        kinds = {1: job_1, 2: job_2, 3: job_3, 4: job_4}
        jobs = {slot: kinds[slot] for slot in given}
        video_job = "" if video is None else video_job
        frames = clip_frames(seconds)
        if video_job in KEEPS_ITS_LENGTH:
            frames = video_frames(video.shape[0])
            seconds = frames / FRAME_RATE
        length = frames / FRAME_RATE
        keeps_clip_sound = video is not None and (bool(clip_sound) or video_job == EDIT)
        clip_sound = bool(clip_sound) and video_job == SWAP
        speech = find_speech(mono_samples(video_sound), video_sound["sample_rate"]) if clip_sound and video_sound is not None else None
        if video_job == KEEP:
            video, video_sound = last_of_clip(video, video_sound)
        else:
            video_sound = None
        if voice is not None:
            voice = cut_audio(voice, 0.0, VOICE_SECONDS, "Your voice")
        song_beats = song_under = None
        if song is not None:
            song = cut_audio(song, song_start, length, "Your song")
            song_beats = find_beats(mono_samples(song), song["sample_rate"]) if cut_on_beat else []
            if voice is not None:
                song_under = under_voice(song)
                song = None
        text = write_prompt(
            script,
            seconds=seconds,
            camera="" if camera == AS_TYPED else camera,
            look="" if look == FROM_PICTURE else look,
            language=language,
            voice=voice is not None,
            song_beats=song_beats,
            ask=None if clip is None else model_asker(clip, fill_picture(given, jobs)),
            jobs=jobs,
            video=video_job,
            soundtrack=video_sound is not None,
            clip_sound=clip_sound,
            speech=speech,
        )
        ordered = [*given.values(), None, None, None, None][: len(PICTURES)]
        return (text, *ordered, video, video_sound, voice, song, song_under, frames, *clip_shape(video, ordered[0]), keeps_clip_sound)


def _register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    if getattr(PromptServer.instance, "_ausboss_h3_writer_routes", False):
        return
    PromptServer.instance._ausboss_h3_writer_routes = True

    @PromptServer.instance.routes.post("/ausboss/h3_writer/read")
    async def read(request):
        try:
            body = await request.json()
            seconds = min(max(int(body.get("seconds", 8)), 5), LONGEST_SECONDS)
            jobs = {int(slot): job for slot, job in dict(body.get("jobs") or {}).items() if job in JOBS and int(slot) in PICTURES}
            video = body.get("video") if body.get("video") in VIDEO_JOBS else ""
            return web.json_response(script_report(str(body.get("script", ""))[:LONGEST_SCRIPT], seconds, jobs, video))
        except (TypeError, ValueError) as error:
            return web.json_response({"error": safe_route_error(error)}, status=400)


_register_routes()

NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_H3PromptWriter": AusBossH3PromptWriter}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_H3PromptWriter": "H3 Prompt Writer 🆎"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
