"""Resolution Master 🆎 backend: clamping and the latent output."""

import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nodes.node_resolution import (
    DIM_MAX,
    DIM_MIN,
    LATENT_FAMILIES,
    clamp_dimension,
    latent_shape,
)

from nodes import node_resolution
ResolutionNode = getattr(node_resolution, "AusBossResolution", getattr(node_resolution, "AusBossLabResolution", None))


class TestClampDimension(unittest.TestCase):
    def test_passthrough_and_clamp(self):
        self.assertEqual(clamp_dimension(1344), 1344)
        self.assertEqual(clamp_dimension(5), DIM_MIN)
        self.assertEqual(clamp_dimension(999999), DIM_MAX)

    def test_junk_falls_back(self):
        self.assertEqual(clamp_dimension("wide"), 1024)
        self.assertEqual(clamp_dimension(None), 1024)
        self.assertEqual(clamp_dimension(float("inf")), 1024)


class TestLatentShape(unittest.TestCase):
    def test_families_match_the_core_empty_latent_nodes(self):
        # EmptySD3LatentImage: [b, 16, h//8, w//8]; EmptyLatentImage: [b, 4, h//8, w//8];
        # EmptyFlux2LatentImage: [b, 128, h//16, w//16].
        self.assertEqual(latent_shape(1024, 768, "16ch", 1), (1, 16, 96, 128))
        self.assertEqual(latent_shape(1024, 768, "4ch", 2), (2, 4, 96, 128))
        self.assertEqual(latent_shape(1024, 768, "128ch", 1), (1, 128, 48, 64))

    def test_unknown_family_and_bad_batch_fall_back(self):
        self.assertEqual(latent_shape(512, 512, "nope", "x"), (1, 16, 64, 64))
        self.assertEqual(latent_shape(512, 512, "16ch", 999), (64, 16, 64, 64))

    def test_combo_options_are_the_family_labels(self):
        options = ResolutionNode.INPUT_TYPES()["optional"]["latent"][0]
        self.assertEqual(options, list(LATENT_FAMILIES))


class TestResolve(unittest.TestCase):
    def test_typed_values_survive_exactly_and_the_latent_follows(self):
        # Snap governs gestures; the backend never re-snaps 1920x1080.
        fake_torch = SimpleNamespace(zeros=lambda shape, **kwargs: SimpleNamespace(shape=tuple(shape)))
        with patch("nodes.node_resolution.torch", fake_torch), patch("nodes.node_resolution.model_management", None):
            width, height, latent = ResolutionNode().resolve(1920, 1080)
        self.assertEqual((width, height), (1920, 1080))
        samples = latent["samples"]
        shape = tuple(samples.shape) if samples is not None else latent["shape"]
        self.assertEqual(shape, (1, 16, 135, 240))

    def test_outputs_are_width_height_latent(self):
        self.assertEqual(ResolutionNode.RETURN_NAMES, ("width", "height", "latent"))
        self.assertEqual(ResolutionNode.RETURN_TYPES, ("INT", "INT", "LATENT"))


if __name__ == "__main__":
    unittest.main()
