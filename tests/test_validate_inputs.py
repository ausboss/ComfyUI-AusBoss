"""Each node's VALIDATE_INPUTS names only the inputs it reads.

ComfyUI treats the inputs a VALIDATE_INPUTS signature names specially: it
skips its own range and list checks for them, and when the check fails it
files the message once per named input (naming input_types also switches
off its link-type checks for the whole node). A signature that takes
**kwargs names every input, so one missing picture came back as twenty
identical errors and nothing else on the node was checked at all.

The signature rules are read from the source and run anywhere (CI included).
The rest drive ComfyUI's own validation and need ComfyUI's Python:

    AUSBOSS_COMFY_ROOT=<ComfyUI> python tests/test_validate_inputs.py
"""

from __future__ import annotations

from pathlib import Path
import ast
import asyncio
import inspect
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_node_api import COMFY_ROOT, load_pack

ROOT = Path(__file__).resolve().parent.parent
VALIDATORS = ("VALIDATE_INPUTS", "validate_inputs")

# What each validator reads. Naming an input switches ComfyUI's own checks
# off for it and repeats a failure on it, so every name here is on purpose:
# a source that must take files ComfyUI has not listed (uploads, subfolders,
# MaskEditor saves), a LoRA stack in JSON, or a value the check needs.
# Image Folder looks its folder up inside the chosen source, so it reads both.
NAMED = {
    "AusBossImageCropRotatePad": ["image"],
    "AusBossImageFolder": ["source", "folder"],
    "AusBossLaMaInpaint": ["model"],
    "AusBossLoadImagePad": ["image", "source_image"],
    "AusBossLoadVideo": ["video"],
    "AusBossLoraLoader": ["loras", "on_missing"],
    "AusBossSaveImage": ["exact_name", "filename_prefix", "output_dir"],
    "AusBossStitchInpaint": ["seam"],
    "AusBossVideoCropRotatePad": ["video", "source_mode", "local_path"],
    "AusBossVideoCropRotatePadClip": ["video", "source_mode", "local_path"],
}


def validators_in(source: str, filename: str) -> dict[str, ast.FunctionDef]:
    """Class name -> its validator function, for one module."""
    found = {}
    for node in ast.walk(ast.parse(source, filename)):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in VALIDATORS:
                    found[node.name] = item
    return found


def pack_validators() -> dict[str, tuple[str, ast.FunctionDef]]:
    found = {}
    for path in sorted((ROOT / "nodes").glob("*.py")):
        for name, function in validators_in(path.read_text(encoding="utf-8"), path.name).items():
            found[name] = (path.name, function)
    return found


class SignatureRuleTests(unittest.TestCase):
    def test_no_validator_takes_every_input(self):
        problems = [
            f"{filename}:{function.lineno} {name}.{function.name}(**{function.args.kwarg.arg})"
            for name, (filename, function) in pack_validators().items()
            if function.args.kwarg is not None
        ]
        self.assertEqual(
            problems, [],
            "**kwargs switches off ComfyUI's range and list checks for every input and "
            "repeats one failure per input; name only what the check reads.",
        )

    def test_validators_name_what_they_read(self):
        named = {
            name: [arg.arg for arg in function.args.args[1:] + function.args.kwonlyargs]
            for name, (_filename, function) in pack_validators().items()
        }
        self.assertEqual(named, NAMED)

    def test_the_rule_sees_kwargs(self):
        source = "class N:\n    @classmethod\n    def VALIDATE_INPUTS(cls, image, **values):\n        return True\n"
        function = validators_in(source, "n.py")["N"]
        self.assertEqual(function.args.kwarg.arg, "values")


@unittest.skipUnless(COMFY_ROOT, "set AUSBOSS_COMFY_ROOT to a ComfyUI checkout")
class ComfyValidationTests(unittest.TestCase):
    """What ComfyUI itself reports for a prompt, in-process."""

    @classmethod
    def setUpClass(cls):
        cls.pack = load_pack()
        import execution
        import folder_paths
        import nodes

        nodes.NODE_CLASS_MAPPINGS.update(cls.pack.NODE_CLASS_MAPPINGS)
        cls.execution = execution
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.input_dir = root / "input"
        cls.output_dir = root / "output"
        for folder in (cls.input_dir / "sub", cls.input_dir / "clipspace", cls.output_dir):
            folder.mkdir(parents=True, exist_ok=True)
        cls.saved_dirs = (folder_paths.get_input_directory(), folder_paths.get_output_directory())
        folder_paths.set_input_directory(str(cls.input_dir))
        folder_paths.set_output_directory(str(cls.output_dir))
        cls.folder_paths = folder_paths
        # Validation only asks whether a source exists, so empty files do.
        for name in ("pic.png", "sub/pic.png", "clipspace/painted.png", "clip.mp4"):
            (cls.input_dir / name).write_bytes(b"")

    @classmethod
    def tearDownClass(cls):
        cls.folder_paths.set_input_directory(cls.saved_dirs[0])
        cls.folder_paths.set_output_directory(cls.saved_dirs[1])
        cls.tmp.cleanup()

    def node(self, key, **values):
        """A prompt entry the way the frontend sends one: every widget filled."""
        inputs = {}
        definition = self.pack.NODE_CLASS_MAPPINGS[key].INPUT_TYPES()
        for group in ("required", "optional"):
            for name, entry in definition.get(group, {}).items():
                kind, options = entry[0], (entry[1] if len(entry) > 1 else {})
                if options.get("forceInput"):
                    continue
                if "default" in options:
                    inputs[name] = options["default"]
                elif isinstance(kind, list) and kind:
                    inputs[name] = kind[0]
                elif kind == "STRING":
                    inputs[name] = ""
        return {"class_type": key, "inputs": {**inputs, **values}}

    def errors(self, prompt, node_id):
        validate = self.execution.validate_inputs
        args = (prompt, node_id, {})
        if "prompt_id" in inspect.signature(validate).parameters:
            args = ("test",) + args
        result = validate(*args)
        if inspect.isawaitable(result):
            result = asyncio.run(result)
        return [(error["type"], error["details"], error["extra_info"].get("input_name")) for error in result[1]]

    def image(self):
        return {"class_type": "EmptyImage", "inputs": {"width": 64, "height": 64, "batch_size": 1, "color": 0}}

    # One error, on the right input --------------------------------------

    def test_a_missing_picture_is_one_error_on_the_picture(self):
        for key, label in (
            ("AUSBOSS_NODES_ImageCropRotatePad", "Image Crop + Rotate + Pad"),
            ("AUSBOSS_NODES_LoadImagePad", "Load Image + Pad"),
        ):
            for name, reason in (("", "Select or upload a source file first."), ("gone.png", "no longer exists")):
                with self.subTest(node=key, image=name):
                    errors = self.errors({"1": self.node(key, image=name)}, "1")
                    self.assertEqual(len(errors), 1, errors)
                    kind, details, input_name = errors[0]
                    self.assertEqual((kind, input_name), ("custom_validation_failed", "image"))
                    self.assertTrue(details.startswith(f"image - {label}: "), details)
                    self.assertIn(reason, details)

    def test_a_missing_video_is_one_error_on_the_video(self):
        errors = self.errors({"1": self.node("AUSBOSS_NODES_LoadVideo", video="gone.mp4")}, "1")
        self.assertEqual([(kind, name) for kind, _details, name in errors], [("custom_validation_failed", "video")])

    def test_a_missing_lama_model_is_one_error_on_the_model(self):
        prompt = {
            "1": self.image(),
            "2": {"class_type": "LoadImage", "inputs": {"image": "pic.png"}},
            "3": self.node("AUSBOSS_NODES_LaMaInpaint", image=["1", 0], mask=["2", 1], model="gone.pt"),
        }
        errors = self.errors(prompt, "3")
        self.assertEqual([(kind, name) for kind, _details, name in errors], [("custom_validation_failed", "model")])

    def test_checks_that_read_several_inputs_repeat_once_per_input_they_read(self):
        # ComfyUI's rule, not ours: the pack's frontend folds these into one.
        cases = (
            ("AUSBOSS_NODES_VideoCropRotatePad", {"video": "gone.mp4"}, ["video", "source_mode", "local_path"]),
            ("AUSBOSS_NODES_VideoCropRotatePadClip", {"video": "gone.mp4"}, ["video", "source_mode", "local_path"]),
        )
        for key, values, names in cases:
            with self.subTest(node=key):
                errors = self.errors({"1": self.node(key, **values)}, "1")
                self.assertEqual(sorted(name for _kind, _details, name in errors), sorted(names))
                self.assertEqual(len({details.split(" - ", 1)[1] for _kind, details, _name in errors}), 1)

    # ComfyUI's own checks are back ------------------------------------------

    def test_ranges_and_lists_are_checked_again(self):
        cases = (
            ({"1": self.node("AUSBOSS_NODES_ImageCropRotatePad", image="pic.png", crop_x=-5)}, "1",
             ("value_smaller_than_min", "crop_x")),
            ({"1": self.node("AUSBOSS_NODES_ImageCropRotatePad", image="pic.png", resize_method="sharpest")}, "1",
             ("value_not_in_list", "resize_method")),
            ({"1": self.node("AUSBOSS_NODES_LoadVideo", video="clip.mp4", custom_width=-2)}, "1",
             ("value_smaller_than_min", "custom_width")),
            ({"1": self.node("AUSBOSS_NODES_LoadVideo", video="clip.mp4"),
              "2": self.node("AUSBOSS_NODES_SaveVideo", frames=["1", 0], fps=0)}, "2",
             ("value_smaller_than_min", "fps")),
            ({"1": self.image(), "2": self.node("AUSBOSS_NODES_SaveImage", images=["1", 0], format="webp")}, "2",
             ("value_not_in_list", "format")),
            ({"1": self.node("AUSBOSS_NODES_VideoCropRotatePad", video="clip.mp4", seek_mode="halfway")}, "1",
             ("value_not_in_list", "seek_mode")),
        )
        for prompt, node_id, (kind, input_name) in cases:
            with self.subTest(expected=(kind, input_name)):
                self.assertEqual([(k, n) for k, _d, n in self.errors(prompt, node_id)], [(kind, input_name)])

    def test_a_wrong_link_type_on_the_clip_node_is_caught(self):
        prompt = {
            "1": self.node("AUSBOSS_NODES_Text", text="12"),
            "2": self.node("AUSBOSS_NODES_VideoCropRotatePadClip", video="clip.mp4", start_frame=["1", 0]),
        }
        self.assertEqual([(k, n) for k, _d, n in self.errors(prompt, "2")], [("return_type_mismatch", "start_frame")])

    # ... without refusing what the nodes deliberately accept ----------------

    def test_sources_comfy_has_not_listed_still_pass(self):
        for name in ("pic.png", "sub/pic.png", "clipspace/painted.png [input]"):
            with self.subTest(image=name):
                self.assertEqual(self.errors({"1": self.node("AUSBOSS_NODES_ImageCropRotatePad", image=name)}, "1"), [])

    def test_a_stale_video_choice_does_not_block_local_path_mode(self):
        output_clip = self.output_dir / "render.mp4"
        output_clip.write_bytes(b"")
        for key in ("AUSBOSS_NODES_VideoCropRotatePad", "AUSBOSS_NODES_VideoCropRotatePadClip"):
            with self.subTest(node=key):
                prompt = {"1": self.node(key, video="someone-elses.mp4", source_mode="local path", local_path=str(output_clip))}
                self.assertEqual(self.errors(prompt, "1"), [])

    def test_a_crop_ratio_from_someone_elses_presets_still_runs(self):
        for ratio in ("5:4", "4:5", "2:1"):
            with self.subTest(ratio=ratio):
                prompt = {"1": self.node("AUSBOSS_NODES_ImageCropRotatePad", image="pic.png", crop_aspect_ratio=ratio)}
                self.assertEqual(self.errors(prompt, "1"), [])
        prompt = {"1": self.node("AUSBOSS_NODES_ImageCropRotatePad", image="pic.png", crop_aspect_ratio="wide")}
        self.assertEqual([(k, n) for k, _d, n in self.errors(prompt, "1")], [("value_not_in_list", "crop_aspect_ratio")])

    def test_a_wired_trim_bound_waits_for_the_run(self):
        prompt = {
            "1": self.node("AUSBOSS_NODES_Float", value=0.25),
            "2": self.node("AUSBOSS_NODES_LoadVideo", video="clip.mp4", start_seconds=["1", 0], end_seconds=0.75),
        }
        self.assertEqual(self.errors(prompt, "2"), [])

    def test_a_lora_stack_is_checked_by_the_node_not_by_a_list(self):
        loader = self.pack.NODE_CLASS_MAPPINGS["AUSBOSS_NODES_LoraLoader"]
        node_lora_loader = sys.modules[loader.__module__]
        stack = json.dumps([{"name": "styles/sub/look.safetensors", "strength": 1.0, "enabled": True}])
        prompt = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "x.safetensors"}},
            "2": self.node("AUSBOSS_NODES_LoraLoader", model=["1", 0], loras=stack),
        }
        with patch.object(node_lora_loader, "missing_lora_rows", return_value=[]):
            self.assertEqual(self.errors(prompt, "2"), [])
        with patch.object(node_lora_loader, "missing_lora_rows", return_value=[("look.safetensors", "not found")]):
            errors = self.errors(prompt, "2")
        self.assertEqual(sorted(name for _k, _d, name in errors), ["loras", "on_missing"])
        prompt["2"]["inputs"].pop("on_missing")
        with patch.object(node_lora_loader, "missing_lora_rows", return_value=[("look.safetensors", "not found")]):
            self.assertEqual([name for _k, _d, name in self.errors(prompt, "2")], ["loras"])


if __name__ == "__main__":
    unittest.main()
