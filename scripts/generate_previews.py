import os
import urllib.request
import json

TTS_URL = "http://localhost:8080/v1/audio/speech"
OUTPUT_DIR = os.path.join("frontend", "public", "audio", "previews")

voices = {
    "aria": {
        "voice": "nova",
        "text": "Hello! I'm Dr. Mariam — ready to help you learn something amazing today.",
    },
    "jenny": {
        "voice": "shimmer",
        "text": "Hey there! I'm Dr. Mariam — let's make learning fun and easy together!",
    },
    "sonia": {
        "voice": "alloy",
        "text": "Good day! I'm Dr. Mariam — it would be my pleasure to guide you through your studies.",
    },
    "guy": {
        "voice": "onyx",
        "text": "Welcome! Let's take this one step at a time, nice and easy.",
    },
    "christopher": {
        "voice": "echo",
        "text": "Good day! I'm here as your dedicated tutor for every question you have.",
    },
    "ryan": {
        "voice": "fable",
        "text": "Hey there! Let's dive in and explore something new together!",
    },
}


def generate_previews():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for name, config in voices.items():
        output_path = os.path.join(OUTPUT_DIR, f"{name}.mp3")
        payload = json.dumps(
            {
                "model": "tts-1",
                "input": config["text"],
                "voice": config["voice"],
                "response_format": "mp3",
                "speed": 1.0,
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            TTS_URL, data=payload, headers={"Content-Type": "application/json"}
        )

        try:
            print(f"Generating preview for {name} ({config['voice']})...")
            with urllib.request.urlopen(req) as response:
                with open(output_path, "wb") as f:
                    f.write(response.read())
            print(f"Saved {output_path}")
        except Exception as e:
            print(f"Failed to generate {name}: {e}")


if __name__ == "__main__":
    generate_previews()
