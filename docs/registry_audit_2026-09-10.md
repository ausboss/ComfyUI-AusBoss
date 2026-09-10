# Registry audit — 2026-09-10

The corrected source addresses the known endpoint and media-path risks. It
has not been published as a new version and has not been approved by the
Registry. The exact call site behind the older code-execution verdict is
still unconfirmed.

## Recorded decisions

Checked the Registry versions API with `include_status_reason=true` and
[review issue #216](https://github.com/Comfy-Org/registry-backend/issues/216).
The issue still contains only the publisher's two follow-ups, with no
maintainer response naming the code-execution call site.

| Versions | Current status | Recorded concern |
| --- | --- | --- |
| 1.1.0 / 1.1.1 | Banned | LM Studio's workflow-controlled endpoint enables server-side requests to arbitrary hosts. |
| 1.2.0 / 1.3.0 | Banned | Code execution reachable through `/prompt` or an unauthenticated route; no file or call site identified. |
| 2.0.0 / 2.0.1 | Flagged | Five informational findings: completion audio, two graph connection helpers, Civitai HTTP, and the local-preview environment switch. |

Source: [Registry version records](https://api.comfy.org/nodes/ausboss-nodes/versions?include_status_reason=true).

## Concern-to-evidence map

| Surface | Corrected behavior and evidence |
| --- | --- |
| LM Studio endpoint | Removed from runtime modules, mappings, frontend, and help in 2.0.0. The live candidate registers 35 mappings and no LM Studio node. |
| Save Image arbitrary output directory | Only relative subfolders under ComfyUI output are accepted. Absolute paths, traversal, UNC, and Windows drive/alternate-stream syntax are rejected. The folder route uses the same resolver. |
| Save Image filenames and captions | Check complete batch destinations before writing, including linked filenames, exact names, local prefixes, and caption sidecars. Regression tests and live requests leave outside sentinel files unchanged when symlinks point outside output. |
| Save Video | Check the prefix before core creates directories; check the final destination before encoding. A regression test proves an escaping symlink creates no outside directory and never invokes the encoder. |
| Local video files and previews | Both execution and preview routes enforce ComfyUI input/output/temp containment. The former environment switch grants no access. UNC input paths are refused before resolution. |
| Civitai HTTP | The sole backend HTTP feature uses a fixed HTTPS endpoint, validates cached/computed SHA-256 text, disables redirects, and refuses 3xx responses. Tests prove malformed hashes do not open a session and redirects cannot trigger a second request or metadata write. Lookup sends the model hash, not model contents. |
| Completion sound | A generated in-memory WAV replaces WebAudio connections. The browser decodes and plays the 0.72-second chime after a user gesture; no audio asset or remote fetch is needed. |
| Recreate / replace-missing `.connect()` | Retained: these are LiteGraph workflow-link operations, not sockets. Tests cover the graph behavior. They may still match the Registry's broad informational rule. |
| Math expression | Existing allowlisted AST evaluator remains; it does not evaluate Python source. Its malicious-input regression tests pass. |
| Archive tooling/test findings | Existing `.comfyignore` excludes tests, scripts, CI, agent instructions, and root developer docs. Preflight checks runtime files and example assets remain included. |

The old unrestricted caption write is a plausible explanation for the
1.2.0/1.3.0 verdict: a request could target a custom node's requirements
file, affecting a later dependency installation. This is an audit inference,
not an assertion that the Registry confirmed this exact chain. The prior
folder-approval proposal in PR #58 is superseded by strict media containment;
it must not be merged back into this candidate.

Model loading and LoRA metadata remain separate existing features: registered
model paths resolve through ComfyUI, weight loading uses safe-loading modes,
and trigger/hash stores use fixed application filenames. Civitai metadata
uses a derived `.civitai.info` sidecar. The media-path rule does not mean the
pack never reads installed models or its own settings. This audit does not
claim to sandbox a local attacker who can replace server files concurrently.

## Validation

- 29/29 backend test files: 674 tests, all passed using the installed ComfyUI
  interpreter and core video integration. The initial sandbox run prevented
  dependency-cache initialization; a run with normal cache access passed.
- 461 JavaScript tests passed with the same isolation mode used by CI.
- Node validator, release preflight, and whitespace checks passed.
- An isolated CPU-only ComfyUI instance on port 8191 passed 11 live API checks:
  registration, ordinary image/caption saving, absolute path rejection,
  filename and caption symlink rejection, folder-route rejection cases,
  rejected outside/network video previews, and a working managed video preview.
- Real browser checks verified valid and invalid Save Image card states,
  serialized folder values, and chime decoding/playback after a user gesture.
- The shipped Image and Video Transform and node-tour workflows loaded with
  no missing classes, overlaps, or browser exceptions.

Local evidence remains under `_scratch/registry-*` and
`_scratch/node_screenshots/registry_save_*.png`. An older clean-install test
copy was moved out of the checkout because the mapping scanner detected its
duplicate node definitions. No scanner rule was weakened.

## Activation remains a separate gate

Merging these changes does not modify the published 2.0.1 archive. An
explicitly authorized release must bump both version fields, retitle the
Unreleased changelog, pass preflight, publish once, and verify the exact
version's Registry status. A successful upload or CI run is not approval.
Only `NodeVersionStatusActive` establishes availability through Manager.
Request review of that corrected artifact on issue #216 with its version id
and immutable source commit; do not request clearance for the older banned
artifacts. Obtain authorization before posting that follow-up.
