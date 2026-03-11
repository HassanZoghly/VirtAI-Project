"""Helper script to run pytest and capture output to a file."""

import subprocess, sys, pathlib

_dir = pathlib.Path(__file__).resolve().parent
out = _dir / "_test_output.txt"
result = subprocess.run(
    [
        sys.executable,
        "-m",
        "pytest",
        "tests/",
        "--ignore=tests/test_asr_manual_verification.py",
        "--tb=short",
        "-q",
    ],
    capture_output=True,
    text=True,
    cwd=str(_dir),
)
out.write_text(result.stdout + "\n" + result.stderr, encoding="utf-8")
