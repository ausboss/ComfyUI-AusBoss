# Merge Batches

Joins two `IMAGE` batches into one, **a**'s frames first — reassemble a
split batch, append a comparison strip to a run, or chain clips.

## Controls

- **a**: The first batch; its frames lead the result.
- **b**: The second batch, appended after **a**'s frames.
- **on_mismatch**: What to do when the two resolutions differ:
  - `resize to a` (default): **b**'s frames are bilinear-resized to **a**'s
    size.
  - `resize to b`: **a**'s frames are resized to **b**'s size instead.
  - `error`: stop, naming both sizes — for graphs where a silent resize
    would hide a bug.

## Output

- **images**: One batch: **a**'s frames followed by **b**'s.

Matching sizes are concatenated untouched under every policy. Channel counts
must already agree (3-channel with 3-channel, 4 with 4): inventing or
dropping an alpha channel silently is not this node's call to make, so a
mismatch is an error.
