"""
Tests for Viseme Generator

Tests the viseme timeline generation functionality including:
- Rhubarb availability checking
- Fallback behavior when Rhubarb is unavailable
- Viseme parsing and mapping
"""

from unittest.mock import patch

import pytest

from app.infrastructure.tts.viseme_generator import VisemeGenerator


class TestVisemeGenerator:
    """Test suite for VisemeGenerator"""

    def test_init(self):
        """Test VisemeGenerator initialization"""
        generator = VisemeGenerator()
        assert generator.rhubarb_path is None
        assert generator._rhubarb_available is None

        generator_with_path = VisemeGenerator(rhubarb_path="/path/to/rhubarb")
        assert generator_with_path.rhubarb_path == "/path/to/rhubarb"

    def test_validate_path_component_valid(self):
        """Test path component validation with valid inputs"""
        generator = VisemeGenerator()

        assert generator._validate_path_component("session123") is True
        assert generator._validate_path_component("msg-456") is True
        assert generator._validate_path_component("test_id") is True
        assert generator._validate_path_component("abc123-def_456") is True

    def test_validate_path_component_invalid(self):
        """Test path component validation with invalid inputs"""
        generator = VisemeGenerator()

        assert generator._validate_path_component("") is False
        assert generator._validate_path_component("../etc/passwd") is False
        assert generator._validate_path_component("path/to/file") is False
        assert generator._validate_path_component("path\\to\\file") is False
        assert generator._validate_path_component("test@email.com") is False
        assert generator._validate_path_component("test space") is False

    def test_parse_rhubarb_output_valid(self):
        """Test parsing valid Rhubarb output"""
        generator = VisemeGenerator()

        rhubarb_data = {
            "metadata": {"duration": 1.5},
            "mouthCues": [
                {"start": 0.0, "end": 0.1, "value": "X"},
                {"start": 0.1, "end": 0.3, "value": "A"},
                {"start": 0.3, "end": 0.5, "value": "B"},
                {"start": 0.5, "end": 0.7, "value": "C"},
            ],
        }

        mouth_cues = generator._parse_rhubarb_output(rhubarb_data)

        assert len(mouth_cues) == 4
        assert mouth_cues[0].start == 0.0
        assert mouth_cues[0].end == 0.1
        assert mouth_cues[0].value == "viseme_sil"  # X -> viseme_sil
        assert mouth_cues[1].value == "viseme_aa"  # A -> viseme_aa
        assert mouth_cues[2].value == "viseme_PP"  # B -> viseme_PP
        assert mouth_cues[3].value == "viseme_E"  # C -> viseme_E

    def test_parse_rhubarb_output_empty(self):
        """Test parsing empty Rhubarb output"""
        generator = VisemeGenerator()

        rhubarb_data = {"metadata": {}, "mouthCues": []}
        mouth_cues = generator._parse_rhubarb_output(rhubarb_data)

        assert len(mouth_cues) == 0

    def test_parse_rhubarb_output_sorting(self):
        """Test that mouth cues are sorted by start time"""
        generator = VisemeGenerator()

        # Unsorted input
        rhubarb_data = {
            "mouthCues": [
                {"start": 0.5, "end": 0.7, "value": "C"},
                {"start": 0.0, "end": 0.1, "value": "X"},
                {"start": 0.3, "end": 0.5, "value": "B"},
                {"start": 0.1, "end": 0.3, "value": "A"},
            ]
        }

        mouth_cues = generator._parse_rhubarb_output(rhubarb_data)

        # Should be sorted
        assert len(mouth_cues) == 4
        assert mouth_cues[0].start == 0.0
        assert mouth_cues[1].start == 0.1
        assert mouth_cues[2].start == 0.3
        assert mouth_cues[3].start == 0.5

    def test_parse_rhubarb_output_invalid_cues(self):
        """Test parsing Rhubarb output with invalid cues"""
        generator = VisemeGenerator()

        rhubarb_data = {
            "mouthCues": [
                {"start": 0.0, "end": 0.1, "value": "X"},  # Valid
                {"start": "invalid", "end": 0.3, "value": "A"},  # Invalid start
                {"start": 0.3, "end": 0.5},  # Missing value
                {"start": 0.5, "end": 0.7, "value": "B"},  # Valid
            ]
        }

        mouth_cues = generator._parse_rhubarb_output(rhubarb_data)

        # Should only parse valid cues
        assert len(mouth_cues) == 2
        assert mouth_cues[0].start == 0.0
        assert mouth_cues[1].start == 0.5

    @patch("shutil.which")
    def test_find_rhubarb_executable_in_path(self, mock_which):
        """Test finding Rhubarb in system PATH"""
        mock_which.return_value = "/usr/local/bin/rhubarb"

        generator = VisemeGenerator()
        result = generator._find_rhubarb_executable()

        assert result == "/usr/local/bin/rhubarb"

    @patch("shutil.which")
    @patch("os.path.isfile")
    def test_find_rhubarb_executable_not_found(self, mock_isfile, mock_which):
        """Test when Rhubarb is not found"""
        mock_which.return_value = None
        mock_isfile.return_value = False

        generator = VisemeGenerator()
        result = generator._find_rhubarb_executable()

        assert result is None

    @patch.object(VisemeGenerator, "_find_rhubarb_executable")
    def test_check_rhubarb_availability_not_found(self, mock_find):
        """Test Rhubarb availability check when not found"""
        mock_find.return_value = None

        generator = VisemeGenerator()
        result = generator._check_rhubarb_availability()

        assert result is False
        assert generator._rhubarb_available is False

    @pytest.mark.asyncio
    async def test_generate_from_audio_invalid_session_id(self):
        """Test generate_from_audio with invalid session_id"""
        generator = VisemeGenerator()

        result = await generator.generate_from_audio(
            audio_path="/path/to/audio.mp3",
            text="Hello world",
            session_id="../invalid",
            message_id="msg123",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_generate_from_audio_invalid_message_id(self):
        """Test generate_from_audio with invalid message_id"""
        generator = VisemeGenerator()

        result = await generator.generate_from_audio(
            audio_path="/path/to/audio.mp3",
            text="Hello world",
            session_id="session123",
            message_id="msg/123",
        )

        assert result == []

    @pytest.mark.asyncio
    @patch.object(VisemeGenerator, "_check_rhubarb_availability")
    async def test_generate_from_audio_rhubarb_unavailable(self, mock_check):
        """Test generate_from_audio when Rhubarb is unavailable"""
        mock_check.return_value = False

        generator = VisemeGenerator()
        result = await generator.generate_from_audio(
            audio_path="/path/to/audio.mp3",
            text="Hello world",
            session_id="session123",
            message_id="msg123",
        )

        assert result == []

    @pytest.mark.asyncio
    @patch.object(VisemeGenerator, "_check_rhubarb_availability")
    @patch("os.path.isfile")
    async def test_generate_from_audio_file_not_found(self, mock_isfile, mock_check):
        """Test generate_from_audio when audio file doesn't exist"""
        mock_check.return_value = True
        mock_isfile.return_value = False

        generator = VisemeGenerator()
        result = await generator.generate_from_audio(
            audio_path="/nonexistent/audio.mp3",
            text="Hello world",
            session_id="session123",
            message_id="msg123",
        )

        assert result == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
