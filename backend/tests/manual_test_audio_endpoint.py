"""
Manual integration test for audio endpoint

Run this script to test the audio endpoint with a real audio file.
This creates a test audio file, serves it, and verifies the response.
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient

from app.main import app
from app.services.tts.edge_tts_provider import EdgeTTSProvider


async def test_audio_endpoint_integration():
    """Integration test: Generate audio with TTS and serve it via endpoint"""
    print("=" * 80)
    print("Audio Endpoint Integration Test")
    print("=" * 80)

    # Step 1: Generate audio using TTS
    print("\n[1] Generating audio with Edge TTS...")
    tts = EdgeTTSProvider()
    session_id = "test-integration-session"
    message_id = "test-integration-message"
    text = "Hello, this is a test of the audio serving endpoint."

    try:
        result = await tts.generate(text=text, session_id=session_id, message_id=message_id)
        print("✓ Audio generated successfully")
        print(f"  - File path: {result.file_path}")
        print(f"  - Duration: {result.audio_duration_ms:.0f}ms")
        print(f"  - Size: {len(result.audio_bytes):,} bytes")
        print(f"  - Visemes: {len(result.visemes)}")
    except Exception as e:
        print(f"✗ Failed to generate audio: {e}")
        return False

    # Step 2: Verify file exists
    print("\n[2] Verifying file exists on disk...")
    file_path = Path(result.file_path)
    if file_path.exists():
        print(f"✓ File exists: {file_path}")
        print(f"  - Size on disk: {file_path.stat().st_size:,} bytes")
    else:
        print(f"✗ File not found: {file_path}")
        return False

    # Step 3: Test endpoint
    print("\n[3] Testing audio endpoint...")
    client = TestClient(app)

    try:
        response = client.get(f"/api/v1/audio/{session_id}/{message_id}.mp3")

        if response.status_code == 200:
            print("✓ Endpoint returned 200 OK")
            print(f"  - Content-Type: {response.headers.get('content-type')}")
            print(f"  - Content-Length: {len(response.content):,} bytes")

            # Verify content matches
            if response.content == result.audio_bytes:
                print("✓ Content matches generated audio")
            else:
                print("✗ Content mismatch!")
                print(f"  - Expected: {len(result.audio_bytes):,} bytes")
                print(f"  - Got: {len(response.content):,} bytes")
                return False
        else:
            print(f"✗ Endpoint returned {response.status_code}")
            print(f"  - Response: {response.json()}")
            return False
    except Exception as e:
        print(f"✗ Failed to test endpoint: {e}")
        return False

    # Step 4: Test security - invalid paths
    print("\n[4] Testing security validation...")

    test_cases = [
        ("../../../etc/passwd", "message", "Directory traversal with .."),
        ("valid-session", "../../../etc/passwd", "Directory traversal in message_id"),
        ("/etc/passwd", "message", "Absolute path"),
        ("session@#$", "message", "Special characters"),
    ]

    security_passed = True
    for session, message, description in test_cases:
        response = client.get(f"/api/v1/audio/{session}/{message}.mp3")
        if response.status_code in [400, 404]:
            print(f"✓ {description}: Blocked ({response.status_code})")
        else:
            print(f"✗ {description}: Not blocked ({response.status_code})")
            security_passed = False

    if not security_passed:
        return False

    # Step 5: Cleanup
    print("\n[5] Cleaning up...")
    try:
        file_path.unlink()
        file_path.parent.rmdir()
        print("✓ Cleanup complete")
    except Exception as e:
        print(f"⚠ Cleanup warning: {e}")

    print("\n" + "=" * 80)
    print("✓ All tests passed!")
    print("=" * 80)
    return True


if __name__ == "__main__":
    success = asyncio.run(test_audio_endpoint_integration())
    sys.exit(0 if success else 1)
