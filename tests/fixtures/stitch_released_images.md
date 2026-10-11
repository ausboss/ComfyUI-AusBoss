# Stitch Inpaint release references

`stitch_released_images.npz` holds the 23 float32 image tensors used by
`test_stitch_classic_pins.py`. It contains arrays only; loading disables pickle.
These are outputs of released code, not the candidate implementation.

| Keys | Release | Source commit |
| --- | --- | --- |
| `classic_<case>_<strength>_image` | 2.3.0 | `83a6b7448f8438d41309c378b6817dc71057fc04` |
| `blend_in_<case>_0_image` | 2.4.0 | `85b1e122cc82420efadc65b6d7b1c53bf082db4c` |

Case indexes follow `CASES` in the test: Load Image + Pad, turned transform,
straight transform, Crop For Inpaint, video, truncated video. Classic covers
strengths 0, 0.5 and 1; blend in omits Crop For Inpaint and covers strength 0.
The deterministic builders and seeded sampler stand-in are taken unchanged from
`d14b717090d270a49aad60c57d4fe73168c2f6b3:tests/test_stitch_classic_pins.py`.

Generated on Linux x86_64, Python 3.12, torch 2.11.0+cu130 on CPU,
NumPy 2.3.2, Pillow 12.3.0, two CPU threads, MKLDNN enabled.
The original raw hashes already failed four tone-on cases on this CPU, even
with the original release implementations. They are retained in the test for
diagnostics, not used to bless a new implementation.

The fixed references and current implementation were compared on torch 2.10.0
CPU and 2.11.0, with 1/2/8 threads and MKLDNN on/off. Maximum absolute image
difference was 5.0068e-6; all masks were exact, and no rounded 8-bit channels
changed. Thus images allow `atol=1e-5, rtol=0` (0.00255 of an 8-bit step).
This is a CPU regression test, not a promise of bitwise GPU reproducibility.
Shape, dtype and non-finite output errors still fail. A mutation check confirms
a single channel changed by 1/255 fails. The masks were byte-exact in all of
these runs, which shared one CPU; see Blend masks below.
See [PyTorch numerical accuracy](https://docs.pytorch.org/docs/2.11/notes/numerical_accuracy.html)
for why floating-point kernels need not agree bit for bit.

## Blend masks

`stitch_released_masks.npz` holds the 11 float32 blend masks of the same runs:
`classic_<case>_mask` (one per case; the mask is the same at every strength)
and `blend_in_<case>_mask`. Each is the mask whose hash the test pins, and
`test_the_mask_references_are_the_pinned_masks` holds the file to those
hashes, so it carries the released code's masks byte for byte.

A run is compared with these masks at `atol=1e-5, rtol=0`, like the images,
and no longer by hash. On a GitHub-hosted runner two masks came out with
another hash on unchanged code: the straight transform and Crop For Inpaint,
the two whose feather is a blur. The blur's bell curve is `torch.exp`, which
is accurate to under one float32 step but is not rounded the same way on every
CPU. Moving each value of that curve by one float32 step on the reference
machine changes the hash of exactly those two masks, moves them by at most
2.4e-7, and leaves the other four untouched. A blur made 2% wider still fails
both of those cases at every strength.

## Reproducing the references

Run from the repository root with the environment above. Never regenerate from
the code under review. This recipe extracts the named releases into temporary
directories and runs each in a separate process to keep imports independent.
It writes a candidate file; compare its arrays with the checked-in fixture
before deliberately replacing anything.

```python
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import numpy as np

builder_ref = "d14b717090d270a49aad60c57d4fe73168c2f6b3"
builder = subprocess.check_output([
    "git", "show", f"{builder_ref}:tests/test_stitch_classic_pins.py"
])
worker = '''
import runpy, sys, numpy as np
m = runpy.run_path("tests/test_stitch_classic_pins.py")
mode = sys.argv[1]
arrays = {}
for i, (name, build) in enumerate(m["CASES"].items()):
    if mode == "blend_in" and name not in m["BLEND_IN_CASES"]:
        continue
    for strength in (m["STRENGTHS"] if mode == "classic" else (0.0,)):
        stitcher, patch = build()
        extra = {"seam": "blend in"} if mode == "blend_in" else {}
        image, _ = m["stitch"](stitcher, patch, strength, **extra)
        arrays[f"{mode}_{i}_{strength:g}_image"] = image.numpy()
np.savez_compressed("reference.npz", **arrays)
'''
arrays = {}
for mode, ref in (
    ("classic", "83a6b7448f8438d41309c378b6817dc71057fc04"),
    ("blend_in", "85b1e122cc82420efadc65b6d7b1c53bf082db4c"),
):
    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.check_output(["git", "archive", ref])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(tmp, filter="data")
        (Path(tmp) / "tests/test_stitch_classic_pins.py").write_bytes(builder)
        subprocess.run([sys.executable, "-c", worker, mode], cwd=tmp, check=True,
                       env={**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"})
        with np.load(Path(tmp) / "reference.npz", allow_pickle=False) as data:
            arrays.update({key: data[key] for key in data.files})
np.savez_compressed("stitch_released_images.candidate.npz", **arrays)
```

The masks file needs no old checkout: the pins already say what the releases
gave. Run the test's own builders and keep a mask only when its hash is the
pinned one. On a CPU that rounds the blur differently the assert fails and
nothing is written.

```python
import runpy
import numpy as np

m = runpy.run_path("tests/test_stitch_classic_pins.py")
arrays = {}
for index, (name, build) in enumerate(m["CASES"].items()):
    for strength in m["STRENGTHS"]:
        stitcher, patch = build()
        _image, mask = m["stitch"](stitcher, patch, strength)
        assert m["digest"](mask) == m["PINS"][(name, strength)][1], name
        arrays[f"classic_{index}_mask"] = mask.numpy().copy()
    if name in m["BLEND_IN_CASES"]:
        stitcher, patch = build()
        _image, mask = m["stitch"](stitcher, patch, 0.0, seam="blend in")
        assert m["digest"](mask) == m["BLEND_IN_PINS"][name][1], name
        arrays[f"blend_in_{index}_mask"] = mask.numpy().copy()
np.savez_compressed("stitch_released_masks.candidate.npz", **arrays)
```
