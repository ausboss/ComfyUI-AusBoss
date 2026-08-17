"""LM Studio Chat 🆎."""

from __future__ import annotations

import asyncio

from ._lmstudio_helpers import (
    DEFAULT_ENDPOINT,
    build_chat_payload,
    chat_completions_url,
    history_with_turn,
    image_data_url,
    parse_chat_text,
    parse_response_schema,
    register_lmstudio_routes,
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
        "a conditioning prompt. Chain the history output into another chat "
        "node's history input for a multi-turn conversation, and fill "
        "json_schema to force a structured JSON reply. Caches like any "
        "node; change the seed to re-roll the same inputs."
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
                            "Select Frame 🆎 for video. A text-only "
                            "model errors server-side if an image arrives."
                        )
                    },
                ),
                # Everything below is set from the node's gear menu and
                # hidden on the canvas; neutral defaults are omitted from
                # the request so the plain node behaves exactly as before.
                "top_p": (
                    "FLOAT",
                    {
                        "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01,
                        "tooltip": (
                            "Nucleus sampling cap; 1 sends nothing and the "
                            "server default applies."
                        ),
                    },
                ),
                "top_k": (
                    "INT",
                    {
                        "default": 0, "min": 0, "max": 1000, "step": 1,
                        "tooltip": "Top-k sampling cutoff; 0 sends nothing.",
                    },
                ),
                "repeat_penalty": (
                    "FLOAT",
                    {
                        "default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01,
                        "tooltip": "Repetition penalty; 1 sends nothing.",
                    },
                ),
                "min_p": (
                    "FLOAT",
                    {
                        "default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01,
                        "tooltip": "Minimum token probability; 0 sends nothing.",
                    },
                ),
                "presence_penalty": (
                    "FLOAT",
                    {
                        "default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01,
                        "tooltip": "Presence penalty; 0 sends nothing.",
                    },
                ),
                "thinking_mode": (
                    ["model default", "on", "off"],
                    {
                        "default": "model default",
                        "tooltip": (
                            "Force a hybrid reasoning model to think or not "
                            "via chat_template_kwargs (Qwen-style templates "
                            "honor it; others ignore it)."
                        ),
                    },
                ),
                "reasoning_open_tag": (
                    "STRING",
                    {
                        "default": "<think>",
                        "tooltip": (
                            "Tag that opens a reasoning block in the reply; "
                            "the block moves to the thinking output."
                        ),
                    },
                ),
                "reasoning_close_tag": (
                    "STRING",
                    {
                        "default": "</think>",
                        "tooltip": "Tag that closes a reasoning block.",
                    },
                ),
                "idle_unload_seconds": (
                    "INT",
                    {
                        "default": 0, "min": 0, "max": 86400, "step": 5,
                        "tooltip": (
                            "LM Studio JIT TTL: unload the model after "
                            "idling this many seconds. 0 sends nothing."
                        ),
                    },
                ),
                "free_comfy_vram": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Unload ComfyUI's cached models before the "
                            "request so a big LLM fits alongside a big "
                            "diffusion model on one GPU."
                        ),
                    },
                ),
                "unload_llm": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Unload the language model right after the reply "
                            "(LM Studio JIT ttl) so its VRAM is free for the "
                            "diffusion models and text encoders that run "
                            "next. Overrides the gear menu's idle-unload "
                            "timer."
                        ),
                    },
                ),
                "history": (
                    "AUSBOSS_CHAT_HISTORY",
                    {
                        "tooltip": (
                            "Prior turns from another LM Studio Chat 🆎 "
                            "node's history output; they replay before this "
                            "prompt so the model remembers the conversation. "
                            "Images are not carried between turns."
                        )
                    },
                ),
                "json_schema": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "tooltip": (
                            "Paste a JSON Schema to force the reply into "
                            "that exact structure (LM Studio structured "
                            "output). {\"type\": \"object\"} allows any "
                            "JSON; empty replies as plain text."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "AUSBOSS_CHAT_HISTORY")
    RETURN_NAMES = ("text", "thinking", "history")
    OUTPUT_TOOLTIPS = (
        "The model's reply with any <think> blocks removed - safe to wire "
        "straight into a text encoder.",
        "The reasoning a thinking model emitted, empty for ordinary models. "
        "Useful for a preview node while tuning prompts.",
        "The conversation including this exchange - wire into another chat "
        "node's history input to continue the thread.",
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
        top_p=1.0,
        top_k=0,
        repeat_penalty=1.0,
        min_p=0.0,
        presence_penalty=0.0,
        thinking_mode="model default",
        reasoning_open_tag="<think>",
        reasoning_close_tag="</think>",
        idle_unload_seconds=0,
        free_comfy_vram=False,
        unload_llm=False,
        history=None,
        json_schema="",
    ):
        if image is None and not str(prompt).strip():
            raise ValueError(
                "LM Studio Chat: type a prompt or connect an image (or both)."
            )
        response_format = parse_response_schema(json_schema)
        if free_comfy_vram:
            try:
                import comfy.model_management as model_management

                model_management.unload_all_models()
                model_management.soft_empty_cache()
            except Exception:
                pass  # Standalone tests run without ComfyUI; the chat still works.
        picture = (
            image_data_url(image, int(image_max_edge)) if image is not None else None
        )
        payload = build_chat_payload(
            model,
            system_prompt,
            prompt,
            picture,
            temperature,
            max_tokens,
            seed,
            advanced={
                "top_p": top_p,
                "top_k": top_k,
                "repeat_penalty": repeat_penalty,
                "min_p": min_p,
                "presence_penalty": presence_penalty,
                "thinking_mode": thinking_mode,
                # The visible unload switch wins over the gear's idle timer.
                "idle_unload_seconds": 1 if unload_llm else idle_unload_seconds,
            },
            history=history,
            response_format=response_format,
        )
        url = chat_completions_url(endpoint)
        # The POST blocks for as long as the model generates; a worker thread
        # keeps the executor's event loop answering the UI meanwhile.
        data = await asyncio.to_thread(request_chat, url, payload, int(timeout_seconds))
        text, thinking = split_reasoning(
            parse_chat_text(data), str(reasoning_open_tag), str(reasoning_close_tag)
        )
        return (
            text,
            thinking,
            history_with_turn(history, prompt, image is not None, text),
        )


NODE_CLASS_MAPPINGS = {"AUSBOSS_NODES_LmStudioChat": AusBossLmStudioChat}
NODE_DISPLAY_NAME_MAPPINGS = {"AUSBOSS_NODES_LmStudioChat": "LM Studio Chat 🆎"}

register_lmstudio_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
