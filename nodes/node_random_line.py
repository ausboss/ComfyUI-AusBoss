"""Random Line (AusBoss) — picks one line from a multiline list, driven by a seed."""

import random


class AusBossRandomLine:
    DESCRIPTION = (
        "Picks one line at random from the list — one option per line. "
        "Blank lines and lines starting with # are ignored, so options can "
        "be commented out without deleting them.\n\n"
        "The pick is seed-driven: the same seed always returns the same "
        "line, and setting the seed control to 'randomize' rolls a new one "
        "each queue. Handy for cycling styles, camera angles, or subjects "
        "across runs."
    )
    CATEGORY = "🧰 AusBoss/📝 Text"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lines": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "One option per line. Blank lines and # comments are skipped.",
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                        "tooltip": "Same seed = same pick. Set the control to 'randomize' to reroll each queue.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("line",)
    OUTPUT_TOOLTIPS = ("The chosen line, stripped of surrounding whitespace.",)
    FUNCTION = "run"

    def run(self, lines, seed):
        options = [
            line.strip()
            for line in lines.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        if not options:
            return ("",)
        # Local Random instance so global random state is never disturbed.
        return (random.Random(seed).choice(options),)


NODE_CLASS_MAPPINGS = {"AusBossRandomLine": AusBossRandomLine}
NODE_DISPLAY_NAME_MAPPINGS = {"AusBossRandomLine": "Random Line (AusBoss)"}
