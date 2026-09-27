# Proof packages

A fix or a model is not done when its tests pass. It is done when ausboss can
see it work. Every fix PR and every model release (a LoRA, a new workflow
behaviour) ships a **proof package**. It's built by whoever did the work,
before asking for a merge or a publish.

## What goes in it

1. **The claim.** One short paragraph covering three things:
   - what was broken, or what the model does;
   - who ran into it (an issue, a Civitai comment, a test);
   - where the cause lives (`file:line` or the workflow node).
2. **A test that fails on main and passes on the branch** (fixes only). Name
   the test and show the command. Give both results: main failing, and the
   branch passing.
3. **Before/after evidence from real runs.** Make one comparison sheet per claim:
   - one row, up to four panels;
   - an amber outline on the failing panel, and no zoom rows;
   - the measured numbers beside it: px shift, ΔE, % of the fill left gray, seam step.

   Use model-free runs when the bug is model-free, because they are exact and
   fast. Add a few real model renders when the claim is about what a model
   does with the result.
4. **A dev server ausboss can click.** Run a private ComfyUI on the branch;
   see [Dev servers](#dev-servers). In its workflow sidebar, make a folder
   `PROOF - <branch or model>` holding:
   - the A/B workflow(s), with fixed seeds;
   - a Workflow Note with the checklist: what to open, what to press, and what
     you should see on main versus the branch.

   Where the "before" needs old code, run a second server on `origin/main` with
   the same folder.
5. **Status.** Give the branch, its commits, the PR link, the CI state, the
   dependencies and merge order, and what is left.

Keep the evidence in `_scratch/proof/<name>/` (gitignored), with `proof.md`
summarising points 1–5 and giving the server URLs. Tell ausboss about the
servers and the `PROOF` folder directly, in the session and in the project's
status notes.

**The PR is public.** Its **Proof** section holds only what anyone can check
from the repo: the claim, the tests by name with main failing and the branch
passing, and the measured numbers. Server URLs, ports, workflow folders,
`_scratch` paths, sheet files and scripts that aren't in the repo never go in a
PR description or a commit message. They only work on ausboss's machine.

## Models (LoRAs, new model workflows)

- **Held-out pictures only.** Use pictures that were never in training, cropped
  from originals you have, so the original is the answer key.
- **With vs without,** at the same seed and prompt. Report:
  - kept-area PSNR: does the picture stay put;
  - fill error against the original;
  - failure counts: gray left, shifted picture, visible seam.
- **Show at least one honest loss.** A result where the model doesn't help is
  part of the proof.
- **The same test workflows on a dev server,** with the model rows ready to
  switch on and off.

## Dev servers

The ports, folders and GPU rules for these servers belong to ausboss's machine,
so they live in ausboss's creator playbook (the `comfy-community` shared skill,
`references/testing.md`), not in this repo. A server's URL goes in `proof.md`
and in the report to ausboss, never in the PR.
