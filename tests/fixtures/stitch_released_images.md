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
a single channel changed by 1/255 fails. Mask hashes remain byte-exact.
See [PyTorch numerical accuracy](https://docs.pytorch.org/docs/2.11/notes/numerical_accuracy.html)
for why floating-point kernels need not agree bit for bit.

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
