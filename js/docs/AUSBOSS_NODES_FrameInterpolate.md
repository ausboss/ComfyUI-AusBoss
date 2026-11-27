# Frame Interpolate

Changes a clip's frame rate, for example 24 to 30, by making the in-between
pictures. Use it to smooth a generated clip or to match another clip's rate;
`24 -> 30` works as naturally as doubling. Every output frame maps to a
position on the source timeline: positions that land exactly on a source
frame are copied untouched, and only the true in-betweens are synthesized.

## Methods

- **blend**: A crossfade between the two neighboring frames. Instant and
  dependency-free, but fast motion looks soft because it averages instead of
  moving pixels.
- **optical flow (RAFT)** (`optical flow (requires cached RAFT weights)`):
  Estimates RAFT motion vectors in both directions, warps both neighbors
  toward the in-between time, and blends the warps. Much sharper on motion.
  It reads torchvision's official RAFT-small checkpoint,
  `raft_small_C_T_V2-01064c6d.pth`, from the torch hub cache
  (`~/.cache/torch/hub/checkpoints/` unless `TORCH_HOME` moves it) and never
  downloads it during a run. Download it from
  `https://download.pytorch.org/models/raft_small_C_T_V2-01064c6d.pth` into
  that folder; without it the node names the exact path it looked in. Or use
  **blend**.

## Scene cuts

Making in-betweens across a hard cut mixes two shots into each other for a
frame or two. The node finds each cut and holds the last frame before it
instead.

A cut is a change between two frames that jumps out from the frames around
it. That works even when both shots show the same place in the same light,
where the change at a cut can be smaller than fast movement inside one
shot. Any change above **Scene cut** (`scene_cut_threshold`) also counts as
a cut, as it always has. Set it to `0` to turn cut finding off and make
in-betweens everywhere.

## Controls

- **frames**: Video frames as a BHWC `IMAGE` batch.
- **FPS**, left box (`source_fps`): Frame rate of the incoming batch; wire
  Load Video's fps output to match the source.
- **FPS**, right box (`target_fps`): Frame rate to change to. Matching the
  source rate passes the batch through unchanged. A new node starts at
  24 → 30.
- **Method** (`method`): `blend` or **optical flow (RAFT)**, as described above.
- **Scene cut** (`scene_cut_threshold`): A change above this always counts
  as a cut; `0.35` suits most footage, and `0` turns cut finding off. Cuts
  that jump out from the frames around them are found at any setting above
  `0`.
- **Batch** (`batch_size`, starts at `8`): In-between frames computed per batch. Higher is
  faster but uses more VRAM; results land in system memory as each batch
  finishes.

## Outputs

- **frames**: The resampled BHWC frame batch.
- **fps**: The actual output rate. The output length is rounded to keep the
  clip duration, so this can differ slightly from the request on short
  clips; wire it into Save Video and the timing never drifts.

Neither method performs network requests or writes files. The optical-flow
method reads an existing checkpoint from the local torch hub cache.

## Technical details

### How cuts are found

The node makes a small copy of every frame, 64 px on its long side. Each
4 px block of a frame looks for its best match in the frame before it,
moved up to 3 px each way. Movement inside a shot finds its match, so what
is left is small; after a cut the picture is new and the change stays
large, even with the same colors on both sides.

That leftover change is compared with the median of the 4 frame pairs on
each side. A pair is a cut when it is at least 3 times that median and
above 0.02 (on a 0 to 1 scale), so grain in a still shot never counts.
Repeated frames, as in footage drawn on twos or threes, are left out of the
median. A pair is also a cut when its plain mean difference over the full
frame is above **Scene cut**, the rule earlier versions used on its own, so
no cut those versions found is lost.

Measured on seven MiniMax H3 clips with 29 cuts, among them a rooftop clip
whose three cuts scored 0.14 to 0.17 on the plain difference and a street
clip that moved 0.15 inside one shot: every cut stood out at least 4.1
times from its neighbours, and movement inside a shot at most 1.9 times.
All 29 were held and nothing inside a shot was. The plain rule alone,
at `0.35`, held 2 of them.

A cut straight into very fast movement, more than about a twentieth of the
frame from one frame to the next, can stand out less from the shot after
it. A clip of two frames has nothing to compare with; there only the
plain rule applies.
