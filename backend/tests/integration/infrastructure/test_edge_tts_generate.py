"""
Test for EdgeTTSProvider.generate() method
Task 4.1: Implement Edge TTS audio generation
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from app.shared.errors import TTSException
from app.services.tts.edge_tts_provider import EdgeTTSProvider


@pytest.mark.asyncio
async def test_generate_creates_audio_file():
    """Test that generate() creates audio file at correct path"""
    provider = EdgeTTSProvider()
    session_id = "test-session-123"
    message_id = "test-message-456"
    text = "Hello, this is a test."

    # Clean up any existing test files
    test_dir = Path("backend/.data/sessions") / session_id
    if test_dir.exists():
        shutil.rmtree(test_dir)

    try:
        # Generate audio
        result = await provider.generate(text, session_id, message_id)

        # Verify result has file_path
        assert result.file_path is not None
        assert session_id in result.file_path
        assert message_id in result.file_path
        assert result.file_path.endswith(".mp3")

        # Verify file exists
        audio_file = Path(result.file_path)
        assert audio_file.exists()
        assert audio_file.stat().st_size > 0

        # Verify duration is set
        assert result.audio_duration_ms > 0

        # Note: Visemes may or may not be present depending on Edge TTS response
        # This is acceptable - the generate() method works correctly either way

        print(f"✓ Audio file created: {result.file_path}")
        print(f"✓ File size: {audio_file.stat().st_size:,} bytes")
        print(f"✓ Duration: {result.audio_duration_ms:.0f}ms")
        print(f"✓ Visemes: {len(result.visemes)} (optional)")

    finally:
        # Clean up test files
        if test_dir.exists():
            shutil.rmtree(test_dir)


@pytest.mark.asyncio
async def test_generate_prevents_path_traversal():
    """Test that generate() prevents path traversal attacks"""
    provider = EdgeTTSProvider()
    text = "Test"

    # Test various path traversal attempts
    invalid_ids = [
        "../../../etc/passwd",
        "..\\..\\..\\windows\\system32",
        "test/../../../etc",
        "test/../../file",
        "test\\..\\..\\file",
    ]

    for invalid_id in invalid_ids:
        with pytest.raises(TTSException, match="Invalid"):
            await provider.generate(text, invalid_id, "message-123")

        with pytest.raises(TTSException, match="Invalid"):
            await provider.generate(text, "session-123", invalid_id)

    print("✓ Path traversal prevention working")


@pytest.mark.asyncio
async def test_generate_validates_empty_text():
    """Test that generate() rejects empty text"""
    provider = EdgeTTSProvider()

    with pytest.raises(TTSException, match="Empty text"):
        await provider.generate("", "session-123", "message-456")

    with pytest.raises(TTSException, match="Empty text"):
        await provider.generate("   ", "session-123", "message-456")

    print("✓ Empty text validation working")


@pytest.mark.asyncio
async def test_generate_creates_directories():
    """Test that generate() creates necessary directories"""
    provider = EdgeTTSProvider()
    session_id = "new-session-789"
    message_id = "new-message-012"
    text = "Testing directory creation."

    # Ensure directory doesn't exist
    test_dir = Path("backend/.data/sessions") / session_id
    if test_dir.exists():
        shutil.rmtree(test_dir)

    try:
        # Generate audio
        result = await provider.generate(text, session_id, message_id)

        # Verify directory was created
        assert test_dir.exists()
        assert test_dir.is_dir()

        # Verify file exists in directory
        audio_file = Path(result.file_path)
        assert audio_file.exists()
        assert audio_file.parent == test_dir

        print(f"✓ Directory created: {test_dir}")
        print(f"✓ File created: {audio_file.name}")

    finally:
        # Clean up
        if test_dir.exists():
            shutil.rmtree(test_dir)


if __name__ == "__main__":
    # Run tests
    asyncio.run(test_generate_creates_audio_file())
    asyncio.run(test_generate_prevents_path_traversal())
    asyncio.run(test_generate_validates_empty_text())
    asyncio.run(test_generate_creates_directories())
    print("\n✅ All tests passed!")
