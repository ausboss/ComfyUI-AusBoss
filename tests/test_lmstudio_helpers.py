"""Offline tests for the LM Studio chat node.

Everything except the real POST runs here; the POST itself is exercised
against a mocked urlopen, including every error path a local server can
produce. No test touches the network.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._lmstudio_helpers import (
    DEFAULT_ENDPOINT,
    build_chat_payload,
    chat_completions_url,
    image_data_url,
    parse_chat_text,
    request_chat,
    split_reasoning,
)
from nodes.node_lmstudio_chat import AusBossLmStudioChat


class ChatUrlTests(unittest.TestCase):
    def test_every_reasonable_spelling_lands_on_the_route(self):
        expected = "http://127.0.0.1:1234/v1/chat/completions"
        for endpoint in (
            "http://127.0.0.1:1234/v1",
            "http://127.0.0.1:1234/v1/",
            "http://127.0.0.1:1234",
            "127.0.0.1:1234",
            "127.0.0.1:1234/v1",
            "http://127.0.0.1:1234/v1/chat/completions",
        ):
            self.assertEqual(chat_completions_url(endpoint), expected, endpoint)

    def test_empty_endpoint_falls_back_to_the_default(self):
        self.assertEqual(
            chat_completions_url(""),
            DEFAULT_ENDPOINT.rstrip("/") + "/chat/completions",
        )
        self.assertEqual(chat_completions_url(None), chat_completions_url(""))

    def test_https_and_remote_hosts_survive(self):
        self.assertEqual(
            chat_completions_url("https://box.local:8080/v1"),
            "https://box.local:8080/v1/chat/completions",
        )


class PayloadTests(unittest.TestCase):
    def test_text_only_payload_is_the_plain_openai_shape(self):
        payload = build_chat_payload("", "", "hello", None, 0.7, 512, 42)
        self.assertEqual(
            payload["messages"], [{"role": "user", "content": "hello"}]
        )
        self.assertNotIn("model", payload)  # empty = whatever is loaded
        self.assertEqual(payload["max_tokens"], 512)
        self.assertEqual(payload["seed"], 42)
        self.assertIs(payload["stream"], False)

    def test_system_prompt_prepends_a_system_message(self):
        payload = build_chat_payload("", "be terse", "hi", None, 0.7, 512, 0)
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "be terse"})
        self.assertEqual(len(payload["messages"]), 2)

    def test_blank_system_prompt_sends_no_system_message(self):
        payload = build_chat_payload("", "   ", "hi", None, 0.7, 512, 0)
        self.assertEqual(len(payload["messages"]), 1)

    def test_image_becomes_a_typed_content_part(self):
        payload = build_chat_payload("m", "", "what is this", "data:image/png;base64,AA==", 0.5, 256, 1)
        content = payload["messages"][0]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "what is this"})
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], "data:image/png;base64,AA==")
        self.assertEqual(payload["model"], "m")

    def test_image_with_empty_prompt_sends_only_the_image(self):
        payload = build_chat_payload("", "", "", "data:image/png;base64,AA==", 0.5, 256, 1)
        content = payload["messages"][0]["content"]
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["type"], "image_url")

    def test_max_tokens_minus_one_is_left_to_the_server(self):
        self.assertNotIn("max_tokens", build_chat_payload("", "", "hi", None, 0.7, -1, 0))

    def test_neutral_advanced_values_change_nothing(self):
        plain = build_chat_payload("", "", "hi", None, 0.7, 512, 0)
        neutral = build_chat_payload(
            "", "", "hi", None, 0.7, 512, 0,
            advanced={
                "top_p": 1.0, "top_k": 0, "repeat_penalty": 1.0, "min_p": 0.0,
                "presence_penalty": 0.0, "thinking_mode": "model default",
                "idle_unload_seconds": 0,
            },
        )
        self.assertEqual(plain, neutral)

    def test_active_advanced_values_land_in_the_body(self):
        payload = build_chat_payload(
            "", "", "hi", None, 0.7, 512, 0,
            advanced={
                "top_p": 0.9, "top_k": 40, "repeat_penalty": 1.1, "min_p": 0.05,
                "presence_penalty": 0.5, "thinking_mode": "off",
                "idle_unload_seconds": 300,
            },
        )
        self.assertEqual(payload["top_p"], 0.9)
        self.assertEqual(payload["top_k"], 40)
        self.assertEqual(payload["repeat_penalty"], 1.1)
        self.assertEqual(payload["min_p"], 0.05)
        self.assertEqual(payload["presence_penalty"], 0.5)
        self.assertEqual(payload["ttl"], 300)
        self.assertEqual(payload["chat_template_kwargs"], {"enable_thinking": False})

    def test_thinking_mode_on_asks_the_template_to_think(self):
        payload = build_chat_payload(
            "", "", "hi", None, 0.7, 512, 0, advanced={"thinking_mode": "on"}
        )
        self.assertEqual(payload["chat_template_kwargs"], {"enable_thinking": True})


class ParseTests(unittest.TestCase):
    def test_plain_string_content(self):
        data = {"choices": [{"message": {"content": "a reply"}}]}
        self.assertEqual(parse_chat_text(data), "a reply")

    def test_typed_part_list_content(self):
        data = {"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}}]}
        self.assertEqual(parse_chat_text(data), "ab")

    def test_server_error_object_surfaces_its_message(self):
        with self.assertRaises(RuntimeError) as caught:
            parse_chat_text({"error": {"message": "No model loaded"}})
        self.assertIn("No model loaded", str(caught.exception))

    def test_malformed_response_names_the_expected_shape(self):
        for bad in ({}, {"choices": []}, {"choices": [{}]}, "nope", None):
            with self.assertRaises(RuntimeError) as caught:
                parse_chat_text(bad)
            self.assertIn("choices[0].message.content", str(caught.exception))


class SplitReasoningTests(unittest.TestCase):
    def test_ordinary_replies_pass_through_with_empty_thinking(self):
        self.assertEqual(split_reasoning("just an answer"), ("just an answer", ""))

    def test_think_block_is_moved_to_the_second_output(self):
        text = "<think>step 1\nstep 2</think>The answer is 4."
        self.assertEqual(split_reasoning(text), ("The answer is 4.", "step 1\nstep 2"))

    def test_multiple_blocks_join_and_case_does_not_matter(self):
        text = "<THINK>a</THINK>mid<think>b</think> end"
        answer, thinking = split_reasoning(text)
        self.assertEqual(answer, "mid end")
        self.assertEqual(thinking, "a\n\nb")

    def test_an_unclosed_block_counts_as_reasoning_to_the_end(self):
        # The model hit max_tokens mid-thought; the answer must not contain it.
        answer, thinking = split_reasoning("<think>ran out of tok")
        self.assertEqual(answer, "")
        self.assertEqual(thinking, "ran out of tok")

    def test_custom_tags_split_and_defaults_survive_blanks(self):
        text = "<|sot|>plan<|eot|>done"
        self.assertEqual(split_reasoning(text, "<|sot|>", "<|eot|>"), ("done", "plan"))
        # Blank custom tags fall back to the <think> defaults.
        self.assertEqual(
            split_reasoning("<think>a</think>b", "", ""), ("b", "a")
        )


class ImageDataUrlTests(unittest.TestCase):
    def frames(self, batch=1, height=32, width=48):
        return torch.rand((batch, height, width, 3))

    def decode(self, url: str):
        from PIL import Image

        prefix = "data:image/png;base64,"
        self.assertTrue(url.startswith(prefix))
        return Image.open(io.BytesIO(base64.b64decode(url[len(prefix):])))

    def test_round_trips_as_a_png_of_the_same_size(self):
        picture = self.decode(image_data_url(self.frames(), 0))
        self.assertEqual(picture.size, (48, 32))
        self.assertEqual(picture.mode, "RGB")

    def test_only_the_first_frame_of_a_batch_is_sent(self):
        batch = torch.zeros((3, 8, 8, 3))
        batch[0] = 1.0  # white first frame, black rest
        picture = self.decode(image_data_url(batch, 0))
        self.assertEqual(picture.getpixel((4, 4)), (255, 255, 255))

    def test_max_edge_downscales_and_keeps_aspect(self):
        picture = self.decode(image_data_url(self.frames(1, 400, 800), 200))
        self.assertEqual(picture.size, (200, 100))

    def test_max_edge_zero_never_resizes(self):
        picture = self.decode(image_data_url(self.frames(1, 400, 800), 0))
        self.assertEqual(picture.size, (800, 400))

    def test_rejects_non_bhwc_input(self):
        with self.assertRaises(ValueError):
            image_data_url(torch.zeros((32, 32, 3)), 0)


class FakeReply:
    def __init__(self, body: bytes):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class RequestChatTests(unittest.TestCase):
    URL = "http://127.0.0.1:1234/v1/chat/completions"

    def test_posts_json_and_returns_the_parsed_reply(self):
        seen = {}

        def fake_urlopen(request, timeout=None):
            seen["url"] = request.full_url
            seen["body"] = json.loads(request.data.decode("utf-8"))
            seen["timeout"] = timeout
            return FakeReply(b'{"choices": [{"message": {"content": "ok"}}]}')

        with patch("urllib.request.urlopen", fake_urlopen):
            data = request_chat(self.URL, {"messages": []}, 30)
        self.assertEqual(parse_chat_text(data), "ok")
        self.assertEqual(seen["url"], self.URL)
        self.assertEqual(seen["body"], {"messages": []})
        self.assertEqual(seen["timeout"], 30)

    def test_connection_refused_says_how_to_start_the_server(self):
        def fake_urlopen(request, timeout=None):
            raise urllib.error.URLError(ConnectionRefusedError(111, "refused"))

        with patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError) as caught:
                request_chat(self.URL, {}, 30)
        message = str(caught.exception)
        self.assertIn("LM Studio server running", message)
        self.assertIn(self.URL, message)

    def test_http_error_carries_the_server_message(self):
        def fake_urlopen(request, timeout=None):
            raise urllib.error.HTTPError(
                self.URL, 404, "Not Found", {},
                io.BytesIO(b'{"error": {"message": "Model not found"}}'),
            )

        with patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError) as caught:
                request_chat(self.URL, {}, 30)
        message = str(caught.exception)
        self.assertIn("HTTP 404", message)
        self.assertIn("Model not found", message)

    def test_timeout_names_the_wait_and_suggests_raising_it(self):
        def fake_urlopen(request, timeout=None):
            raise urllib.error.URLError(TimeoutError("timed out"))

        with patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError) as caught:
                request_chat(self.URL, {}, 45)
        self.assertIn("45s", str(caught.exception))

    def test_non_json_reply_points_at_the_endpoint_setting(self):
        def fake_urlopen(request, timeout=None):
            return FakeReply(b"<html>a web page</html>")

        with patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError) as caught:
                request_chat(self.URL, {}, 30)
        self.assertIn("not with JSON", str(caught.exception))


class ChatNodeTests(unittest.TestCase):
    def run_chat(self, **overrides):
        node = AusBossLmStudioChat()
        arguments = dict(
            prompt="describe a cat",
            system_prompt="",
            endpoint=DEFAULT_ENDPOINT,
            model="",
            temperature=0.7,
            max_tokens=512,
            seed=0,
            timeout_seconds=30,
            image_max_edge=1024,
            image=None,
        )
        arguments.update(overrides)
        return asyncio.run(node.chat(**arguments))

    def test_returns_text_and_split_thinking(self):
        reply = {"choices": [{"message": {"content": "<think>hmm</think>A tabby cat."}}]}
        with patch("nodes.node_lmstudio_chat.request_chat", return_value=reply) as sent:
            text, thinking = self.run_chat()
        self.assertEqual(text, "A tabby cat.")
        self.assertEqual(thinking, "hmm")
        url, payload, timeout = sent.call_args[0]
        self.assertTrue(url.endswith("/v1/chat/completions"))
        self.assertEqual(payload["messages"][0]["content"], "describe a cat")
        self.assertEqual(timeout, 30)

    def test_empty_prompt_without_an_image_refuses_before_any_request(self):
        with patch("nodes.node_lmstudio_chat.request_chat") as sent:
            with self.assertRaises(ValueError) as caught:
                self.run_chat(prompt="   ")
        self.assertIn("type a prompt or connect an image", str(caught.exception))
        sent.assert_not_called()

    def test_an_image_alone_is_a_valid_request(self):
        reply = {"choices": [{"message": {"content": "A photo."}}]}
        with patch("nodes.node_lmstudio_chat.request_chat", return_value=reply) as sent:
            text, _ = self.run_chat(prompt="", image=torch.rand((1, 16, 16, 3)))
        self.assertEqual(text, "A photo.")
        content = sent.call_args[0][1]["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "image_url")

    def test_the_entry_point_is_async(self):
        import inspect

        self.assertTrue(inspect.iscoroutinefunction(AusBossLmStudioChat.chat))


if __name__ == "__main__":
    unittest.main()
