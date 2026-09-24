# Security

ComfyUI answers `/prompt` and custom-node routes without a login, so anyone
who can reach a ComfyUI server can queue a workflow or call a node's route.
This pack treats every widget value and route parameter as untrusted and
follows a few fixed rules.

## What the pack does and does not do

- **Files stay inside ComfyUI's folders.** Save Image writes only to
  ComfyUI's output folder or a subfolder of it, and Save Video checks its
  prefix and final file the same way. Load Video picks from the input
  folder; the video transform nodes' local path mode reads only from the
  input, output and temp folders, and their uploader streams into the input
  folder. Absolute paths, `..`, `~`, Windows drive and alternate-stream
  syntax, UNC paths and symlinks that lead outside those folders are
  refused.
- **No network requests.** Nothing in the pack contacts a host. LoRA
  Loader reads a `.civitai.info` sidecar that another tool left beside a
  LoRA, but never fetches one.
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
