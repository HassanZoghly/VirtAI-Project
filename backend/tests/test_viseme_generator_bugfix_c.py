"""
Bug Condition Exploration Test for Lip Sync Fallback (Bug C)

**Validates: Requirements 1.9, 1.10, 1.11, 1.12**

This test explores the bug condition where Rhubarb Lip Sync is unavailable.
It tests the concrete failing case: Rhubarb not installed, audio file exists.

CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists.
DO NOT attempt to fix the test or the code when it fails.

Expected counterexamples on unfixed code:
- generate_from_audio returns empty list []
- No fallback cues generated from audio amplitude
- RHUBARB_PATH environment variable not checked
- No installation instructions provided

The test assertions encode the EXPECTED BEHAVIOR (after fix):
- Fallback cues should be generated from audio amplitude
- RHUBARB_PATH environment variable should be checked
- Installation instructions should be logged
- API shape should be maintained (start, end, value format)
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from hypothesis import given, strategies as st

from app.services.tts.viseme_generator import VisemeGenerator


class TestBugConditionC_LipSyncFallback:
    """
    Bug Condition Exploration: Lip Sync Fallback
    
    Property 1: Fault Condition - Rhubarb Unavailable
    
    _For any_ audio file where Rhubarb Lip Sync is unavailable (isBugCondition_C returns true),
    the fixed viseme generator SHALL generate fallback mouthCues based on audio amplitude
    envelope analysis, maintaining the same API shape as Rhubarb-generated cues.
    """

    @pytest.mark.asyncio
    @given(
        text=st.text(min_size=5, max_size=100, alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z"))),
        session_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
        message_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
    )
    async def test_property_rhubarb_unavailable_generates_fallback(
        self, text: str, session_id: str, message_id: str
    ):
        """
        Property Test: When Rhubarb is unavailable, fallback cues should be generated.
        
        This test will FAIL on unfixed code because:
        - generate_from_audio returns empty list when Rhubarb unavailable
        - No fallback mechanism exists
        - RHUBARB_PATH is not checked
        
        After fix, this test should PASS because:
        - Fallback cues are generated from audio amplitude
        - RHUBARB_PATH environment variable is checked
        - API shape is maintained
        """
        # Create a temporary audio file (simple WAV format)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
            audio_path = audio_file.name
            # Write minimal valid WAV header + some audio data
            # RIFF header
            audio_file.write(b"RIFF")
            audio_file.write((36 + 1000).to_bytes(4, "little"))  # File size - 8
            audio_file.write(b"WAVE")
            # fmt chunk
            audio_file.write(b"fmt ")
            audio_file.write((16).to_bytes(4, "little"))  # Chunk size
            audio_file.write((1).to_bytes(2, "little"))  # Audio format (PCM)
            audio_file.write((1).to_bytes(2, "little"))  # Num channels
            audio_file.write((44100).to_bytes(4, "little"))  # Sample rate
            audio_file.write((88200).to_bytes(4, "little"))  # Byte rate
            audio_file.write((2).to_bytes(2, "little"))  # Block align
            audio_file.write((16).to_bytes(2, "little"))  # Bits per sample
            # data chunk
            audio_file.write(b"data")
            audio_file.write((1000).to_bytes(4, "little"))  # Data size
            # Write some audio samples (alternating high/low for amplitude variation)
            for i in range(500):
                if i % 10 < 5:
                    audio_file.write((20000).to_bytes(2, "little", signed=True))
                else:
                    audio_file.write((1000).to_bytes(2, "little", signed=True))

        try:
            # Ensure Rhubarb is NOT available (bug condition)
            with patch.dict(os.environ, {}, clear=False):
                # Remove RHUBARB_PATH if it exists
                os.environ.pop("RHUBARB_PATH", None)
                
                with patch.object(VisemeGenerator, "_find_rhubarb_executable", return_value=None):
                    generator = VisemeGenerator()
                    
                    # This is the bug condition: Rhubarb unavailable, audio file exists
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text=text,
                        session_id=session_id,
                        message_id=message_id,
                    )
                    
                    # EXPECTED BEHAVIOR (after fix):
                    # 1. Result should NOT be empty - fallback cues should be generated
                    assert len(result) > 0, (
                        "COUNTEREXAMPLE FOUND: generate_from_audio returned empty list when "
                        "Rhubarb unavailable. Expected fallback cues from audio amplitude analysis."
                    )
                    
                    # 2. Each cue should have correct API shape (start, end, value)
                    for cue in result:
                        assert hasattr(cue, "start"), "Cue missing 'start' field"
                        assert hasattr(cue, "end"), "Cue missing 'end' field"
                        assert hasattr(cue, "value"), "Cue missing 'value' field"
                        assert cue.start < cue.end, f"Invalid cue timing: start={cue.start}, end={cue.end}"
                        assert isinstance(cue.value, str), f"Cue value should be string, got {type(cue.value)}"
                        assert cue.value.startswith("viseme_"), f"Cue value should be viseme name, got {cue.value}"
                    
                    # 3. Cues should be sorted by start time
                    for i in range(len(result) - 1):
                        assert result[i].start <= result[i + 1].start, "Cues not sorted by start time"
        
        finally:
            # Cleanup
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    @pytest.mark.asyncio
    async def test_concrete_rhubarb_unavailable_returns_empty(self):
        """
        Concrete Test: Rhubarb unavailable returns empty list (current bug).
        
        This test documents the CURRENT BEHAVIOR (bug):
        - When Rhubarb is unavailable, generate_from_audio returns []
        - No fallback mechanism exists
        - This is the bug we're exploring
        
        This test will FAIL after the fix is implemented because the behavior will change.
        """
        # Create a temporary audio file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
            audio_path = audio_file.name
            # Write minimal valid WAV
            audio_file.write(b"RIFF")
            audio_file.write((36 + 100).to_bytes(4, "little"))
            audio_file.write(b"WAVE")
            audio_file.write(b"fmt ")
            audio_file.write((16).to_bytes(4, "little"))
            audio_file.write((1).to_bytes(2, "little"))
            audio_file.write((1).to_bytes(2, "little"))
            audio_file.write((44100).to_bytes(4, "little"))
            audio_file.write((88200).to_bytes(4, "little"))
            audio_file.write((2).to_bytes(2, "little"))
            audio_file.write((16).to_bytes(2, "little"))
            audio_file.write(b"data")
            audio_file.write((100).to_bytes(4, "little"))
            audio_file.write(b"\x00" * 100)

        try:
            with patch.object(VisemeGenerator, "_find_rhubarb_executable", return_value=None):
                generator = VisemeGenerator()
                
                result = await generator.generate_from_audio(
                    audio_path=audio_path,
                    text="Hello world",
                    session_id="test123",
                    message_id="msg456",
                )
                
                # CURRENT BEHAVIOR (bug): Returns empty list
                # This assertion will PASS on unfixed code (confirming the bug)
                # This assertion will FAIL on fixed code (confirming the fix works)
                assert result == [], (
                    "Expected empty list on unfixed code (bug behavior). "
                    "If this fails, the fix may already be implemented."
                )
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    def test_rhubarb_path_env_var_not_checked(self):
        """
        Test: RHUBARB_PATH environment variable is not checked (current bug).
        
        This test documents that the current implementation does NOT check
        the RHUBARB_PATH environment variable.
        
        This test will FAIL after the fix because __init__ will check the env var.
        """
        with patch.dict(os.environ, {"RHUBARB_PATH": "/custom/path/to/rhubarb"}):
            generator = VisemeGenerator()
            
            # CURRENT BEHAVIOR (bug): rhubarb_path is None, env var not checked
            # This assertion will PASS on unfixed code
            # This assertion will FAIL on fixed code
            assert generator.rhubarb_path is None, (
                "Expected rhubarb_path to be None (env var not checked). "
                "If this fails, the fix may already be implemented."
            )

    @patch.object(VisemeGenerator, "_find_rhubarb_executable")
    def test_no_installation_instructions_in_warning(self, mock_find):
        """
        Test: Installation instructions are incomplete (current bug).
        
        This test documents that the current warning message does not include
        detailed installation instructions for Windows/Linux/macOS.
        
        This test will FAIL after the fix because the warning will be more detailed.
        """
        mock_find.return_value = None
        
        generator = VisemeGenerator()
        
        # Trigger the availability check
        with patch("app.services.tts.viseme_generator.logger") as mock_logger:
            result = generator._check_rhubarb_availability()
            
            assert result is False
            
            # Check that warning was called
            assert mock_logger.warning.called
            
            # Get the warning message
            warning_call = mock_logger.warning.call_args[0][0]
            
            # CURRENT BEHAVIOR (bug): Warning doesn't include detailed instructions
            # Check for missing installation details
            has_windows_path = "C:\\Program Files\\Rhubarb Lip Sync" in warning_call
            has_linux_path = "/usr/local/bin/" in warning_call
            has_env_var_instruction = "export RHUBARB_PATH" in warning_call
            
            # This assertion will PASS on unfixed code (instructions missing)
            # This assertion will FAIL on fixed code (instructions added)
            assert not (has_windows_path and has_linux_path and has_env_var_instruction), (
                "Expected incomplete installation instructions. "
                "If this fails, the fix may already be implemented."
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
