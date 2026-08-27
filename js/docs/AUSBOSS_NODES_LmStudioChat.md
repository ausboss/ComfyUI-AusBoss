# LM Studio Chat

Sends a prompt — and optionally an image — to a local LM Studio server and
returns the reply as text. Anything that speaks the OpenAI-compatible chat
API works too: Ollama's compatibility mode, llama.cpp's server, a remote
box. Typical jobs: expanding a rough idea into a full prompt, captioning an
image for img2img, or rewriting text mid-workflow. Chained through the
`history` output, several nodes hold a multi-turn conversation.

## Controls

- **prompt**: What to ask. Required unless an image is connected — an image
  with an empty prompt asks for a plain description.
- **system_prompt** (optional): Role and rules, e.g. *"You write
  single-paragraph Stable Diffusion prompts. No preamble, no quotes."*
  Empty sends no system message.
- **endpoint**: The server's base URL — LM Studio shows it on the Developer
  tab, default `http://127.0.0.1:1234/v1`. A bare `host:port` or a full
  `/v1` path both work. The toolbar under this field has a **Test** button
  (the dot goes green when the server answers) and a **Models** button that
  lists the server's models and picks one into the model field.
- **model**: Model identifier as LM Studio lists it. **Empty uses whatever
  the server has loaded**, which is the everyday case — no fetched dropdown
  to go stale when LM Studio was not running at ComfyUI startup.
- **temperature**: 0 is near-deterministic, 0.7 balanced. Captioning likes
  0.2–0.5.
- **max_tokens**: Longest allowed reply; `-1` leaves it to the server.
  Reasoning models spend tokens thinking before answering — give them room.
- **seed**: Sent to the server, and either way a changed seed re-runs the
  node instead of replaying the cached reply. This is the re-roll knob.
- **timeout_seconds**: How long to wait. Cold-loading a big model or a long
  think can need minutes.
- **image_max_edge**: Downscale a connected image so its longest edge fits
  this before sending (`0` = full size). Vision models resize internally
  anyway, and a smaller upload prefills much faster.
- **image** (optional): For vision models. Only the **first frame** of a
  batch is sent — pick one with Select Frame 🆎 for video. A
  text-only model will refuse an image server-side.
- **unload_llm**: Unload the language model right after the reply (LM
  Studio JIT TTL) so its VRAM is free for the diffusion models and text
  encoders that run next. Overrides the gear menu's idle-unload timer.
- **history** (optional): Prior turns from another LM Studio Chat 🆎
  node's `history` output; they replay before this prompt so the model
  remembers the conversation. Images are not carried between turns.
- **json_schema** (optional): Paste a JSON Schema to force the reply into
  that exact structure (LM Studio structured output). `{"type": "object"}`
  allows any JSON; empty replies as plain text.

## The gear menu

The gear on the endpoint toolbar holds the advanced settings. Each maps to
a hidden widget of the same name, so values save with the workflow and
reach the API like any widget; the gear also stores them as the defaults
new nodes start from. Every sampler is an override: at its neutral value
nothing is sent and the server's own setting stands.

- **Sampling**: `top_p`, `top_k`, `min_p`, `repeat_penalty`,
  `presence_penalty`.
- **Thinking**: `thinking_mode` forces a hybrid reasoning model to think
  or answer directly (Qwen-style templates honor it; others ignore it);
  `reasoning_open_tag` / `reasoning_close_tag` name the tags whose
  contents move to the `thinking` output (default `<think>`…`</think>`).
- **Memory**: `idle_unload_seconds` is LM Studio's JIT TTL — unload the
  model after idling this long (`0` keeps it loaded; the node's
  `unload_llm` switch overrides it with 1 s). `free_comfy_vram` unloads
  ComfyUI's cached models before the request, so a big LLM fits alongside
  a big diffusion model on one GPU.

## Outputs

- **text**: The reply with any `<think>` blocks removed — safe to wire
  straight into a text encoder.
- **thinking**: What a reasoning model thought before answering; empty for
  ordinary models. Handy in a preview node while tuning prompts.
- **history**: The conversation including this exchange — wire into another
  chat node's `history` input to continue the thread.

## Behavior

- Runs off the executor thread, so the UI stays responsive during a long
  generation; the timeout is the backstop.
- Caches like any node: identical inputs replay the saved reply instantly.
  Change the seed to force a fresh generation.
- Errors are actionable: a refused connection says how to start the server,
  an HTTP error carries the server's own message (e.g. *"Model not
  found"*), and a non-JSON reply points at the endpoint setting.

Nothing is sent anywhere except the endpoint you configured.
