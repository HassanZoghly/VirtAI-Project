"""Generate voice preview MP3 files using Microsoft Edge TTS CLI.

Voices and filenames match frontend/src/features/setup/data/voices.js exactly.
Each voice speaks its own greeting text from the data file.
"""

import subprocess
import sys
from pathlib import Path

# (voice_id, filename, greeting_text) — mirrors voices.js
VOICES = [
    (
        "en-US-AriaNeural",
        "aria",
        "Hello! I'm Dr. Mariam — ready to help you learn something amazing today.",
    ),
    (
        "en-US-JennyNeural",
        "jenny",
        "Hey there! I'm Dr. Mariam — let's make learning fun and easy together!",
    ),
    (
        "en-GB-SoniaNeural",
        "sonia",
        "Good day! I'm Dr. Mariam — it would be my pleasure to guide you through your studies.",
    ),
    (
        "en-US-GuyNeural",
        "guy",
        "Welcome! Let's take this one step at a time, nice and easy.",
    ),
    (
        "en-US-ChristopherNeural",
        "christopher",
        "Good day! I'm here as your dedicated tutor for every question you have.",
    ),
    (
        "en-GB-RyanNeural",
        "ryan",
        "Hey there! Let's dive in and explore something new together!",
    ),
]

OUTPUT_DIR = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "public"
    / "audio"
    / "previews"
)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}")

    for voice_id, filename, text in VOICES:
        out_file = OUTPUT_DIR / f"{filename}.mp3"

        if out_file.exists():
            print(f"[SKIP]  {voice_id} — {out_file.name} already exists")
            continue

        print(f"[GEN]   {voice_id} → {out_file.name} ...")
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "edge_tts",
                "--voice",
                voice_id,
                "--text",
                text,
                "--write-media",
                str(out_file),
            ],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"[ERROR] {voice_id} — {result.stderr.strip()}")
        else:
            print(f"[OK]    {voice_id} — saved to {out_file.name}")

    print("\nDone.")


if __name__ == "__main__":
    main()
