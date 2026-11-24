"""Save Image's Civitai line: the A1111-style ``parameters`` text built from
the run's graph, and where each format stores it."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from PIL import Image

from nodes import _lora_helpers, node_save_image
from nodes._civitai_info import civitai_parameters


def stack(*rows):
    return json.dumps([{"name": name, "strength": strength, "enabled": on} for name, strength, on in rows])


def sd15_graph():
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd/dreamshaper_8.safetensors"}},
        "10": {"class_type": "AUSBOSS_NODES_LoraLoader", "inputs": {
            "model": ["4", 0], "clip": ["4", 1],
            "loras": stack(("detail.safetensors", 0.8, True), ("off.safetensors", 1.0, False), ("zero.safetensors", 0.0, True)),
        }},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 768, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a lighthouse at dusk, oil paint", "clip": ["10", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry", "clip": ["10", 1]}},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": 1234, "steps": 20, "cfg": 7, "sampler_name": "euler", "scheduler": "normal", "denoise": 1,
            "model": ["10", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0],
        }},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"images": ["8", 0]}},
    }


FILES = {
    ("checkpoints", "sd/dreamshaper_8.safetensors"): "a" * 64,
    ("loras", "detail.safetensors"): "b" * 64,
    ("loras", "off.safetensors"): "c" * 64,
    ("loras", "zero.safetensors"): "d" * 64,
    ("diffusion_models", "krea2_dev.safetensors"): "e" * 64,
}


def find_file(folders, name):
    for folder in folders:
        if (folder, name) in FILES:
            return Path(folder) / name
    return None


def file_hash(path: Path) -> str:
    return FILES[(path.parent.as_posix().split("/")[0], path.relative_to(path.parts[0]).as_posix())]


def line(graph, save_id="9"):
    return civitai_parameters(graph, save_id, 512, 768, find_file, file_hash)


class CivitaiLineTests(unittest.TestCase):
    def test_a_plain_graph_gives_prompt_settings_and_hashes(self):
        text = line(sd15_graph())
        prompt, negative, details = text.split("\n")
        self.assertEqual(prompt, "a lighthouse at dusk, oil paint")
        self.assertEqual(negative, "Negative prompt: blurry")
        self.assertTrue(details.startswith("Steps: 20, Sampler: euler, Schedule type: normal, CFG scale: 7, Seed: 1234, Size: 512x768"))
        self.assertIn("Model hash: aaaaaaaaaa, Model: dreamshaper_8", details)
        # Rows that are off or at 0 never ran, so they are not credited.
        self.assertIn('Lora hashes: "detail: bbbbbbbbbb"', details)
        self.assertIn('Hashes: {"model":"aaaaaaaaaa","lora:detail":"bbbbbbbbbb"}', details)
        self.assertNotIn("off", details.replace("offset", ""))
        self.assertNotIn("zero", details)
        # Lower-case keys Civitai keeps: the ComfyUI tool tag and the technique.
        self.assertTrue(details.endswith("Version: ComfyUI, engine: ComfyUI, process: txt2img"))

    def test_a_sampler_that_starts_from_a_picture_is_img2img(self):
        graph = sd15_graph()
        graph["5"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["11", 0], "vae": ["4", 2]}}
        graph["11"] = {"class_type": "LoadImage", "inputs": {"image": "x.png"}}
        self.assertTrue(line(graph).endswith("process: img2img"))
        graph = sd15_graph()
        graph["3"]["inputs"]["denoise"] = 0.5
        self.assertTrue(line(graph).endswith("process: img2img"))

    def test_a_two_prompt_encoder_gives_its_negative_on_the_second_output(self):
        graph = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2_dev.safetensors"}},
            "20": {"class_type": "AUSBOSS_NODES_Seed", "inputs": {"seed": 777}},
            "21": {"class_type": "AUSBOSS_NODES_Text", "inputs": {"text": "a red fox in snow"}},
            "12": {"class_type": "AUSBOSS_NODES_Krea2Encode", "inputs": {"clip": ["2", 0], "prompt": ["21", 0], "negative_prompt": "low quality"}},
            "14": {"class_type": "KSampler", "inputs": {
                "seed": ["20", 0], "steps": 8, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
                "model": ["1", 0], "positive": ["12", 0], "negative": ["12", 1], "latent_image": ["13", 0],
            }},
            "15": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0]}},
            "9": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"images": ["15", 0]}},
        }
        text = line(graph)
        self.assertTrue(text.startswith("a red fox in snow\nNegative prompt: low quality\nSteps: 8,"))
        self.assertIn("Seed: 777", text)
        self.assertIn('Hashes: {"model":"eeeeeeeeee"}', text)

    def test_a_custom_sampler_reads_its_settings_from_the_nodes_it_takes(self):
        graph = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2_dev.safetensors"}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cabin at night"}},
            "7": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["6", 0], "guidance": 3.5}},
            "g": {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["7", 0]}},
            "n": {"class_type": "RandomNoise", "inputs": {"noise_seed": 99}},
            "s": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            "c": {"class_type": "BasicScheduler", "inputs": {"model": ["1", 0], "steps": 28, "scheduler": "simple", "denoise": 1}},
            "x": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["n", 0], "guider": ["g", 0], "sampler": ["s", 0], "sigmas": ["c", 0], "latent_image": ["l", 0]}},
            "d": {"class_type": "VAEDecode", "inputs": {"samples": ["x", 0]}},
            "9": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"images": ["d", 0]}},
        }
        text = line(graph)
        self.assertTrue(text.startswith("a cabin at night\nSteps: 28, Sampler: euler, Schedule type: simple, Seed: 99,"))
        self.assertIn("Model: krea2_dev", text)

    def test_only_the_sampler_upstream_of_this_save_is_described(self):
        graph = sd15_graph()
        other = {key: dict(node, inputs=dict(node["inputs"])) for key, node in sd15_graph().items()}
        graph.update({f"o{key}": node for key, node in other.items()})
        for node in other.values():
            node["inputs"] = {k: ([f"o{v[0]}", v[1]] if isinstance(v, list) else v) for k, v in node["inputs"].items()}
        graph["o6"]["inputs"]["text"] = "the other branch"
        self.assertTrue(line(graph, "o9").startswith("the other branch\n"))
        self.assertTrue(line(graph, "9").startswith("a lighthouse at dusk"))

    def test_no_sampler_or_an_odd_graph_gives_no_line(self):
        self.assertIsNone(line({"1": {"class_type": "LoadImage", "inputs": {"image": "x.png"}}, "9": {"class_type": "AUSBOSS_NODES_SaveImage", "inputs": {"images": ["1", 0]}}}))
        self.assertIsNone(line(None))
        self.assertIsNone(line({"3": {"class_type": "KSampler", "inputs": {"positive": ["3", 0], "negative": ["3", 0], "steps": ["3", 0]}}}))

    def test_a_missing_model_file_still_gives_the_prompt(self):
        graph = sd15_graph()
        graph["4"]["inputs"]["ckpt_name"] = "gone.safetensors"
        text = line(graph)
        self.assertIn("Model: gone", text)
        self.assertNotIn("Model hash", text)


class SaveImageCivitaiTests(unittest.TestCase):
    def run_node(self, root, **overrides):
        models = Path(root) / "models"
        lora = models / "detail.safetensors"
        lora.parent.mkdir(parents=True, exist_ok=True)
        lora.write_bytes(b"lora bytes")
        ckpt = models / "dreamshaper_8.safetensors"
        ckpt.write_bytes(b"checkpoint bytes")
        paths = {("checkpoints", "sd/dreamshaper_8.safetensors"): ckpt, ("loras", "detail.safetensors"): lora}

        class FakeFolderPaths:
            @staticmethod
            def get_output_directory():
                return str(root)

            @staticmethod
            def get_full_path(folder, name):
                found = paths.get((folder, name))
                return str(found) if found else None

        values = {
            "images": torch.rand(1, 8, 16, 3), "filename_prefix": "shot", "format": "png",
            "save_metadata": True, "civitai_info": True, "preview": False,
            "prompt": sd15_graph(), "extra_pnginfo": {"workflow": {"nodes": []}}, "unique_id": "9",
        }
        values.update(overrides)
        with patch.object(node_save_image, "folder_paths", FakeFolderPaths), \
                patch.object(_lora_helpers, "_hash_cache_path", lambda: None):
            path = Path(node_save_image.AusBossSaveImage().save(**values)["result"][0])
        return path, hashlib.sha256(b"checkpoint bytes").hexdigest()[:10]

    def test_png_keeps_the_workflow_and_adds_parameters(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, model_hash = self.run_node(tmp)
            with Image.open(path) as image:
                text = dict(image.text)
        self.assertIn("workflow", text)
        self.assertIn("prompt", text)
        self.assertTrue(text["parameters"].startswith("a lighthouse at dusk, oil paint\n"))
        self.assertIn(f"Model hash: {model_hash}", text["parameters"])

    def test_webp_puts_parameters_in_user_comment_beside_the_workflow(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, model_hash = self.run_node(tmp, format="webp lossless")
            with Image.open(path) as image:
                exif = image.getexif()
        self.assertTrue(exif.get(0x0110).startswith("prompt:"))
        self.assertTrue(exif.get(0x010F).startswith("workflow:"))
        comment = exif.get_ifd(0x8769)[0x9286]
        self.assertTrue(comment.startswith(b"UNICODE\0"))
        self.assertIn(f"Model hash: {model_hash}", comment[8:].decode("utf-16-be"))

    def test_off_by_default_and_never_without_embed(self):
        for overrides in ({"civitai_info": False}, {"save_metadata": False}):
            with self.subTest(**overrides), tempfile.TemporaryDirectory() as tmp:
                path, _ = self.run_node(tmp, **overrides)
                with Image.open(path) as image:
                    self.assertNotIn("parameters", image.text)
        defaults = node_save_image.AusBossSaveImage.INPUT_TYPES()["optional"]["civitai_info"][1]
        self.assertIs(defaults["default"], False)


if __name__ == "__main__":
    unittest.main()
