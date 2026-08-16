"""LM Studio Chat (AusBoss)."""

from __future__ import annotations

import asyncio

from ._lmstudio_helpers import (
    DEFAULT_ENDPOINT,
    build_chat_payload,
    chat_completions_url,
    image_data_url,
    parse_chat_text,
    request_chat,
    split_reasoning,
)


class AusBossLmStudioChat:
    CATEGORY = "🆎 AusBoss/Text"
    DESCRIPTION = (
        "Sends a prompt - and optionally an image - to a local LM Studio "
        "server and returns the reply as text. Works with any OpenAI-"
        "compatible endpoint. Reasoning-model <think> blocks come out on "
        "their own output, so the text output stays clean for wiring into "
        "a conditioning prompt. Caches like any node; change the seed to "
        "re-roll the same inputs."
    )
    SEARCH_ALIASES = [
        "lm studio",
        "llm",
        "chat",
        "vision",
        "caption",
        "describe image",
        "prompt enhance",
        "openai compatible",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": (
                            "What to ask. Required unless an image is "
                            "connected - an image with an empty prompt asks "
                            "for a plain description."
                        ),
                    },
                ),
                "system_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": (
                            "Optional role and rules for the model, e.g. "
                            "'You write single-paragraph Stable Diffusion "
                            "prompts, no preamble.' Empty sends no system "
                            "message."
                        ),
                    },
                ),
                "endpoint": (
                    "STRING",
                    {
                        "default": DEFAULT_ENDPOINT,
                        "tooltip": (
                            "The server's base URL - LM Studio shows it on "
                            "its Developer tab. A bare host:port or a full "
                            "/v1 path both work; any OpenAI-compatible "
                            "server is fine."
                        ),
                    },
                ),
                "model": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": (
                            "Model identifier as LM Studio lists it. Empty "
                            "uses whatever the server has loaded, which is "
                            "the everyday case."
                        ),
                    },
                ),
                "temperature": (
                    "FLOAT",
                    {
                        "default": 0.7,
                        "min": 0.0,
                        "max": 2.0,
                        "step": 0.05,
                        "tooltip": (
                            "Sampling randomness: 0 is near-deterministic, "
                            "0.7 balanced, higher wanders. Captioning likes "
                            "0.2-0.5."
                        ),
                    },
                ),
                "max_tokens": (
                    "INT",
                    {
                        "default": 512,
                        "min": -1,
                        "max": 131072,
                        "step": 1,
                        "tooltip": (
                            "Longest allowed reply, in tokens. -1 leaves "
                            "the length to the server. Reasoning models "
                            "spend tokens thinking before answering, so "
                            "give them room."
                        ),
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "tooltip": (
                            "Sent to the server, and either way a changed "
                            "seed re-runs the node instead of replaying the "
                            "cached reply - the re-roll knob."
                        ),
                    },
                ),
                "timeout_seconds": (
                    "INT",
                    {
                        "default": 120,
                        "min": 5,
                        "max": 3600,
                        "step": 5,
                        "tooltip": (
                            "How long to wait for the reply. Cold-loading a "
                            "big model or a long think can need minutes."
                        ),
                    },
                ),
                "image_max_edge": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 0,
                        "max": 8192,
                        "step": 64,
                        "tooltip": (
                            "Downscale a connected image so its longest edge "
                            "fits this before sending; 0 sends full size. "
                            "Vision models resize internally anyway, and a "
                            "smaller upload prefills much faster."
                        ),
                    },
                ),
            },
            "optional": {
                "image": (
                    "IMAGE",
                    {
                        "tooltip": (
                            "Optional image for vision models. Only the "
                            "FIRST frame of a batch is sent - pick one with "
                            "Select Frame (AusBoss) for video. A text-only "
                            "model errors server-side if an image arrives."
                        )
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "thinking")
    OUTPUT_TOOLTIPS = (
        "The model's reply with any <think> blocks removed - safe to wire "
        "straight into a text encoder.",
        "The reasoning a thinking model emitted, empty for ordinary models. "
        "Useful for a preview node while tuning prompts.",
    )
    FUNCTION = "chat"

    async def chat(
        self,
        prompt,
        system_prompt,
        endpoint,
        model,
        temperature,
        max_tokens,
        seed,
        timeout_seconds,
        image_max_edge,
        image=None,
    ):
        if image is None and not str(prompt).strip():
            raise ValueError(
                "LM Studio Chat: type a prompt or connect an image (or both)."
            )
        picture = (
            image_data_url(image, int(image_max_edge)) if image is not None else None
        )
        payload = build_chat_payload(
            model, system_prompt, prompt, picture, temperature, max_tokens, seed
        )
        url = chat_completions_url(endpoint)
        # The POST blocks for as long as the model generates; a worker thread
        # keeps the executor's event loop answering the UI meanwhile.
        data = await asyncio.to_thread(request_chat, url, payload, int(timeout_seconds))
        text, thinking = split_reasoning(parse_chat_text(data))
        return (text, thinking)


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LmStudioChat": AusBossLmStudioChat}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LmStudioChat": "LM Studio Chat (AusBoss)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
