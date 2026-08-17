"""LM Studio chat plumbing: URL, payload, image encoding, response parsing.

Everything except the actual HTTP POST is pure and covered by offline tests.
The server speaks the OpenAI-compatible chat completions API, so this also
works against any endpoint that does (Ollama's compat mode, llama.cpp's
server, a remote box) — LM Studio is just the default address and the error
text's vocabulary.

Stdlib urllib only: the pack adds no pip dependencies for one POST.
"""

from __future__ import annotations

import base64
import io
import json
import re
import urllib.error
import urllib.request

import torch

DEFAULT_ENDPOINT = "http://127.0.0.1:1234/v1"

_CONNECT_HINT = (
    "could not reach {url} - is the LM Studio server running? Start it from "
    "LM Studio's Developer tab (or `lms server start`), and check the port."
)

# <think>...</think> blocks from reasoning models (DeepSeek R1 family and
# friends). Pasting them into a prompt is never what a workflow wants, so
# they are split onto their own output. An unclosed block - the model hit
# max_tokens mid-thought - counts as reasoning to the end. Custom tag pairs
# (Granite's <|start_of_thought|>, and friends) compile on demand and cache.
_THINK_PATTERNS: dict[tuple[str, str], re.Pattern] = {}


def _think_pattern(open_tag: str, close_tag: str) -> re.Pattern:
    key = (open_tag, close_tag)
    pattern = _THINK_PATTERNS.get(key)
    if pattern is None:
        pattern = re.compile(
            re.escape(open_tag) + r"(.*?)(?:" + re.escape(close_tag) + r"|\Z)",
            re.IGNORECASE | re.DOTALL,
        )
        _THINK_PATTERNS[key] = pattern
    return pattern


def chat_completions_url(endpoint: str) -> str:
    """The chat completions URL for whatever spelling of the endpoint we got.

    Accepts a bare host:port, an .../v1 base (LM Studio's own display), or a
    full .../chat/completions and normalizes to the full route. No scheme
    means http, which is what a local server is."""
    text = str(endpoint or "").strip().rstrip("/")
    if not text:
        text = DEFAULT_ENDPOINT.rstrip("/")
    if "://" not in text:
        text = f"http://{text}"
    if text.endswith("/chat/completions"):
        return text
    if text.endswith("/v1"):
        return f"{text}/chat/completions"
    return f"{text}/v1/chat/completions"


def models_url(endpoint: str) -> str:
    """The /v1/models URL for whatever spelling of the endpoint we got."""
    text = str(endpoint or "").strip().rstrip("/")
    if not text:
        text = DEFAULT_ENDPOINT.rstrip("/")
    if "://" not in text:
        text = f"http://{text}"
    if text.endswith("/chat/completions"):
        text = text[: -len("/chat/completions")]
    if text.endswith("/v1"):
        return f"{text}/models"
    return f"{text}/v1/models"


def list_models(endpoint: str, timeout_seconds: int = 6) -> list[str]:
    """Model ids the server reports at /v1/models, sorted.

    Same error vocabulary as the chat call: what failed, at which URL, and
    what to do about it."""
    url = models_url(endpoint)
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=max(1, int(timeout_seconds))) as reply:
            raw = reply.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"LM Studio: HTTP {exc.code} from {url}") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("LM Studio: " + _CONNECT_HINT.format(url=url)) from None
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        raise RuntimeError(
            f"LM Studio: {url} answered, but not with JSON - check that the "
            "endpoint points at an OpenAI-compatible server."
        ) from None
    rows = data.get("data") if isinstance(data, dict) else data
    names = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("id"):
            names.append(str(row["id"]))
        elif isinstance(row, str):
            names.append(row)
    return sorted(set(names))


def register_lmstudio_routes() -> None:
    """The endpoint-test / model-list route behind the node's toolbar."""
    try:
        import asyncio as _asyncio

        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return
    prompt_server = getattr(PromptServer, "instance", None)
    if prompt_server is None or getattr(prompt_server, "_ausboss_lmstudio_routes", False):
        return
    prompt_server._ausboss_lmstudio_routes = True

    @prompt_server.routes.post("/ausboss/lmstudio/models")
    async def ausboss_lmstudio_models(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        endpoint = str(payload.get("endpoint", "") or "")
        try:
            names = await _asyncio.to_thread(list_models, endpoint)
            return web.json_response({"ok": True, "models": names})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)


def image_data_url(image: torch.Tensor, max_edge: int = 0) -> str:
    """The first frame of a BHWC batch as a base64 PNG data URL.

    ``max_edge`` > 0 downscales so the longest edge fits it - vision models
    resize internally anyway, and a smaller upload is dramatically faster to
    encode and to prefill. One frame only: a video batch means "describe
    this shot", and Select Frame (AusBoss) picks which one.
    """
    from PIL import Image

    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("LM Studio Chat expected a BHWC IMAGE batch.")
    frame = (
        (image[0].detach().clamp(0.0, 1.0) * 255.0).round().to(torch.uint8).cpu().numpy()
    )
    if frame.ndim == 3 and frame.shape[-1] >= 3:
        picture = Image.fromarray(frame[..., :3], "RGB")
    else:
        picture = Image.fromarray(frame.reshape(frame.shape[0], frame.shape[1]), "L")
    limit = int(max_edge)
    if limit > 0 and max(picture.size) > limit:
        scale = limit / max(picture.size)
        new_size = (max(1, round(picture.width * scale)), max(1, round(picture.height * scale)))
        picture = picture.resize(new_size, Image.LANCZOS)
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def build_chat_payload(
    model: str,
    system_prompt: str,
    prompt: str,
    image_url: str | None,
    temperature: float,
    max_tokens: int,
    seed: int,
    advanced: dict | None = None,
) -> dict:
    """The OpenAI-compatible request body.

    An empty model name is omitted so the server answers with whatever it
    has loaded - the reason there is no fetched model dropdown: a dropdown
    populated at ComfyUI startup goes stale (or empty) whenever LM Studio
    was not running yet. max_tokens -1 is omitted, leaving the length to
    the server. The seed is always sent; whether the server honors it, a
    changed seed re-rolls this node's cached result either way.
    """
    messages: list[dict] = []
    system = str(system_prompt or "").strip()
    if system:
        messages.append({"role": "system", "content": system})
    text = str(prompt or "").strip()
    if image_url:
        content: list[dict] = []
        if text:
            content.append({"type": "text", "text": text})
        content.append({"type": "image_url", "image_url": {"url": image_url}})
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": text})
    payload: dict = {
        "messages": messages,
        "temperature": float(temperature),
        "seed": int(seed),
        "stream": False,
    }
    name = str(model or "").strip()
    if name:
        payload["model"] = name
    if int(max_tokens) > 0:
        payload["max_tokens"] = int(max_tokens)
    merge_advanced_payload(payload, advanced)
    return payload


def merge_advanced_payload(payload: dict, advanced: dict | None) -> dict:
    """Fold the gear-menu sampling knobs into the request body.

    Values sitting on their neutral defaults are omitted so the everyday
    request stays exactly what it always was and the server's own defaults
    keep applying. ``thinking_mode`` on/off rides the chat_template_kwargs
    convention (honored by Qwen-style templates, ignored elsewhere);
    ``idle_unload_seconds`` becomes LM Studio's JIT ``ttl``.
    """
    if not advanced:
        return payload
    top_p = float(advanced.get("top_p", 1.0))
    if top_p < 1.0:
        payload["top_p"] = top_p
    top_k = int(advanced.get("top_k", 0))
    if top_k > 0:
        payload["top_k"] = top_k
    repeat_penalty = float(advanced.get("repeat_penalty", 1.0))
    if repeat_penalty != 1.0:
        payload["repeat_penalty"] = repeat_penalty
    min_p = float(advanced.get("min_p", 0.0))
    if min_p > 0.0:
        payload["min_p"] = min_p
    presence_penalty = float(advanced.get("presence_penalty", 0.0))
    if presence_penalty != 0.0:
        payload["presence_penalty"] = presence_penalty
    ttl = int(advanced.get("idle_unload_seconds", 0))
    if ttl > 0:
        payload["ttl"] = ttl
    mode = str(advanced.get("thinking_mode", "model default"))
    if mode in ("on", "off"):
        payload["chat_template_kwargs"] = {"enable_thinking": mode == "on"}
    return payload


def parse_chat_text(data: object) -> str:
    """The assistant text out of a chat completions response.

    Tolerates content arriving as a list of typed parts (some compatible
    servers do that even for plain text); anything else malformed raises
    with the shape it actually saw."""
    if isinstance(data, dict) and isinstance(data.get("error"), (dict, str)):
        error = data["error"]
        message = error.get("message") if isinstance(error, dict) else error
        raise RuntimeError(f"LM Studio: the server reported an error: {message}")
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(
            "LM Studio: unexpected response shape - no choices[0].message.content. "
            "Is the endpoint an OpenAI-compatible chat completions server?"
        ) from None
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content or "")


def split_reasoning(
    text: str, open_tag: str = "<think>", close_tag: str = "</think>"
) -> tuple[str, str]:
    """(answer, reasoning): thinking blocks pulled out of the reply.

    Non-reasoning models pass through untouched with an empty second half.
    Blank or mismatched custom tags fall back to the <think> defaults."""
    raw = str(text or "")
    opener = str(open_tag or "").strip() or "<think>"
    closer = str(close_tag or "").strip() or "</think>"
    pattern = _think_pattern(opener, closer)
    blocks = [match.strip() for match in pattern.findall(raw) if match.strip()]
    answer = pattern.sub("", raw).strip()
    return answer, "\n\n".join(blocks)


def request_chat(url: str, payload: dict, timeout_seconds: int) -> dict:
    """POST the payload and return the parsed JSON response.

    Errors come back as RuntimeError with a message a user can act on -
    what failed, at which URL, and the server's own words when it had any.
    """
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=max(1, int(timeout_seconds))) as reply:
            raw = reply.read()
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            served = json.loads(exc.read().decode("utf-8", "replace"))
            error = served.get("error") if isinstance(served, dict) else None
            detail = error.get("message") if isinstance(error, dict) else str(error or "")
        except Exception:
            pass
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(f"LM Studio: HTTP {exc.code} from {url}{suffix}") from None
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            raise RuntimeError(
                f"LM Studio: no reply from {url} within {timeout_seconds}s - "
                "a large model can need a longer timeout for its first token."
            ) from None
        raise RuntimeError("LM Studio: " + _CONNECT_HINT.format(url=url)) from None
    except TimeoutError:
        raise RuntimeError(
            f"LM Studio: no reply from {url} within {timeout_seconds}s - "
            "a large model can need a longer timeout for its first token."
        ) from None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        raise RuntimeError(
            f"LM Studio: {url} answered, but not with JSON - check that the "
            "endpoint points at an OpenAI-compatible server, not a web page."
        ) from None


__all__ = [
    "DEFAULT_ENDPOINT",
    "build_chat_payload",
    "chat_completions_url",
    "image_data_url",
    "list_models",
    "merge_advanced_payload",
    "models_url",
    "parse_chat_text",
    "register_lmstudio_routes",
    "request_chat",
    "split_reasoning",
]
