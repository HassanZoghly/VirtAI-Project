"""
Transcript Delivery Property Tests for ASR Service (Property 1)

**Validates: Requirements 5.5, 6.1, 10.3**

Property 1: Transcript Delivery

_For all_ finalized audio chunks sent to the ASR service, a transcript or error is returned.
The system SHALL never silently fail or hang when processing audio.

This property test validates that the ASR service always returns either:
1. A successful StreamingASRResult with a transcript, OR
2. An ASRException with an error message

This is a critical correctness property ensuring the system never silently fails or hangs
when processing audio input.
"""

import io
import os
import tempfile
from unittest.mock import AsyncMock, patch

import pytest
from hypothesis import given, strategies as st, settings, HealthCheck

from app.core.errors import ASRException
from app.services.asr.base import StreamingASRResult
from app.services.asr.faster_whisper import FasterWhisperASR


def create_valid_wav_audio(duration_ms: int = 100) -> bytes:
    """
    Create a valid WAV audio file with minimal content.
    
    Args:
        duration_ms: Duration of audio in milliseconds
    
    Returns:
        WAV audio bytes
    """
    sample_rate = 16000
    num_samples = (sample_rate * duration_ms) // 1000
    
    # Create WAV header
    wav_data = io.BytesIO()
    
    # RIFF header
    wav_data.write(b"RIFF")
    wav_data.write((36 + num_samples * 2).to_bytes(4, "little"))  # File size - 8
    wav_data.write(b"WAVE")
    
    # fmt chunk
    wav_data.write(b"fmt ")
    wav_data.write((16).to_bytes(4, "little"))  # Chunk size
    wav_data.write((1).to_bytes(2, "little"))  # Audio format (PCM)
    wav_data.write((1).to_bytes(2, "little"))  # Num channels (mono)
    wav_data.write(sample_rate.to_bytes(4, "little"))  # Sample rate
    wav_data.write((sample_rate * 2).to_bytes(4, "little"))  # Byte rate
    wav_data.write((2).to_bytes(2, "little"))  # Block align
    wav_data.write((16).to_bytes(2, "little"))  # Bits per sample
    
    # data chunk
    wav_data.write(b"data")
    wav_data.write((num_samples * 2).to_bytes(4, "little"))  # Data size
    
    # Write audio samples (simple sine-like pattern for speech-like audio)
    for i in range(num_samples):
        # Create variation to simulate speech
        if i % 100 < 50:
            sample = int(10000 * (i % 100) / 50)
        else:
            sample = int(10000 * (100 - (i % 100)) / 50)
        wav_data.write(sample.to_bytes(2, "little", signed=True))
    
    return wav_data.getvalue()


def create_invalid_audio() -> bytes:
    """
    Create invalid audio data that should trigger an error.
    
    Returns:
        Invalid audio bytes
    """
    return b"INVALID_AUDIO_DATA_NOT_A_REAL_FORMAT"


# Strategy for generating valid audio chunks
@st.composite
def audio_chunks_strategy(draw):
    """
    Generate a list of audio chunks with various characteristics.
    
    Returns:
        List of audio byte chunks
    """
    num_chunks = draw(st.integers(min_value=1, max_value=5))
    chunk_duration = draw(st.integers(min_value=50, max_value=500))
    
    chunks = []
    for _ in range(num_chunks):
        chunk = create_valid_wav_audio(chunk_duration)
        chunks.append(chunk)
    
    return chunks


class TestTranscriptDeliveryProperty:
    """
    Property Tests: Transcript Delivery for ASR Service
    
    These tests verify that the ASR service ALWAYS returns either a transcript
    or an error for any finalized audio input. The system must never silently
    fail or hang.
    """

    @pytest.mark.asyncio
    @given(
        audio_chunks=audio_chunks_strategy(),
        audio_format=st.sampled_from(["wav", "webm", "opus"]),
    )
    @settings(
        max_examples=20,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_transcript_or_error_always_returned(
        self, audio_chunks: list[bytes], audio_format: str
    ):
        """
        Property Test: For all finalized audio chunks, a transcript or error is returned.
        
        **Validates: Requirements 5.5, 6.1, 10.3**
        
        This test verifies that the ASR service never silently fails or hangs.
        For any input audio chunks, the service MUST return either:
        1. A StreamingASRResult with a transcript (success case)
        2. An ASRException (error case)
        
        The service SHALL NOT:
        - Return None
        - Hang indefinitely
        - Silently fail without raising an exception
        """
        # Mock the faster-whisper model to return predictable results
        mock_segments = [
            type('Segment', (), {'text': f'Test transcript chunk {i}'})()
            for i in range(len(audio_chunks))
        ]
        mock_info = type('Info', (), {
            'language': 'en',
            'language_probability': 0.95
        })()
        
        with patch('app.services.asr.faster_whisper.WhisperModel') as MockModel:
            mock_model_instance = MockModel.return_value
            mock_model_instance.transcribe.return_value = (mock_segments, mock_info)
            
            asr_service = FasterWhisperASR(
                model_size="base",
                device="cpu",
                compute_type="int8"
            )
            
            # Force model to be loaded
            asr_service._model = mock_model_instance
            
            # Test: transcribe_stream MUST return a result or raise an exception
            result = None
            exception = None
            
            try:
                result = await asr_service.transcribe_stream(
                    audio_chunks=audio_chunks,
                    audio_format=audio_format
                )
            except ASRException as e:
                exception = e
            except Exception as e:
                # Any other exception should be wrapped in ASRException
                pytest.fail(
                    f"ASR service raised unexpected exception type: {type(e).__name__}: {e}"
                )
            
            # PROPERTY: Either result OR exception must be set (never both, never neither)
            assert (result is not None) or (exception is not None), (
                "ASR service returned neither result nor exception - silent failure detected!"
            )
            
            # If result is returned, verify it's valid
            if result is not None:
                assert isinstance(result, StreamingASRResult), (
                    f"Expected StreamingASRResult, got {type(result)}"
                )
                assert isinstance(result.transcript, str), (
                    f"Transcript should be string, got {type(result.transcript)}"
                )
                assert result.is_final is True, (
                    "Finalized audio should produce final transcript"
                )
                assert 0.0 <= result.confidence <= 1.0, (
                    f"Confidence should be in [0, 1], got {result.confidence}"
                )
            
            # If exception is raised, verify it's ASRException
            if exception is not None:
                assert isinstance(exception, ASRException), (
                    f"Expected ASRException, got {type(exception)}"
                )
                assert str(exception), (
                    "ASRException should have a descriptive error message"
                )

    @pytest.mark.asyncio
    @given(
        num_chunks=st.integers(min_value=1, max_value=10),
    )
    @settings(
        max_examples=15,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_empty_transcript_raises_error(self, num_chunks: int):
        """
        Property Test: Empty transcripts are reported as errors, not silent failures.
        
        **Validates: Requirements 5.5, 10.3**
        
        When the ASR model returns an empty transcript (no speech detected),
        the service MUST raise an ASRException rather than returning an empty result.
        This prevents silent failures from propagating through the system.
        """
        audio_chunks = [create_valid_wav_audio(100) for _ in range(num_chunks)]
        
        # Mock the model to return empty transcript
        mock_segments = []  # Empty segments = no speech detected
        mock_info = type('Info', (), {
            'language': 'en',
            'language_probability': 0.5
        })()
        
        with patch('app.services.asr.faster_whisper.WhisperModel') as MockModel:
            mock_model_instance = MockModel.return_value
            mock_model_instance.transcribe.return_value = (mock_segments, mock_info)
            
            asr_service = FasterWhisperASR(model_size="base", device="cpu")
            asr_service._model = mock_model_instance
            
            # Test: Empty transcript should raise ASRException
            with pytest.raises(ASRException) as exc_info:
                await asr_service.transcribe_stream(
                    audio_chunks=audio_chunks,
                    audio_format="wav"
                )
            
            # Verify error message is descriptive
            assert "No speech detected" in str(exc_info.value), (
                f"Expected 'No speech detected' error, got: {exc_info.value}"
            )

    @pytest.mark.asyncio
    @given(
        audio_format=st.sampled_from(["wav", "webm", "opus"]),
    )
    @settings(
        max_examples=10,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_invalid_audio_raises_error(self, audio_format: str):
        """
        Property Test: Invalid audio data raises ASRException, not silent failure.
        
        **Validates: Requirements 10.3**
        
        When invalid audio data is provided, the service MUST raise an ASRException
        with a descriptive error message. The service SHALL NOT:
        - Return None
        - Return an empty result
        - Hang or timeout silently
        """
        invalid_chunks = [create_invalid_audio()]
        
        asr_service = FasterWhisperASR(model_size="base", device="cpu")
        
        # Test: Invalid audio should raise ASRException
        with pytest.raises(ASRException) as exc_info:
            await asr_service.transcribe_stream(
                audio_chunks=invalid_chunks,
                audio_format=audio_format
            )
        
        # Verify error message is descriptive
        error_message = str(exc_info.value)
        assert error_message, "ASRException should have a descriptive error message"
        assert len(error_message) > 10, (
            f"Error message too short: '{error_message}'"
        )

    @pytest.mark.asyncio
    async def test_property_no_chunks_raises_error(self):
        """
        Property Test: Empty chunk list raises ASRException immediately.
        
        **Validates: Requirements 5.5, 10.3**
        
        When no audio chunks are provided, the service MUST raise an ASRException
        immediately rather than attempting to process empty data.
        """
        asr_service = FasterWhisperASR(model_size="base", device="cpu")
        
        # Test: Empty chunks should raise ASRException
        with pytest.raises(ASRException) as exc_info:
            await asr_service.transcribe_stream(
                audio_chunks=[],
                audio_format="wav"
            )
        
        # Verify error message mentions no chunks
        assert "No audio chunks" in str(exc_info.value), (
            f"Expected 'No audio chunks' error, got: {exc_info.value}"
        )

    @pytest.mark.asyncio
    @given(
        audio_chunks=audio_chunks_strategy(),
    )
    @settings(
        max_examples=15,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture]
    )
    async def test_property_result_structure_is_valid(self, audio_chunks: list[bytes]):
        """
        Property Test: Successful transcription returns valid StreamingASRResult structure.
        
        **Validates: Requirements 5.5, 6.1**
        
        When transcription succeeds, the result MUST be a valid StreamingASRResult with:
        - transcript: non-empty string
        - confidence: float in [0.0, 1.0]
        - language: non-empty string
        - is_final: True (for finalized audio)
        """
        # Mock successful transcription
        mock_segments = [
            type('Segment', (), {'text': 'Valid transcript text'})()
        ]
        mock_info = type('Info', (), {
            'language': 'en',
            'language_probability': 0.92
        })()
        
        with patch('app.services.asr.faster_whisper.WhisperModel') as MockModel:
            mock_model_instance = MockModel.return_value
            mock_model_instance.transcribe.return_value = (mock_segments, mock_info)
            
            asr_service = FasterWhisperASR(model_size="base", device="cpu")
            asr_service._model = mock_model_instance
            
            result = await asr_service.transcribe_stream(
                audio_chunks=audio_chunks,
                audio_format="wav"
            )
            
            # PROPERTY: Result structure is valid
            assert isinstance(result, StreamingASRResult), (
                f"Expected StreamingASRResult, got {type(result)}"
            )
            
            # Verify transcript field
            assert isinstance(result.transcript, str), (
                f"transcript should be str, got {type(result.transcript)}"
            )
            assert result.transcript.strip(), (
                "transcript should not be empty or whitespace"
            )
            
            # Verify confidence field
            assert isinstance(result.confidence, (int, float)), (
                f"confidence should be numeric, got {type(result.confidence)}"
            )
            assert 0.0 <= result.confidence <= 1.0, (
                f"confidence should be in [0, 1], got {result.confidence}"
            )
            
            # Verify language field
            assert isinstance(result.language, str), (
                f"language should be str, got {type(result.language)}"
            )
            assert result.language, (
                "language should not be empty"
            )
            
            # Verify is_final field
            assert result.is_final is True, (
                "is_final should be True for finalized audio chunks"
            )

    @pytest.mark.asyncio
    async def test_concrete_successful_transcription(self):
        """
        Concrete Test: Successful transcription returns valid result.
        
        This test documents the expected behavior for a successful transcription
        with valid audio input.
        """
        audio_chunks = [create_valid_wav_audio(200)]
        
        # Mock successful transcription
        mock_segments = [
            type('Segment', (), {'text': 'Hello world'})()
        ]
        mock_info = type('Info', (), {
            'language': 'en',
            'language_probability': 0.98
        })()
        
        with patch('app.services.asr.faster_whisper.WhisperModel') as MockModel:
            mock_model_instance = MockModel.return_value
            mock_model_instance.transcribe.return_value = (mock_segments, mock_info)
            
            asr_service = FasterWhisperASR(model_size="base", device="cpu")
            asr_service._model = mock_model_instance
            
            result = await asr_service.transcribe_stream(
                audio_chunks=audio_chunks,
                audio_format="wav"
            )
            
            # Verify expected result
            assert result.transcript == "Hello world"
            assert result.confidence == 0.98
            assert result.language == "en"
            assert result.is_final is True

    @pytest.mark.asyncio
    async def test_concrete_transcription_failure(self):
        """
        Concrete Test: Transcription failure raises ASRException.
        
        This test documents the expected behavior when transcription fails
        due to model errors or invalid audio.
        """
        audio_chunks = [create_valid_wav_audio(100)]
        
        # Mock transcription failure
        with patch('app.services.asr.faster_whisper.WhisperModel') as MockModel:
            mock_model_instance = MockModel.return_value
            mock_model_instance.transcribe.side_effect = Exception("Model error")
            
            asr_service = FasterWhisperASR(model_size="base", device="cpu")
            asr_service._model = mock_model_instance
            
            # Verify ASRException is raised
            with pytest.raises(ASRException) as exc_info:
                await asr_service.transcribe_stream(
                    audio_chunks=audio_chunks,
                    audio_format="wav"
                )
            
            # Verify error message is descriptive
            assert "faster-whisper transcription failed" in str(exc_info.value)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
