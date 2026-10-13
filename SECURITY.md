# Security

ComfyUI answers `/prompt` and custom-node routes without a login, so anyone
who can reach a ComfyUI server can queue a workflow or call a node's route.
This pack treats every widget value and route parameter as untrusted and
follows a few fixed rules.

## What the pack does and does not do

- **Files stay inside ComfyUI's folders.** Save Image writes only to
  ComfyUI's output folder or a subfolder of it, and Save Video checks its
  prefix and final file the same way. Image Compare's Erase save never
  takes a file to read from the browser: it mixes the two previews that node
  made in its last run. The name typed for the new files is a plain name
  with no folder in it, and they go straight into the output folder. Load Video picks from the input
  folder; the video transform nodes read a video picked from a list of the
  input or the output folder, by the name ComfyUI gives it there
  (`clip.mp4 [output]`), and their uploader streams into the input folder.
  No input opens a whole path as given. Absolute paths, `..`, `~`, Windows drive and
  alternate-stream syntax, UNC paths and symlinks that lead outside those
  folders are refused.
- **Routes answer with data, not files.** The pack's routes send JSON and
  small pictures made for the request (a video frame, a gallery tile, a
  LoRA's preview). The only files sent as they are on the disk are the
  pack's own scripts. An error message never names a place on the server's
  disk.
- **The server makes no network requests.** The pack's Python code never
  contacts a host. The one exception is a button you click: LoRA Loader's
  **Fetch Civitai info** has your browser ask civitai.com about that one
  LoRA, by its SHA256 hash, and the answer is saved beside the LoRA as
  `<model>.civitai.info` (inside ComfyUI's LoRA folders). The pack checks
  that the answer describes the same file before saving it. Nothing is sent
  until you click, and the button can be turned off in the node's settings.
- **No code execution.** Math Expression parses its text into an
  allowlisted syntax tree of arithmetic and a few math functions; it never
  runs Python source. The pack starts no subprocesses and installs nothing
  at runtime.
- **No automatic downloads.** You place model weights (LaMa, RAFT optical
  flow) yourself; the pack never fetches them.
- **No raw HTML from workflows.** Workflow Note renders its Markdown into
  text nodes, and its links open only `http(s)` addresses.

`scripts/release_preflight.py` fails a release whose shipped code contains an
HTTP or socket client.

These rules protect a ComfyUI server from the requests it receives. They do
not defend against someone who can already change files on the ComfyUI
machine, and exposing ComfyUI beyond a trusted network is still a risk of
its own.

## Reporting a vulnerability

Report privately through this repository's **Security** tab →
**Report a vulnerability**. If that option is not offered, open an issue
asking for a private contact and leave the details out of it.

Fixes land on `main` and ship in the next release; the
[CHANGELOG](CHANGELOG.md) records security-relevant changes.
