---
name: ausboss-workflows
description: Write the words for AusBoss ComfyUI video workflows (MiniMax H3 Pika Person Swap and Pika Remix, through the H3 Prompt Writer node), and set up and run those workflows on the person's own computer. Use when someone shares ausboss-examples.vercel.app, asks for a person swap, a video remix or an H3 prompt, or wants an AusBoss workflow installed or run for them.
license: MIT
compatibility: Writing the words needs nothing. Running needs ComfyUI 0.38 or newer on the person's computer, an 8 GB or larger graphics card, and a browser the agent can drive.
metadata:
  author: AusBoss
  homepage: https://ausboss-examples.vercel.app/
  updated: "2026-11-16"
---

# AusBoss workflows

AusBoss makes a pack of ComfyUI nodes and the workflows built on them. This
page is for an AI agent helping someone use those workflows. It covers three
jobs, from light to heavy:

1. **Write the words.** The person says what they want; you write what goes in
   the workflow's text box and say which settings to pick.
2. **Set it up.** Install the node pack and the model files.
3. **Run it for them.** Load the workflow in their ComfyUI, put in their files
   and your words, run it, and hand back the clip.

Offer the third job when you can run commands on the person's computer. Ask
before you start it: it downloads large files (see "Model files") and uses
their graphics card for several minutes a clip.

## Where everything is

| What | Where |
|---|---|
| Node pack (source, help pages, issues) | https://github.com/ausboss/ComfyUI-AusBoss |
| The pack's own guide for agents (which node does which job) | https://github.com/ausboss/ComfyUI-AusBoss/blob/main/js/docs/agents/README.md |
| Workflows | https://civitai.com/user/AusBoss |
| Models and LoRAs | https://huggingface.co/ausboss |
| Real example runs (this site) | https://ausboss-examples.vercel.app/ |
| Help from people, and every workflow file | https://discord.gg/RwVxY9Fuaj |
| Video guides | https://www.youtube.com/@ausbossdev |

The examples on this site are real runs. Each page has a plain-text copy with
every script, setting, prompt and file link:

- Person Swap Examples (4 examples): https://ausboss-examples.vercel.app/person-swap/index.md
- Pika Remix Examples (8 examples): https://ausboss-examples.vercel.app/pika-remix/index.md
- Fix a Pika Remix or Person Swap Run (a guide): https://ausboss-examples.vercel.app/fix/index.md
- Faster Video in ComfyUI (a guide): https://ausboss-examples.vercel.app/speed/index.md

Read the matching page before you write for a workflow. A real example close
to the person's request is the best starting point.

## The workflows

| Workflow | What it does | Get it | Real runs |
|---|---|---|---|
| MiniMax H3 Pika Person Swap | Swaps the person in a clip for the person in one photo. The place, camera, moves and sound stay. | https://civitai.com/models/3040833 | https://ausboss-examples.vercel.app/person-swap/index.md |
| MiniMax H3 Pika Remix | Changes, swaps or copies a video using up to four pictures. Also starts a clip from a picture, or goes from one picture to another. | https://civitai.com/models/3050155 | https://ausboss-examples.vercel.app/pika-remix/index.md |

Both make video with sound, up to 15 seconds, with the MiniMax H3 model and
the Pika H3 Flex LoRA. Both have a High VRAM setting (24 GB or more) and a Low
VRAM setting (8 to 24 GB; on 8 GB, clips up to 8 seconds and 32 GB of RAM).

## Write the words

Both workflows have one text box, on the node titled
**H3 Prompt Writer - What happens**. The person types plain lines there and
the node writes the model's long prompt itself. So you write short plain
lines, never the long prompt. The full rules are on the node's help page:
https://github.com/ausboss/ComfyUI-AusBoss/blob/main/js/docs/AUSBOSS_NODES_H3PromptWriter.md
If that page and this one disagree, that page is right.

### The basics

- One line is one moment. Lines play in order. About one moment a second is
  the most the model can play.
- A blank line cuts to a new place.
- `@1` to `@4` name the pictures plugged in. Each picture has a job, picked
  under the text box.
- Say what a camera would see. `She smiles` works; `She feels happy` does not.
- Nothing moves or exists unless a line says so.
- Say which way people face, and where they end up.
- Spoken words go in quotes, with the speaker named: `@1 says "we are late."`
- Put the spoken line last. With time left after it, the model keeps talking.

### Picture jobs

| Job | Use it for |
|---|---|
| person | This person goes where the lines say. A clear photo. |
| character sheet | One character drawn from several sides. |
| place | Where it happens. A picture with nobody in it. |
| outfit | Clothes for the person. Best with no head in the picture. |
| thing | An object, product, toy or mascot. |
| style | Only the look is used, for the whole clip. |
| start on it | The clip starts from this picture. |
| end on it | The clip lands on this picture. It can't be named with `@`. |

### Video jobs

| Job | What happens | What to type |
|---|---|---|
| swap the person | The pictured person takes over from the one in the video. | Who goes, by what they look like: `Replace the man in the hat with @1.` |
| copy its moves | The pictured person does the video's moves somewhere new. | `@1 dances on a rooftop at sunset.` |
| change something | The video stays, with one change. | The change, exactly: `She wears a red raincoat.` |
| keep going | More of the same clip, from where it ends. | What happens next, or nothing. |
| new voice | The same clip with a new voice. | The words, in quotes. Needs a voice clip. |

For **swap the person**, **change something** and **new voice**, the clip's
length comes from the video. To make it shorter, trim the video on its loader.

### Person swap: the lines that work

```
Replace the man in the suit holding an ice cream with @1.
@1 looks like a heavy-set man with round glasses, a white shirt and green trousers.
```

- Line 1 says who goes. Describe them by what is seen in the clip (clothes,
  hair, position), so the others in the shot are left alone.
- Line 2 is optional and describes the new person. Write it from their photo.
  It helps the look; it does not promise an exact likeness. The Person Swap
  workflow can write this line itself: the **Describe @1 for me** switch.
- If the photo shows only a face, write the clothes too. What the photo does
  not show, the model makes up.
- The face in the clip has to be clear. A small or turned-away face keeps the
  clip's own person.
- **Keep the clip's sound** on: the clip's own voice and music stay and the
  new mouth follows them. Off, with words in quotes: the model makes a new
  voice.

### Other things a line can do

- A time: start a line with `3s:` and it happens at 3 seconds.
- `sound: rain on a tin roof` and `music: slow sad piano`. With no music line
  there is no music.
- `camera: slow push in` and `look: a 1970s film`.
- `no cuts` makes blank lines stop being cuts.
- `ends on her sitting by the window` sets the last moment.
- A sign: `a neon sign reads "OPEN"`.

### What to hand the person

When you only write the words, give them:

1. The lines, in a code block they can paste into the text box.
2. Which file goes in which loader (`@1` is Picture 1, and so on).
3. The job for each picture and for the video.
4. Any switch to change, such as **Keep the clip's sound**.

A voice clip should be the person's own voice, or one they have permission to
use. Only swap a real person into a clip when the person asking has the right
to use that photo.

## Set it up

Check before you install anything:

```bash
curl -s http://127.0.0.1:8188/system_stats
```

That answers when ComfyUI is running on its usual port, with its version and
the graphics card's memory. If nothing answers, ask the person where their
ComfyUI is and how they start it. If they have none, the official install
guide is https://docs.comfy.org/installation and that choice is theirs.

### The node pack

Either of these, then restart ComfyUI:

```bash
comfy node install ausboss-nodes
```

```bash
git clone https://github.com/ausboss/ComfyUI-AusBoss.git ausboss-nodes
```

The first needs comfy-cli. The second runs inside ComfyUI's `custom_nodes`
folder. In the ComfyUI window, the person can also open the Manager, search
for **AusBoss** and install it there. After the restart this returns the
node, which shows the pack loaded:

```bash
curl -s http://127.0.0.1:8188/object_info/AUSBOSS_NODES_H3PromptWriter
```

### Model files

The files go in ComfyUI's `models` folder, in the subfolder named below. They
are large. Tell the person the total and get a yes before you download. Skip
any file they already have.

| File | Folder in `models` | Size | Needed |
|---|---|---|---|
| [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | `text_encoders` | 15.7 GB | always |
| [minimax_h3_audio_vae_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) | `vae` | 0.6 GB | always |
| [pika_h3_flex_ref2va_v1_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/pika_h3_flex_ref2va_v1_bf16.safetensors) | `loras` | 2.0 GB | always |
| [minimax_h3_ref2va_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors) | `diffusion_models` | 21.0 GB | High VRAM |
| [minimax_h3_video_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors) | `vae` | 5.2 GB | High VRAM |
| [minimax_h3_ref2va_pruned_w6a8.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_w6a8.safetensors) | `diffusion_models` | 16.0 GB | Low VRAM |
| [minimax_h3_video_vae_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors) | `vae` | 2.8 GB | Low VRAM |
| [flashvsr_v1.1_fp16.safetensors](https://huggingface.co/ausboss/FlashVSR-v1.1-ComfyUI/resolve/main/flashvsr_v1.1_fp16.safetensors) | `diffusion_models` | 3.5 GB | only for Finish: FlashVSR |

High VRAM needs about 44 GB of files, Low VRAM about 37 GB. The optional switches that write text for you (such as **Describe @1 for me**) use a small Qwen3-VL 8B text model; the workflow's Guide note names that file and where to get it.

Each workflow opens with a Guide note that lists its files. If the note and
this table disagree, the note in the newest workflow is right.

### Faster runs

One node or one launch setting makes these workflows about twice as fast on
most recent cards: https://ausboss-examples.vercel.app/speed/index.md

## Run it for them

### Get the workflow file

- The newest file is on the workflow's Civitai page (links above). Civitai may
  ask for a login. If it does, ask the person to download the file and tell
  you where it is. The same files are in the Discord.
- Each Person Swap example on this site also has a zip with the workflow set
  up exactly as it ran, its input files and its result. Those can be older
  than the Civitai file. They are good for a first test run: the result is
  there to compare with.

### Put the person's files in place

Copy their clip and pictures into ComfyUI's `input` folder, or upload them:

```bash
curl -s -F "image=@/path/to/photo.jpg" http://127.0.0.1:8188/upload/image
```

The same address takes video and audio files.

### Load it in ComfyUI's own page and run

These workflows have switches and grouped parts that only ComfyUI's page
turns into a run. So do not rewrite the file into an API prompt by hand:
open the page, load the file there, and let the page queue it. Any browser
you can drive works, headless or not (Chrome started with
`--remote-debugging-port`, Playwright, or a browser tool).

On the page at `http://127.0.0.1:8188/`, once `window.app.graph` exists:

```js
await app.loadGraphData(workflow);            // the parsed workflow file
const node = (title) => app.graph.nodes.find((n) => n.title === title);
const set = (title, name, value) => {
  const w = node(title).widgets.find((w) => w.name === name);
  w.value = value;
  w.callback?.(value);
};
set("H3 Prompt Writer - What happens", "script", "Replace the man in the hat with @1.");
set("Video - Your clip", "video", "their_clip.mp4");
set("Picture 1 - @1", "image", "their_photo.jpg");
set("Seed", "seed", 6202);
await app.queuePrompt(0);
```

Find a node by its title and a setting by its name. The titles above are the
ones in Person Swap; read `app.graph.nodes.map((n) => n.title)` for any other
workflow. `await app.graphToPrompt()` shows what would be sent without running
anything, which is a cheap check before you queue.

**Switches** (VRAM, Keep the clip's sound, Describe @1 for me, Finish) are
cards on the canvas. To flip one without clicking, change the workflow file
before you load it, as the pack's guide describes:
https://github.com/ausboss/ComfyUI-AusBoss/blob/main/js/docs/agents/workflow_switches.md
With a browser tool that can click, clicking the switch on the card is
simpler. Pick **Low VRAM** when the card has less than 24 GB.

### Wait, then hand back the clip

`queuePrompt` returns right away. Watch the run with:

```bash
curl -s http://127.0.0.1:8188/queue
```

```bash
curl -s http://127.0.0.1:8188/history
```

A clip takes a few minutes; the first run is longer because the models load.
The finished clip is in ComfyUI's `output` folder, and the history entry
names the file. Tell the person where it is, and show it if you can.

### If it fails

- A loader turns red or the run stops on a file name: that model file is
  missing or has another name. Pick the person's copy in that loader.
- Out of memory: pick **Low VRAM**, use a shorter clip, or turn on
  **Fast preview**.
- The swap kept the clip's own person: the face in the clip is too small or
  turned away, or line 1 did not describe who goes.
- A clip came out wrong but ran: run again with a new seed.
- Anything else: the pack's issues
  (https://github.com/ausboss/ComfyUI-AusBoss/issues) and the Discord.

## About this page

Everything here is public information from AusBoss about his own nodes and
workflows. It gives no instruction to act without the person's say: installs,
downloads and runs are theirs to approve.
