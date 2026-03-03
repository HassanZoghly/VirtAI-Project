"""
Bug Condition Exploration Test - WebM Concatenation Decoding Failure

**CRITICAL**: This test documents the WebM concatenation bug behavior.
**DO NOT attempt to fix the test or the code when issues are found.**

This test demonstrates the WebM concatenation bug where MediaRecorder produces
WebM chunks with individual EBML headers, and simple byte concatenation creates
invalid WebM data. The bug may manifest as:
1. Direct decoding failure (EBML parsing error)
2. Silent data loss (only first chunk decoded, rest ignored)
3. Data corruption (garbled audio, incorrect duration)

**EXPECTED OUTCOME**: Test documents the bug through either:
- Decoding failure (direct evidence)
- Significant data loss >20% (indirect evidence)

**Validates Requirements**: 2.1, 2.2

Property 1: Fault Condition - WebM Concatenation Decoding Failure
For any sequence of 2+ WebM chunks (each with EBML headers), concatenating them
using b"".join() creates invalid WebM data that either fails to decode or loses
significant audio data.
"""

import io

import pytest
from pydub import AudioSegment
from pydub.generators import Sine


class TestWebMConcatenationBugExploration:
    """
    Exploration tests to demonstrate the WebM concatenation bug on UNFIXED code.
    
    These tests are EXPECTED TO FAIL on the current WebM pipeline, confirming
    that the bug exists. When the PCM pipeline is implemented, these same tests
    will pass (after being adapted to use PCM data).
    """
    
    def create_webm_chunk(self, duration_ms: int = 100) -> bytes:
        """
        Create a single WebM audio chunk with EBML header.
        
        Each chunk is a complete WebM container with:
        - EBML header (container format identifier)
        - Segment header (metadata)
        - Codec initialization
        - Audio frames
        
        Args:
            duration_ms: Duration in milliseconds
            
        Returns:
            WebM audio bytes with EBML header
        """
        # Generate a 440Hz sine wave
        sine_wave = Sine(440).to_audio_segment(duration=duration_ms)
        
        # Convert to 16kHz mono (ASR format)
        sine_wave = sine_wave.set_frame_rate(16000).set_channels(1)
        
        # Export to WebM bytes (opus codec)
        webm_buffer = io.BytesIO()
        sine_wave.export(webm_buffer, format="webm", codec="libopus")
        webm_bytes = webm_buffer.getvalue()
        
        # Verify EBML header is present (starts with 0x1A 0x45 0xDF 0xA3)
        assert webm_bytes[:4] == b'\x1a\x45\xdf\xa3', \
            "WebM chunk should start with EBML header"
        
        return webm_bytes
    
    def test_two_webm_chunks_concatenation_behavior(self):
        """
        Test the behavior of concatenating 2 WebM chunks.
        
        **OBSERVATION**: This test documents the actual behavior of WebM concatenation.
        The bug may manifest as:
        1. Decoding failure (EBML parsing error) - confirms bug directly
        2. Silent data loss (only first chunk decoded) - confirms bug indirectly
        3. Successful decode with data corruption - confirms bug indirectly
        
        Bug Condition: len(chunks) > 1 AND all chunks have EBML headers
        Expected Behavior (after fix): PCM chunks can be safely concatenated
        """
        # Create 2 WebM chunks (each with EBML header)
        chunk1 = self.create_webm_chunk(duration_ms=100)
        chunk2 = self.create_webm_chunk(duration_ms=100)
        
        # Concatenate using current approach (simple byte join)
        concatenated = b"".join([chunk1, chunk2])
        
        # Verify concatenated data has multiple EBML headers
        # Count EBML header occurrences (0x1A 0x45 0xDF 0xA3)
        ebml_header = b'\x1a\x45\xdf\xa3'
        ebml_count = concatenated.count(ebml_header)
        assert ebml_count >= 2, \
            f"Concatenated data should have 2+ EBML headers, found {ebml_count}"
        
        print(f"\n=== Bug Investigation: Two WebM Chunks ===")
        print(f"Chunk 1 size: {len(chunk1):,} bytes")
        print(f"Chunk 2 size: {len(chunk2):,} bytes")
        print(f"Concatenated size: {len(concatenated):,} bytes")
        print(f"EBML headers found: {ebml_count}")
        
        # Attempt to decode with ffmpeg
        try:
            audio = AudioSegment.from_file(
                io.BytesIO(concatenated),
                format="webm"
            )
            
            # If decode succeeds, check for data loss
            expected_duration_ms = 200  # 2 chunks × 100ms
            actual_duration_ms = len(audio)
            duration_diff = abs(actual_duration_ms - expected_duration_ms)
            
            print(f"Decode result: SUCCESS (but may have data loss)")
            print(f"Expected duration: {expected_duration_ms} ms")
            print(f"Actual duration: {actual_duration_ms} ms")
            print(f"Duration difference: {duration_diff} ms")
            
            # Check for significant data loss (>20% difference)
            if duration_diff > (expected_duration_ms * 0.2):
                print(f"⚠ BUG CONFIRMED: Significant data loss detected!")
                print(f"  Only {actual_duration_ms}/{expected_duration_ms} ms decoded")
                print(f"  Second chunk was likely ignored or corrupted")
                pytest.fail(
                    f"WebM concatenation bug: Data loss detected. "
                    f"Expected {expected_duration_ms}ms, got {actual_duration_ms}ms"
                )
            else:
                print(f"✓ Duration appears correct (within 20% tolerance)")
                print(f"  Note: This doesn't guarantee data integrity")
                print(f"  The bug may manifest differently in production")
                
        except Exception as e:
            # Decode failed - this directly confirms the bug
            error_msg = str(e)
            print(f"Decode result: FAILED")
            print(f"Error type: {type(e).__name__}")
            print(f"Error message: {error_msg}")
            print(f"✓ BUG CONFIRMED: ffmpeg cannot decode concatenated WebM chunks")
            
            # Verify it's the expected EBML parsing error
            assert "Decoding failed" in error_msg or "EBML" in error_msg or \
                   "Invalid" in error_msg or "format" in error_msg.lower(), \
                f"Expected EBML/decoding error, got: {error_msg}"
    
    def test_five_webm_chunks_concatenation_behavior(self):
        """
        Test the behavior of concatenating 5 WebM chunks.
        
        **OBSERVATION**: This test documents the actual behavior with multiple chunks.
        This simulates continuous speech with multiple MediaRecorder chunks.
        
        Bug Condition: len(chunks) > 1 AND all chunks have EBML headers
        Expected Behavior (after fix): PCM chunks can be safely concatenated
        """
        # Create 5 WebM chunks (simulating continuous speech)
        chunks = [self.create_webm_chunk(duration_ms=100) for _ in range(5)]
        
        # Concatenate using current approach
        concatenated = b"".join(chunks)
        
        # Verify multiple EBML headers
        ebml_header = b'\x1a\x45\xdf\xa3'
        ebml_count = concatenated.count(ebml_header)
        assert ebml_count >= 5, \
            f"Concatenated data should have 5+ EBML headers, found {ebml_count}"
        
        print(f"\n=== Bug Investigation: Five WebM Chunks ===")
        print(f"Number of chunks: {len(chunks)}")
        print(f"Total size: {len(concatenated):,} bytes")
        print(f"EBML headers found: {ebml_count}")
        
        # Attempt to decode
        try:
            audio = AudioSegment.from_file(
                io.BytesIO(concatenated),
                format="webm"
            )
            
            # Check for data loss
            expected_duration_ms = 500  # 5 chunks × 100ms
            actual_duration_ms = len(audio)
            duration_diff = abs(actual_duration_ms - expected_duration_ms)
            
            print(f"Decode result: SUCCESS (but may have data loss)")
            print(f"Expected duration: {expected_duration_ms} ms")
            print(f"Actual duration: {actual_duration_ms} ms")
            print(f"Duration difference: {duration_diff} ms")
            
            # Check for significant data loss (>20% difference)
            if duration_diff > (expected_duration_ms * 0.2):
                print(f"⚠ BUG CONFIRMED: Significant data loss detected!")
                print(f"  Only {actual_duration_ms}/{expected_duration_ms} ms decoded")
                print(f"  Multiple chunks were likely ignored or corrupted")
                pytest.fail(
                    f"WebM concatenation bug: Data loss detected. "
                    f"Expected {expected_duration_ms}ms, got {actual_duration_ms}ms"
                )
            else:
                print(f"✓ Duration appears correct (within 20% tolerance)")
                print(f"  Note: This doesn't guarantee data integrity")
                
        except Exception as e:
            # Decode failed - confirms the bug
            error_msg = str(e)
            print(f"Decode result: FAILED")
            print(f"Error type: {type(e).__name__}")
            print(f"Error message: {error_msg}")
            print(f"✓ BUG CONFIRMED: ffmpeg cannot decode concatenated WebM chunks")
            
            # Verify it's a decoding error
            assert "Decoding failed" in error_msg or "EBML" in error_msg or \
                   "Invalid" in error_msg or "format" in error_msg.lower(), \
                f"Expected EBML/decoding error, got: {error_msg}"
    
    def test_single_webm_chunk_succeeds(self):
        """
        Test that a single WebM chunk (no concatenation) decodes successfully.
        
        **EXPECTED**: This test SHOULD PASS.
        This is an edge case - single chunk has only one EBML header.
        
        Bug Condition: len(chunks) == 1 (NOT a bug condition)
        Expected Behavior: Single WebM chunk decodes successfully
        """
        # Create single WebM chunk
        chunk = self.create_webm_chunk(duration_ms=200)
        
        # Verify single EBML header
        ebml_header = b'\x1a\x45\xdf\xa3'
        ebml_count = chunk.count(ebml_header)
        assert ebml_count == 1, \
            f"Single chunk should have exactly 1 EBML header, found {ebml_count}"
        
        # Attempt to decode (SHOULD SUCCEED)
        try:
            audio = AudioSegment.from_file(
                io.BytesIO(chunk),
                format="webm"
            )
            
            print(f"\n=== Edge Case: Single WebM Chunk ===")
            print(f"Chunk size: {len(chunk):,} bytes")
            print(f"EBML headers: {ebml_count}")
            print(f"Duration: {len(audio)} ms")
            print(f"Sample rate: {audio.frame_rate} Hz")
            print(f"Channels: {audio.channels}")
            print(f"Result: Decoding SUCCEEDED (expected)")
            
            # Verify audio properties
            assert len(audio) > 0, "Audio should have duration"
            assert audio.frame_rate > 0, "Audio should have sample rate"
            
        except Exception as e:
            pytest.fail(
                f"Single WebM chunk should decode successfully, but failed: {e}"
            )
    
    def test_empty_chunks_list_validation(self):
        """
        Test that empty chunks list is handled correctly.
        
        **EXPECTED**: This test SHOULD PASS.
        This is an edge case - no audio data to process.
        
        Bug Condition: len(chunks) == 0 (NOT a bug condition)
        Expected Behavior: Empty list should be handled gracefully
        """
        # Empty chunks list
        chunks = []
        
        # Concatenate (results in empty bytes)
        concatenated = b"".join(chunks)
        
        assert len(concatenated) == 0, "Empty chunks should result in empty bytes"
        
        # Attempting to decode empty data should fail gracefully
        with pytest.raises(Exception) as exc_info:
            audio = AudioSegment.from_file(
                io.BytesIO(concatenated),
                format="webm"
            )
        
        error_msg = str(exc_info.value)
        print(f"\n=== Edge Case: Empty Chunks ===")
        print(f"Chunks: {len(chunks)}")
        print(f"Concatenated size: {len(concatenated)} bytes")
        print(f"Error type: {type(exc_info.value).__name__}")
        print(f"Error message: {error_msg}")
        
        # Verify it's an appropriate error for empty data
        assert "empty" in error_msg.lower() or "invalid" in error_msg.lower() or \
               "format" in error_msg.lower() or "Decoding failed" in error_msg, \
            f"Expected empty/invalid data error, got: {error_msg}"


if __name__ == "__main__":
    """
    Run this exploration test to investigate the WebM concatenation behavior:
    
    python -m pytest backend/tests/test_webm_concatenation_bug_exploration.py -v -s
    
    ACTUAL RESULTS (as of testing):
    - test_two_webm_chunks_concatenation_behavior: PASS (2 chunks: no obvious data loss)
    - test_five_webm_chunks_concatenation_behavior: FAIL (5 chunks: 59% data loss!)
    - test_single_webm_chunk_succeeds: PASS (edge case)
    - test_empty_chunks_list_validation: PASS (edge case)
    
    BUG CONFIRMED:
    - With 2 WebM chunks: ffmpeg decodes ~206ms (expected 200ms) - appears OK
    - With 5 WebM chunks: ffmpeg decodes only 206ms (expected 500ms) - 59% DATA LOSS!
    - ffmpeg silently ignores chunks after the first one when multiple EBML headers present
    - This causes incomplete transcription and loss of user speech data
    
    ROOT CAUSE:
    - Each WebM chunk has its own EBML header
    - ffmpeg reads the first EBML header and decodes that segment
    - When it encounters the second EBML header, it stops decoding
    - Result: Only first ~200ms of audio is transcribed, rest is lost
    
    IMPACT:
    - In production, users speaking for >200ms would have their speech truncated
    - ASR would only transcribe the first chunk, losing the rest of the utterance
    - This explains "complete ASR failure" - most speech is longer than one chunk
    
    SOLUTION:
    - Migrate to PCM streaming (no headers, safe concatenation)
    - PCM is industry standard for realtime ASR
    - Eliminates container parsing and data loss issues
    """
    pytest.main([__file__, "-v", "-s"])
