"""
Integration test for Viseme Generator with TTS Provider
"""

import json
from pathlib import Path

import pytest

from app.services.tts.edge_tts_provider import EdgeTTSProvider
from app.services.tts.viseme_generator import VisemeGenerator


@pytest.mark.asyncio
async def test_viseme_generator_integration():
    """
    Test complete TTS + Viseme generation flow

    This test demonstrates:
    1. TTS audio generation
    2. Viseme timeline generation (with fallback if Rhubarb unavailable)
    3. File storage
    4. Graceful handling when Rhubarb is missing
    """

    # Initialize services
    tts_provider = EdgeTTSProvider()
    viseme_generator = VisemeGenerator()

    # Test data
    session_id = "test-session-001"
    message_id = "test-msg-001"
    text = "Hello world, this is a test."

    try:
        # Step 1: Generate TTS audio
        tts_result = await tts_provider.generate(text, session_id, message_id)

        assert tts_result.file_path is not None
        assert Path(tts_result.file_path).exists()
        assert tts_result.audio_duration_ms > 0
        assert len(tts_result.audio_bytes) > 0

        print("\n✅ TTS audio generated:")
        print(f"   File: {tts_result.file_path}")
        print(f"   Duration: {tts_result.audio_duration_ms:.0f}ms")
        print(f"   Size: {len(tts_result.audio_bytes):,} bytes")

        # Step 2: Generate viseme timeline
        mouth_cues = await viseme_generator.generate_from_audio(
            audio_path=tts_result.file_path, text=text, session_id=session_id, message_id=message_id
        )

        # Visemes may be empty if Rhubarb is not available (this is expected)
        print("\n👄 Viseme generation result:")
        if mouth_cues:
            print(f"   ✅ Generated {len(mouth_cues)} mouth cues")
            print(f"   Timeline: {mouth_cues[0].start:.2f}s - {mouth_cues[-1].end:.2f}s")

            # Verify cues are sorted
            for i in range(len(mouth_cues) - 1):
                assert (
                    mouth_cues[i].start <= mouth_cues[i + 1].start
                ), "Cues must be sorted by start time"

            # Verify cues have valid time ranges
            for cue in mouth_cues:
                assert cue.start < cue.end, f"Cue start ({cue.start}) must be < end ({cue.end})"
                assert cue.value.startswith(
                    "viseme_"
                ), f"Cue value must be RPM viseme name: {cue.value}"

            # Verify JSON file was created
            viseme_json_path = Path(f"backend/.data/sessions/{session_id}/{message_id}.json")
            assert viseme_json_path.exists(), "Viseme JSON file should be created"

            with open(viseme_json_path) as f:
                viseme_data = json.load(f)
                assert "mouthCues" in viseme_data
                assert len(viseme_data["mouthCues"]) > 0

            print(f"   ✅ Viseme JSON stored at: {viseme_json_path}")
        else:
            print("   ⚠️  Rhubarb unavailable - empty mouthCues (expected)")
            print("   ✅ Graceful fallback - audio still works!")

        # Step 3: Verify both files exist
        audio_path = Path(tts_result.file_path)
        assert audio_path.exists(), "Audio file should exist"

        print("\n✅ Integration test passed!")
        print(f"   Audio: {audio_path}")
        if mouth_cues:
            print(f"   Visemes: {len(mouth_cues)} cues")
        else:
            print("   Visemes: fallback mode (empty)")

    finally:
        # Clean up test files
        import shutil

        session_dir = Path(f"backend/.data/sessions/{session_id}")
        if session_dir.exists():
            shutil.rmtree(session_dir)
            print(f"\n🧹 Cleaned up: {session_dir}")


@pytest.mark.asyncio
async def test_viseme_generator_fallback():
    """
    Test that viseme generator handles missing Rhubarb gracefully
    """

    # Force Rhubarb unavailable
    viseme_generator = VisemeGenerator(rhubarb_path="/nonexistent/rhubarb")

    # Generate TTS audio first
    tts_provider = EdgeTTSProvider()
    session_id = "test-fallback-001"
    message_id = "test-fallback-msg"
    text = "Testing fallback behavior"

    try:
        tts_result = await tts_provider.generate(text, session_id, message_id)

        # Try to generate visemes (should return empty list)
        mouth_cues = await viseme_generator.generate_from_audio(
            audio_path=tts_result.file_path, text=text, session_id=session_id, message_id=message_id
        )

        # Should return empty list, not crash
        assert mouth_cues == [], "Should return empty list when Rhubarb unavailable"

        # Audio file should still exist
        assert Path(tts_result.file_path).exists(), "Audio should still be generated"

        print("\n✅ Fallback behavior test passed!")
        print("   Rhubarb unavailable → empty mouthCues")
        print(f"   Audio still works → {tts_result.file_path}")

    finally:
        # Clean up
        import shutil

        session_dir = Path(f"backend/.data/sessions/{session_id}")
        if session_dir.exists():
            shutil.rmtree(session_dir)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
