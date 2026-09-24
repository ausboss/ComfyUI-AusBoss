# Frame Interpolate

Resamples a frame batch from one frame rate to another, so `24 -> 30` works
as naturally as doubling. Every output frame maps to a position on the source
timeline: positions that land exactly on a source frame are copied untouched,
and only the true in-betweens are synthesized.

## Methods

- **blend**: A crossfade between the two neighboring frames. Instant and
  dependency-free, but fast motion looks soft because it averages instead of
  moving pixels.
- **optical flow**: Estimates RAFT motion vectors in both directions, warps
  both neighbors toward the in-between time, and blends the warps. Much
  sharper on motion. It reads torchvision's official RAFT-small checkpoint,
  `raft_small_C_T_V2-01064c6d.pth`, from the torch hub cache
  (`~/.cache/torch/hub/checkpoints/` unless `TORCH_HOME` moves it) and never
  downloads it during a run. Download it from
  `https://download.pytorch.org/models/raft_small_C_T_V2-01064c6d.pth` into
  that folder; without it the node names the exact path it looked in. Or use
  **blend**.

## Scene cuts

Interpolating across a hard cut produces morph artifacts: two unrelated
shots smeared into each other for a frame or two. When the mean absolute
difference between adjacent source frames rises above
**scene_cut_threshold**, the node treats that pair as a cut and holds the
last frame before it instead of morphing. Set the threshold to `0` to
disable detection and interpolate everything.

## Controls

- **frames**: Video frames as a BHWC `IMAGE` batch.
- **source_fps**: Frame rate of the incoming batch; wire Load Video's fps
  output to match the source.
- **target_fps**: Frame rate to resample to. Matching the source rate passes
  the batch through unchanged.
- **method**: `blend` or `optical flow` as described above.
- **scene_cut_threshold**: Cut sensitivity from 0 to 1; `0.35` suits most
  footage, `0` disables.
- **batch_size**: In-between frames computed per batch. Higher is faster but
  uses more VRAM; results land in system memory as each batch finishes.

## Outputs

- **frames**: The resampled BHWC frame batch.
- **fps**: The actual output rate. The output length is rounded to keep the
  clip duration, so this can differ slightly from the request on short
  clips; wire it into Save Video and the timing never drifts.

Neither method performs network requests or writes files. The optical-flow
method reads an existing checkpoint from the local torch hub cache.
