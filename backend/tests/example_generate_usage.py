"""
Example usage of EdgeTTSProvider.generate() method
This demonstrates how the method will be used in the conversation pipeline
"""

import asyncio
from pathlib import Path

import pytest

from app.services.tts.edge_tts_provider import EdgeTTSProvider


@pytest.mark.asyncio
async def test_example_usage():
    """Example of how generate() will be used in the conversation pipeline"""

    # Initialize provider
    provider = EdgeTTSProvider()

    # Simulate a conversation
    session_id = "session-abc123"
    message_id = "msg-001"
    text = "Hello! I'm your AI assistant. How can I help you today?"

    print(f"\nGenerating audio for session {session_id}, message {message_id}")
    print(f"Text: {text}")
    print()

    # Generate audio and store it
    result = await provider.generate(text, session_id, message_id)

    # Display results
    print("✅ Audio generation complete!")
    print(f"   File path: {result.file_path}")
    print(f"   Duration: {result.audio_duration_ms:.0f}ms ({result.audio_duration_ms/1000:.1f}s)")
    print(f"   File size: {len(result.audio_bytes):,} bytes")
    print(f"   Visemes: {len(result.visemes)}")
    print(f"   Word boundaries: {len(result.word_boundaries)}")
    print()

    # Verify file exists
    audio_file = Path(result.file_path)
    assert audio_file.exists()
    print(f"✅ File verified at: {audio_file.absolute()}")

    # In the actual pipeline, you would:
    # 1. Return the file path to the client as: /api/v1/audio/{session_id}/{message_id}.mp3
    # 2. Send visemes to the client for lip sync
    # 3. The client would fetch the audio file and play it

    audio_url = f"/api/v1/audio/{session_id}/{message_id}.mp3"
    print("\n📡 Client would receive:")
    print(f"   Audio URL: {audio_url}")
    print(f"   Duration: {result.audio_duration_ms}ms")
    print(f"   Visemes: {len(result.visemes)} events")

    # Clean up (in production, files would be cleaned up after 24 hours)
    import shutil

    session_dir = audio_file.parent
    if session_dir.exists():
        shutil.rmtree(session_dir)
        print("\n🧹 Cleaned up test files")


if __name__ == "__main__":
    asyncio.run(test_example_usage())
