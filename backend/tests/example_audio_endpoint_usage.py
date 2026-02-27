"""
Example usage of the audio file serving endpoint

This demonstrates how to:
1. Generate audio with TTS
2. Access the audio file via the HTTP endpoint
3. Use the audio URL in a client application
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.tts.edge_tts_provider import EdgeTTSProvider


async def example_audio_workflow():
    """
    Example workflow: Generate audio and get the URL for serving
    """
    print("Audio Endpoint Usage Example")
    print("=" * 60)

    # Step 1: Generate audio
    print("\n1. Generate audio with TTS")
    tts = EdgeTTSProvider()

    session_id = "user-session-abc123"
    message_id = "msg-001"
    text = "Welcome to the AI Avatar Chat application!"

    result = await tts.generate(text=text, session_id=session_id, message_id=message_id)

    print(f"   ✓ Audio generated: {result.file_path}")
    print(f"   ✓ Duration: {result.audio_duration_ms:.0f}ms")

    # Step 2: Construct the audio URL
    print("\n2. Construct audio URL for client")
    audio_url = f"/api/v1/audio/{session_id}/{message_id}.mp3"
    print(f"   URL: {audio_url}")

    # Step 3: Full URL for frontend
    print("\n3. Full URL for frontend (assuming backend at localhost:8000)")
    full_url = f"http://localhost:8000{audio_url}"
    print(f"   Full URL: {full_url}")

    # Step 4: Example WebSocket message
    print("\n4. Example WebSocket message to send to client")
    message = {
        "type": "tts.ready",
        "data": {
            "session_id": session_id,
            "message_id": message_id,
            "audio": {
                "url": audio_url,
                "mime": "audio/mpeg",
                "duration_ms": int(result.audio_duration_ms),
            },
        },
    }
    print(f"   Message: {message}")

    # Step 5: Frontend usage
    print("\n5. Frontend usage (JavaScript)")
    print(
        """
    // In your React component:
    const audioUrl = message.data.audio.url;
    const audio = new Audio(`http://localhost:8000${audioUrl}`);
    audio.play();
    """
    )

    print("\n" + "=" * 60)
    print("✓ Example complete!")

    # Cleanup
    import os

    try:
        os.remove(result.file_path)
        os.rmdir(os.path.dirname(result.file_path))
    except:
        pass


if __name__ == "__main__":
    asyncio.run(example_audio_workflow())
