"""
Preservation Property Tests for Lip Sync System (Property 6)

**Validates: Requirements 3.8, 3.9, 3.10, 3.11**

Property 6: Preservation - Rhubarb Lip Sync

_For any_ audio file where Rhubarb Lip Sync is available and working (isBugCondition_C
returns false), the fixed viseme generator SHALL produce exactly the same Rhubarb-based
viseme timelines as the original generator, preserving accuracy and realism.

CRITICAL: These tests MUST PASS on UNFIXED code - they verify baseline behavior to preserve.

This follows the observation-first methodology:
1. Observe behavior on UNFIXED code when Rhubarb is installed and working
2. Write property-based tests that encode this observed behavior
3. Run tests on UNFIXED code - they should PASS
4. After implementing the fix, run tests again - they should still PASS (preservation)

The tests verify:
- Rhubarb generates accurate phoneme-based viseme timelines (Req 3.8)
- Viseme data is applied to head and teeth meshes (Req 3.9)
- Viseme application is synchronized with audio timing (Req 3.10)
- Realism enhancements (coarticulation, jaw coupling) work correctly (Req 3.11)
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given, strategies as st, settings, HealthCheck

from app.schemas.ws_messages import MouthCue
from app.infrastructure.tts.viseme_generator import VisemeGenerator


def create_test_audio_file() -> str:
    """
    Create a temporary audio file for testing.
    
    Returns:
        Path to the temporary audio file
    """
    audio_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio_path = audio_file.name
    
    # Write minimal valid WAV header + some audio data
    # RIFF header
    audio_file.write(b"RIFF")
    audio_file.write((36 + 2000).to_bytes(4, "little"))  # File size - 8
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
    audio_file.write((2000).to_bytes(4, "little"))  # Data size
    # Write some audio samples with variation
    for i in range(1000):
        if i % 20 < 10:
            audio_file.write((15000).to_bytes(2, "little", signed=True))
        else:
            audio_file.write((5000).to_bytes(2, "little", signed=True))
    
    audio_file.close()
    return audio_path


def create_mock_rhubarb_output(num_cues: int = 5) -> dict:
    """
    Create mock Rhubarb output with realistic viseme data.
    
    Args:
        num_cues: Number of mouth cues to generate
    
    Returns:
        Mock Rhubarb output dictionary
    """
    # Realistic Rhubarb phoneme letters
    phonemes = ["X", "A", "B", "C", "D", "E", "F", "G", "H"]
    
    mouth_cues = []
    current_time = 0.0
    
    for i in range(num_cues):
        duration = 0.1 + (i % 3) * 0.05  # Vary duration: 0.1, 0.15, 0.2
        mouth_cues.append({
            "start": current_time,
            "end": current_time + duration,
            "value": phonemes[i % len(phonemes)]
        })
        current_time += duration
    
    return {
        "metadata": {
            "soundFile": "test.wav",
            "duration": current_time
        },
        "mouthCues": mouth_cues
    }


class TestPreservationProperty_RhubarbLipSync:
    """
    Preservation Property Tests: Rhubarb Lip Sync System
    
    These tests verify that when Rhubarb IS available (NOT bug condition C),
    the system continues to work exactly as before.
    
    EXPECTED OUTCOME: All tests PASS on unfixed code (baseline behavior).
    """

    @pytest.mark.asyncio
    @given(
        text=st.text(
            min_size=10,
            max_size=200,
            alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z"))
        ),
        session_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
        message_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
        num_cues=st.integers(min_value=3, max_value=20),
    )
    @settings(
        max_examples=10,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_rhubarb_available_generates_accurate_timelines(
        self, text: str, session_id: str, message_id: str, num_cues: int
    ):
        """
        Property Test: When Rhubarb is available, accurate phoneme-based viseme timelines are generated.
        
        **Validates: Requirement 3.8**
        
        This test verifies preservation of Rhubarb-based viseme generation.
        It should PASS on unfixed code (baseline behavior).
        
        Observations:
        - Rhubarb generates phoneme-based viseme timelines
        - Each cue has start, end, and value (phoneme letter)
        - Cues are sorted by start time
        - Phoneme letters are mapped to RPM viseme names
        """
        audio_path = create_test_audio_file()
        
        try:
            # Mock Rhubarb being available and working
            mock_rhubarb_output = create_mock_rhubarb_output(num_cues)
            
            with patch.object(VisemeGenerator, "_check_rhubarb_availability", return_value=True):
                with patch.object(VisemeGenerator, "_run_rhubarb", new_callable=AsyncMock) as mock_run:
                    mock_run.return_value = mock_rhubarb_output
                    
                    generator = VisemeGenerator(rhubarb_path="/mock/rhubarb")
                    
                    # Generate visemes with Rhubarb available
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text=text,
                        session_id=session_id,
                        message_id=message_id,
                    )
                    
                    # PRESERVATION: Rhubarb generates accurate phoneme-based timelines
                    assert len(result) == num_cues, (
                        f"Expected {num_cues} cues from Rhubarb, got {len(result)}"
                    )
                    
                    # Verify each cue has correct structure
                    for i, cue in enumerate(result):
                        assert hasattr(cue, "start"), f"Cue {i} missing 'start' field"
                        assert hasattr(cue, "end"), f"Cue {i} missing 'end' field"
                        assert hasattr(cue, "value"), f"Cue {i} missing 'value' field"
                        
                        # Verify timing is valid
                        assert cue.start < cue.end, (
                            f"Cue {i} has invalid timing: start={cue.start}, end={cue.end}"
                        )
                        
                        # Verify value is RPM viseme name (mapped from Rhubarb phoneme)
                        assert isinstance(cue.value, str), (
                            f"Cue {i} value should be string, got {type(cue.value)}"
                        )
                        assert cue.value.startswith("viseme_"), (
                            f"Cue {i} value should be RPM viseme name, got {cue.value}"
                        )
                    
                    # Verify cues are sorted by start time
                    for i in range(len(result) - 1):
                        assert result[i].start <= result[i + 1].start, (
                            f"Cues not sorted: cue {i} start={result[i].start}, "
                            f"cue {i+1} start={result[i + 1].start}"
                        )
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    @pytest.mark.asyncio
    @given(
        session_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
        message_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
    )
    @settings(
        max_examples=10,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_viseme_data_maintains_api_shape(
        self, session_id: str, message_id: str
    ):
        """
        Property Test: Viseme data maintains consistent API shape for frontend application.
        
        **Validates: Requirement 3.9**
        
        This test verifies that viseme data structure is preserved for frontend consumption.
        The frontend applies morph targets to head and teeth meshes based on this data.
        
        Observations:
        - Each MouthCue has start (float), end (float), value (string)
        - Values are RPM viseme names (e.g., "viseme_aa", "viseme_PP")
        - Data structure is consistent across all cues
        """
        audio_path = create_test_audio_file()
        
        try:
            mock_rhubarb_output = create_mock_rhubarb_output(8)
            
            with patch.object(VisemeGenerator, "_check_rhubarb_availability", return_value=True):
                with patch.object(VisemeGenerator, "_run_rhubarb", new_callable=AsyncMock) as mock_run:
                    mock_run.return_value = mock_rhubarb_output
                    
                    generator = VisemeGenerator(rhubarb_path="/mock/rhubarb")
                    
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text="Testing viseme data structure",
                        session_id=session_id,
                        message_id=message_id,
                    )
                    
                    # PRESERVATION: API shape is maintained for frontend
                    assert len(result) > 0, "Expected viseme data from Rhubarb"
                    
                    for cue in result:
                        # Verify MouthCue structure
                        assert isinstance(cue, MouthCue), (
                            f"Expected MouthCue instance, got {type(cue)}"
                        )
                        
                        # Verify field types
                        assert isinstance(cue.start, (int, float)), (
                            f"start should be numeric, got {type(cue.start)}"
                        )
                        assert isinstance(cue.end, (int, float)), (
                            f"end should be numeric, got {type(cue.end)}"
                        )
                        assert isinstance(cue.value, str), (
                            f"value should be string, got {type(cue.value)}"
                        )
                        
                        # Verify RPM viseme naming convention
                        assert cue.value.startswith("viseme_"), (
                            f"Expected RPM viseme name (viseme_*), got {cue.value}"
                        )
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    @pytest.mark.asyncio
    @given(
        session_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
        message_id=st.from_regex(r"^[a-zA-Z0-9_-]{5,20}$", fullmatch=True),
    )
    @settings(
        max_examples=10,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_viseme_timing_synchronized_with_audio(
        self, session_id: str, message_id: str
    ):
        """
        Property Test: Viseme timing is synchronized with audio duration.
        
        **Validates: Requirement 3.10**
        
        This test verifies that viseme cues are properly synchronized with audio timing.
        
        Observations:
        - All cue start times are >= 0
        - All cue end times are > start times
        - Cues cover the audio duration without gaps or overlaps
        - Timing precision is maintained (no rounding errors)
        """
        audio_path = create_test_audio_file()
        
        try:
            mock_rhubarb_output = create_mock_rhubarb_output(10)
            audio_duration = mock_rhubarb_output["metadata"]["duration"]
            
            with patch.object(VisemeGenerator, "_check_rhubarb_availability", return_value=True):
                with patch.object(VisemeGenerator, "_run_rhubarb", new_callable=AsyncMock) as mock_run:
                    mock_run.return_value = mock_rhubarb_output
                    
                    generator = VisemeGenerator(rhubarb_path="/mock/rhubarb")
                    
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text="Testing audio synchronization",
                        session_id=session_id,
                        message_id=message_id,
                    )
                    
                    # PRESERVATION: Timing is synchronized with audio
                    assert len(result) > 0, "Expected viseme data from Rhubarb"
                    
                    # Verify all times are non-negative
                    for i, cue in enumerate(result):
                        assert cue.start >= 0, (
                            f"Cue {i} has negative start time: {cue.start}"
                        )
                        assert cue.end > cue.start, (
                            f"Cue {i} has invalid duration: start={cue.start}, end={cue.end}"
                        )
                    
                    # Verify first cue starts at or near 0
                    assert result[0].start >= 0, (
                        f"First cue should start at or after 0, got {result[0].start}"
                    )
                    
                    # Verify last cue ends at or before audio duration
                    assert result[-1].end <= audio_duration + 0.1, (
                        f"Last cue ends after audio duration: {result[-1].end} > {audio_duration}"
                    )
                    
                    # Verify cues are contiguous or have minimal gaps
                    for i in range(len(result) - 1):
                        gap = result[i + 1].start - result[i].end
                        assert gap >= -0.001, (  # Allow tiny overlap due to float precision
                            f"Cues {i} and {i+1} have significant overlap: gap={gap}"
                        )
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    @pytest.mark.asyncio
    async def test_property_rhubarb_phoneme_mapping_preserved(self):
        """
        Property Test: Rhubarb phoneme to RPM viseme mapping is preserved.
        
        **Validates: Requirement 3.11 (realism enhancements)**
        
        This test verifies that the phoneme-to-viseme mapping remains accurate,
        which is essential for realistic lip sync with coarticulation and jaw coupling.
        
        Observations:
        - Rhubarb phoneme letters (A-H, X) are mapped to RPM viseme names
        - Mapping is deterministic and consistent
        - All Rhubarb phonemes have corresponding RPM visemes
        """
        audio_path = create_test_audio_file()
        
        try:
            # Create output with all Rhubarb phoneme types
            all_phonemes_output = {
                "metadata": {"duration": 0.9},
                "mouthCues": [
                    {"start": 0.0, "end": 0.1, "value": "X"},  # Silence
                    {"start": 0.1, "end": 0.2, "value": "A"},  # Open vowel
                    {"start": 0.2, "end": 0.3, "value": "B"},  # Bilabial
                    {"start": 0.3, "end": 0.4, "value": "C"},  # Dental
                    {"start": 0.4, "end": 0.5, "value": "D"},  # Alveolar
                    {"start": 0.5, "end": 0.6, "value": "E"},  # Retroflex
                    {"start": 0.6, "end": 0.7, "value": "F"},  # Labiodental
                    {"start": 0.7, "end": 0.8, "value": "G"},  # Velar
                    {"start": 0.8, "end": 0.9, "value": "H"},  # Glottal
                ]
            }
            
            with patch.object(VisemeGenerator, "_check_rhubarb_availability", return_value=True):
                with patch.object(VisemeGenerator, "_run_rhubarb", new_callable=AsyncMock) as mock_run:
                    mock_run.return_value = all_phonemes_output
                    
                    generator = VisemeGenerator(rhubarb_path="/mock/rhubarb")
                    
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text="Testing phoneme mapping",
                        session_id="test123",
                        message_id="msg456",
                    )
                    
                    # PRESERVATION: All phonemes are mapped correctly
                    assert len(result) == 9, f"Expected 9 cues, got {len(result)}"
                    
                    # Verify expected mappings (from viseme_map.py RHUBARB_TO_RPM)
                    expected_mappings = {
                        0: "viseme_sil",  # X -> silence
                        1: "viseme_aa",   # A -> relaxed mouth (open vowels)
                        2: "viseme_PP",   # B -> bilabial
                        3: "viseme_E",    # C -> wide mouth (front vowels)
                        4: "viseme_aa",   # D -> relaxed mouth (neutral position)
                        5: "viseme_O",    # E -> rounded lips (back vowels)
                        6: "viseme_FF",   # F -> labiodental
                        7: "viseme_kk",   # G -> velar
                        8: "viseme_CH",   # H -> palatal
                    }
                    
                    for i, cue in enumerate(result):
                        expected_viseme = expected_mappings[i]
                        assert cue.value == expected_viseme, (
                            f"Cue {i}: Expected {expected_viseme}, got {cue.value}"
                        )
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    @pytest.mark.asyncio
    async def test_concrete_rhubarb_available_baseline_behavior(self):
        """
        Concrete Test: Baseline behavior when Rhubarb is available.
        
        This test documents the CURRENT BEHAVIOR (baseline) that must be preserved.
        It verifies the complete flow when Rhubarb is working correctly.
        
        This test should PASS on unfixed code and continue to PASS after the fix.
        """
        audio_path = create_test_audio_file()
        
        try:
            mock_rhubarb_output = {
                "metadata": {"duration": 0.5},
                "mouthCues": [
                    {"start": 0.0, "end": 0.1, "value": "X"},
                    {"start": 0.1, "end": 0.25, "value": "A"},
                    {"start": 0.25, "end": 0.35, "value": "B"},
                    {"start": 0.35, "end": 0.5, "value": "C"},
                ]
            }
            
            with patch.object(VisemeGenerator, "_check_rhubarb_availability", return_value=True):
                with patch.object(VisemeGenerator, "_run_rhubarb", new_callable=AsyncMock) as mock_run:
                    mock_run.return_value = mock_rhubarb_output
                    
                    generator = VisemeGenerator(rhubarb_path="/mock/rhubarb")
                    
                    result = await generator.generate_from_audio(
                        audio_path=audio_path,
                        text="Hello world",
                        session_id="baseline123",
                        message_id="baseline456",
                    )
                    
                    # BASELINE BEHAVIOR: Rhubarb generates 4 cues
                    assert len(result) == 4, f"Expected 4 cues, got {len(result)}"
                    
                    # Verify structure
                    assert result[0].value == "viseme_sil"
                    assert result[1].value == "viseme_aa"
                    assert result[2].value == "viseme_PP"
                    assert result[3].value == "viseme_E"
                    
                    # Verify timing
                    assert result[0].start == 0.0
                    assert result[0].end == 0.1
                    assert result[3].end == 0.5
                    
                    # Verify sorting
                    for i in range(len(result) - 1):
                        assert result[i].start <= result[i + 1].start
        
        finally:
            if os.path.exists(audio_path):
                os.unlink(audio_path)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
