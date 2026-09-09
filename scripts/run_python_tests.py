#!/usr/bin/env python3
"""Run backend test files in fresh processes with the active interpreter.

Several offline tests install small ComfyUI stubs in sys.modules. Isolating
files prevents one test's fake runtime from changing another test's imports.
"""

from pathlib import Path
import os
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent.parent
    paths = [root / name for name in sys.argv[1:]] or sorted((root / "tests").glob("test_*.py"))
    env = {**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "PYTHONDONTWRITEBYTECODE": "1"}
    failed = []
    for path in paths:
        print(f"\n--- {path.name} ---", flush=True)
        try:
            result = subprocess.run([sys.executable, str(path)], cwd=root, env=env, timeout=180)
            if result.returncode:
                failed.append(path.name)
        except subprocess.TimeoutExpired:
            print("Timed out after 180 seconds.", flush=True)
            failed.append(path.name)
    print(f"\n{len(paths) - len(failed)}/{len(paths)} test files passed.", flush=True)
    if failed:
        print("Failed: " + ", ".join(failed), flush=True)
    return bool(failed)


if __name__ == "__main__":
    sys.exit(main())
