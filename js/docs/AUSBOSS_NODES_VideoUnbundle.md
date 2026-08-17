# Video Unbundle

Unpacks an `AUSBOSS_VIDEO` bundle back into individual wires. The other end
of [Video Bundle](AUSBOSS_NODES_VideoBundle.md), which explains the bundle
wire itself.

## Inputs

- **video**: A bundle from Video Bundle 🆎 or Video Bundle Edit
  🆎.

## Outputs

In order: **frames**, **audio**, **fps**, **frame_count**, **width**,
**height**, **duration**.

The derived four — count, width, height, duration — were computed when the
bundle was built or last edited, so they always describe the frames on the
wire; there is no way for them to drift.

The **audio** output is empty (`None`) when the bundle was built without an
audio track. Wire it into nodes that treat audio as optional — Save Video's
`audio` input, for example — unless you know the bundle carries sound.

No files are read or written; unbundling only unpacks what the wire already
carries.
