"""
Manual verification test for ASR transcription with sample audio.

This test creates a simple audio file and verifies that the ASR service
can transcribe it successfully. This is part of the checkpoint validation
for backend core functionality.
"""

import asyncio
import base64
import io
import os
import tempfile

import pytest
from pydub import AudioSegment
from pydub.generators import Sine

from app.core.config import get_settings
from app.services.asr.groq_whisper import GroqWhisperASR


class TestASRManualVerification:
    """Manual verification tests for ASR transcription"""

    @pytest.fixture
    def settings(self):
        """Get application settings"""
        return get_settings()

    @pytest.fixture
    def asr_service(self, settings):
        """Create ASR service instance"""
        return GroqWhisperASR()

    def create_sample_audio_wav(self, duration_ms: int = 1000) -> bytes:
        """
        Create a simple WAV audio file with a sine wave tone.
        
        Args:
            duration_ms: Duration in milliseconds
            
        Returns:
            WAV audio bytes
        """
        # Generate a 440Hz sine wave (A4 note)
        sine_wave = Sine(440).to_audio_segment(duration=duration_ms)
        
        # Convert to 16kHz mono (optimal for ASR)
        sine_wave = sine_wave.set_frame_rate(16000).set_channels(1)
        
        # Export to WAV bytes
        wav_buffer = io.BytesIO()
        sine_wave.export(wav_buffer, format="wav")
        return wav_buffer.getvalue()

    def create_sample_audio_webm(self, duration_ms: int = 1000) -> bytes:
        """
        Create a simple WebM audio file.
        
        Args:
            duration_ms: Duration in milliseconds
            
        Returns:
            WebM audio bytes
        """
        # Generate a 440Hz sine wave
        sine_wave = Sine(440).to_audio_segment(duration=duration_ms)
        
        # Convert to 16kHz mono
        sine_wave = sine_wave.set_frame_rate(16000).set_channels(1)
        
        # Export to WebM bytes (opus codec)
        webm_buffer = io.BytesIO()
        sine_wave.export(webm_buffer, format="webm", codec="libopus")
        return webm_buffer.getvalue()

    @pytest.mark.asyncio
    async def test_asr_service_availability(self, asr_service):
        """Test that ASR service is available and responding"""
        is_available = await asr_service.is_available()
        assert is_available, "ASR service should be available"

    @pytest.mark.asyncio
    async def test_transcribe_sample_wav_audio(self, asr_service):
        """
        Test ASR transcription with a sample WAV audio file.
        
        Note: This test uses a sine wave tone, which won't produce meaningful
        transcription but verifies the ASR pipeline works end-to-end.
        """
        # Create sample audio
        audio_bytes = self.create_sample_audio_wav(duration_ms=2000)
        
        assert len(audio_bytes) > 0, "Sample audio should be generated"
        
        # Attempt transcription
        # Note: Sine wave won't produce meaningful text, but should not crash
        try:
            result = await asr_service.transcribe(
                audio_bytes=audio_bytes,
                audio_format="wav",
                language="en"
            )
            
            # Verify result structure
            assert result is not None, "ASR result should not be None"
            assert hasattr(result, 'transcript'), "Result should have transcript"
            assert hasattr(result, 'language'), "Result should have language"
            assert hasattr(result, 'confidence'), "Result should have confidence"
            
            print(f"\nASR Result:")
            print(f"  Transcript: '{result.transcript}'")
            print(f"  Language: {result.language}")
            print(f"  Confidence: {result.confidence:.2f}")
            print(f"  Segments: {len(result.segments)}")
            
        except Exception as e:
            # It's acceptable if ASR returns empty transcript for sine wave
            # but the pipeline should not crash
            print(f"\nASR returned error (expected for sine wave): {e}")
            assert "empty transcript" in str(e).lower() or "no speech" in str(e).lower(), \
                f"Expected 'empty transcript' or 'no speech' error, got: {e}"

    @pytest.mark.asyncio
    async def test_transcribe_sample_webm_audio(self, asr_service):
        """
        Test ASR transcription with a sample WebM audio file.
        """
        # Create sample audio
        audio_bytes = self.create_sample_audio_webm(duration_ms=2000)
        
        assert len(audio_bytes) > 0, "Sample audio should be generated"
        
        # Attempt transcription
        try:
            result = await asr_service.transcribe(
                audio_bytes=audio_bytes,
                audio_format="webm",
                language="en"
            )
            
            # Verify result structure
            assert result is not None, "ASR result should not be None"
            assert hasattr(result, 'transcript'), "Result should have transcript"
            
            print(f"\nASR Result (WebM):")
            print(f"  Transcript: '{result.transcript}'")
            print(f"  Language: {result.language}")
            print(f"  Confidence: {result.confidence:.2f}")
            
        except Exception as e:
            # It's acceptable if ASR returns empty transcript for sine wave
            print(f"\nASR returned error (expected for sine wave): {e}")
            assert "empty transcript" in str(e).lower() or "no speech" in str(e).lower(), \
                f"Expected 'empty transcript' or 'no speech' error, got: {e}"

    @pytest.mark.asyncio
    async def test_audio_buffer_to_asr_integration(self, asr_service):
        """
        Test the integration between audio buffer and ASR service.
        
        This simulates the flow from WebSocket audio chunks to transcription.
        """
        from app.services.audio_pipeline import AudioPipeline
        
        # Create audio pipeline
        pipeline = AudioPipeline()
        
        # Create sample audio and split into chunks
        audio_bytes = self.create_sample_audio_wav(duration_ms=2000)
        
        # Encode to base64 (as it would come from WebSocket)
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        # Split into chunks (simulate streaming)
        chunk_size = len(audio_base64) // 3
        chunks = [
            audio_base64[:chunk_size],
            audio_base64[chunk_size:chunk_size*2],
            audio_base64[chunk_size*2:]
        ]
        
        # Add chunks to buffer
        for i, chunk_data in enumerate(chunks):
            is_final = (i == len(chunks) - 1)
            chunk = AudioChunkMessage(
                audio=chunk_data,
                is_final=is_final,
                timestamp=float(i * 100),
                format="wav"
            )
            buffer.add_chunk(chunk)
        
        # Verify buffer is ready for processing
        assert buffer.should_process(), "Buffer should be ready after final chunk"
        
        # Get accumulated chunks
        audio_chunks = buffer.get_chunks()
        assert len(audio_chunks) == 3, "Should have 3 chunks"
        
        # Attempt transcription (will likely fail with empty transcript for sine wave)
        try:
            # Note: GroqWhisperASR doesn't have transcribe_chunks, so we join manually
            combined_audio = b"".join(audio_chunks)
            result = await asr_service.transcribe(
                audio_bytes=combined_audio,
                audio_format="wav",
                language="en"
            )
            
            print(f"\nIntegration Test Result:")
            print(f"  Chunks processed: {len(audio_chunks)}")
            print(f"  Total size: {len(combined_audio):,} bytes")
            print(f"  Transcript: '{result.transcript}'")
            
        except Exception as e:
            print(f"\nIntegration test error (expected): {e}")
            assert "empty transcript" in str(e).lower() or "no speech" in str(e).lower()
        
        # Clean up buffer
        buffer.clear()
        assert buffer.get_total_size() == 0, "Buffer should be cleared"


if __name__ == "__main__":
    """
    Run this test manually to verify ASR functionality:
    
    python -m pytest tests/test_asr_manual_verification.py -v -s
    """
    pytest.main([__file__, "-v", "-s"])
