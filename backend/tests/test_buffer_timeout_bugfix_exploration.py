"""
Bug Condition Exploration Test for ASR Buffer Timeout Fix

**Validates: Requirements 2.1, 2.2**

Property 1: Fault Condition - Proactive Buffer Flush Before Timeout

This test explores the bug condition where audio chunks accumulate continuously
without VAD detecting silence (is_final=False), causing the buffer to exceed
the 30-second timeout and raise BufferTimeoutError.

**CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists.

**EXPECTED OUTCOME ON UNFIXED CODE**: 
- Test FAILS with BufferTimeoutError when accumulating chunks for 30+ seconds
- should_process() returns False even with 29 seconds of accumulated audio
- This proves the bug exists: no proactive flush mechanism before timeout

**EXPECTED OUTCOME ON FIXED CODE**:
- Test PASSES - proactive flush triggers before timeout
- should_process() returns True when buffer duration reaches threshold
- No BufferTimeoutError is raised

The test uses a scoped PBT approach: it focuses on concrete failing cases where
continuous audio accumulation for 30+ seconds without is_final flag causes timeout.
"""

import base64
import time
import pytest
from hypothesis import given, strategies as st, settings, HealthCheck

from app.services.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
    BufferTimeoutError,
)


class TestBufferTimeoutBugConditionExploration:
    """
    Bug Condition Exploration: Continuous audio accumulation without silence detection.
    
    These tests demonstrate the bug where continuous audio chunks without is_final=True
    cause indefinite accumulation until 30-second timeout, discarding all audio.
    """

    def test_continuous_accumulation_31_seconds_causes_timeout(self):
        """
        Test that continuous audio accumulation for 31 seconds causes BufferTimeoutError.
        
        **Validates: Requirements 2.1, 2.2**
        
        This test simulates continuous speech without silence detection by adding
        audio chunks for 31 seconds without setting is_final=True. On unfixed code,
        this MUST raise BufferTimeoutError, confirming the bug exists.
        
        On fixed code, this should NOT raise timeout because proactive flush
        should trigger before 30 seconds.
        
        **EXPECTED ON UNFIXED CODE**: BufferTimeoutError raised (test fails)
        **EXPECTED ON FIXED CODE**: No error, should_process() returns True (test passes)
        """
        manager = AudioBufferManager(buffer_timeout=30.0)
        
        # Simulate continuous audio chunks for 31 seconds
        # Add chunks every 0.5 seconds for 31 seconds = 62 chunks
        chunk_interval = 0.5
        total_duration = 31.0
        num_chunks = int(total_duration / chunk_interval)
        
        audio_data = b"x" * 1000  # 1KB per chunk
        audio_b64 = base64.b64encode(audio_data).decode()
        
        # Track if timeout occurred
        timeout_occurred = False
        
        try:
            for i in range(num_chunks):
                chunk = AudioChunkMessage(
                    audio=audio_b64,
                    is_final=False,  # No silence detected
                    timestamp=i * chunk_interval * 1000
                )
                manager.add_chunk(chunk)
                
                # Sleep to simulate real-time accumulation
                time.sleep(chunk_interval)
                
        except BufferTimeoutError as e:
            timeout_occurred = True
            print(f"BufferTimeoutError occurred as expected on unfixed code: {e}")
        
        # On UNFIXED code: timeout_occurred should be True (bug exists)
        # On FIXED code: timeout_occurred should be False (proactive flush prevents timeout)
        
        # The test passes when NO timeout occurs (fixed code behavior)
        # The test fails when timeout occurs (unfixed code behavior)
        assert not timeout_occurred, \
            "BufferTimeoutError occurred - bug exists: no proactive flush before timeout"
        
        # On fixed code, should_process() should return True due to proactive flush
        assert manager.should_process(), \
            "should_process() should return True after proactive flush threshold"

    def test_should_process_returns_false_at_29_seconds_without_final(self):
        """
        Test that should_process() returns False even with 29 seconds of accumulated audio.
        
        **Validates: Requirements 2.1, 2.2**
        
        This test confirms the root cause: should_process() only checks is_final flag,
        not buffer duration. Even with 29 seconds of accumulated audio, it returns False
        when is_final=False.
        
        On unfixed code, this returns False (confirming root cause).
        On fixed code, this should return True (proactive flush at ~25 seconds).
        
        **EXPECTED ON UNFIXED CODE**: should_process() returns False (test fails)
        **EXPECTED ON FIXED CODE**: should_process() returns True (test passes)
        """
        manager = AudioBufferManager(buffer_timeout=30.0)
        
        # Add chunks for 29 seconds without is_final
        chunk_interval = 0.5
        duration = 29.0
        num_chunks = int(duration / chunk_interval)
        
        audio_data = b"x" * 1000
        audio_b64 = base64.b64encode(audio_data).decode()
        
        for i in range(num_chunks):
            chunk = AudioChunkMessage(
                audio=audio_b64,
                is_final=False,
                timestamp=i * chunk_interval * 1000
            )
            manager.add_chunk(chunk)
            time.sleep(chunk_interval)
        
        # On UNFIXED code: should_process() returns False (only checks is_final)
        # On FIXED code: should_process() returns True (checks duration threshold)
        result = manager.should_process()
        
        print(f"should_process() returned: {result}")
        print(f"Buffer has {len(manager.get_chunks())} chunks, {manager.get_total_size()} bytes")
        
        # Test passes when should_process() returns True (fixed code)
        # Test fails when should_process() returns False (unfixed code)
        assert result, \
            "should_process() returned False despite 29 seconds of accumulation - bug exists"

    def test_exactly_30_seconds_accumulation_causes_timeout(self):
        """
        Test that accumulation for exactly 30 seconds causes timeout on next chunk.
        
        **Validates: Requirements 2.1, 2.2**
        
        This test accumulates chunks for exactly 30.0 seconds, then tries to add
        one more chunk. On unfixed code, the next chunk should trigger timeout.
        
        **EXPECTED ON UNFIXED CODE**: BufferTimeoutError on 61st chunk (test fails)
        **EXPECTED ON FIXED CODE**: No timeout, proactive flush occurs (test passes)
        """
        manager = AudioBufferManager(buffer_timeout=30.0)
        
        # Add chunks for exactly 30 seconds
        chunk_interval = 0.5
        num_chunks = 60  # 30 seconds / 0.5 = 60 chunks
        
        audio_data = b"x" * 1000
        audio_b64 = base64.b64encode(audio_data).decode()
        
        timeout_occurred = False
        
        try:
            for i in range(num_chunks):
                chunk = AudioChunkMessage(
                    audio=audio_b64,
                    is_final=False,
                    timestamp=i * chunk_interval * 1000
                )
                manager.add_chunk(chunk)
                time.sleep(chunk_interval)
            
            # Try to add one more chunk after 30 seconds
            final_chunk = AudioChunkMessage(
                audio=audio_b64,
                is_final=False,
                timestamp=num_chunks * chunk_interval * 1000
            )
            manager.add_chunk(final_chunk)
            
        except BufferTimeoutError as e:
            timeout_occurred = True
            print(f"BufferTimeoutError at 30+ seconds: {e}")
        
        # Test passes when no timeout (fixed code)
        # Test fails when timeout occurs (unfixed code)
        assert not timeout_occurred, \
            "BufferTimeoutError at 30 seconds - bug exists: no proactive flush"

    def test_large_buffer_244_chunks_without_silence_causes_timeout(self):
        """
        Test that accumulating 244+ chunks (486,178+ bytes) without silence causes timeout.
        
        **Validates: Requirements 2.1, 2.2**
        
        This test replicates the exact scenario from the bug report: 244 chunks
        accumulating to 486,178 bytes over 30+ seconds without is_final flag.
        
        **EXPECTED ON UNFIXED CODE**: BufferTimeoutError after 30 seconds (test fails)
        **EXPECTED ON FIXED CODE**: Proactive flush prevents timeout (test passes)
        """
        manager = AudioBufferManager(buffer_timeout=30.0)
        
        # Calculate chunk size to reach ~486,178 bytes in 244 chunks
        target_total_bytes = 486178
        num_chunks = 244
        chunk_size = target_total_bytes // num_chunks  # ~1992 bytes per chunk
        
        # Add chunks over 31 seconds
        chunk_interval = 31.0 / num_chunks  # ~0.127 seconds per chunk
        
        audio_data = b"x" * chunk_size
        audio_b64 = base64.b64encode(audio_data).decode()
        
        timeout_occurred = False
        chunks_added = 0
        
        try:
            for i in range(num_chunks):
                chunk = AudioChunkMessage(
                    audio=audio_b64,
                    is_final=False,
                    timestamp=i * chunk_interval * 1000
                )
                manager.add_chunk(chunk)
                chunks_added += 1
                time.sleep(chunk_interval)
                
        except BufferTimeoutError as e:
            timeout_occurred = True
            print(f"BufferTimeoutError after {chunks_added} chunks: {e}")
            print(f"Total size: {manager.get_total_size()} bytes")
        
        # Test passes when no timeout (fixed code)
        # Test fails when timeout occurs (unfixed code)
        assert not timeout_occurred, \
            f"BufferTimeoutError after {chunks_added} chunks - bug exists: no proactive flush"
        
        # Verify we added all chunks successfully
        assert chunks_added == num_chunks, \
            f"Only added {chunks_added}/{num_chunks} chunks before timeout"

    @given(
        duration_seconds=st.floats(min_value=30.1, max_value=35.0),
        chunk_interval=st.floats(min_value=0.1, max_value=1.0),
    )
    @settings(
        max_examples=10,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow]
    )
    def test_property_continuous_accumulation_without_final_causes_timeout(
        self, duration_seconds: float, chunk_interval: float
    ):
        """
        Property Test: Continuous accumulation beyond 30 seconds without is_final causes timeout.
        
        **Validates: Requirements 2.1, 2.2**
        
        This property test explores various durations and chunk intervals to confirm
        that the bug manifests consistently: continuous audio without is_final flag
        causes timeout after 30 seconds.
        
        **EXPECTED ON UNFIXED CODE**: BufferTimeoutError (test fails)
        **EXPECTED ON FIXED CODE**: No timeout due to proactive flush (test passes)
        """
        manager = AudioBufferManager(buffer_timeout=30.0)
        
        num_chunks = int(duration_seconds / chunk_interval)
        audio_data = b"x" * 1000
        audio_b64 = base64.b64encode(audio_data).decode()
        
        timeout_occurred = False
        
        try:
            for i in range(num_chunks):
                chunk = AudioChunkMessage(
                    audio=audio_b64,
                    is_final=False,
                    timestamp=i * chunk_interval * 1000
                )
                manager.add_chunk(chunk)
                time.sleep(chunk_interval)
                
        except BufferTimeoutError:
            timeout_occurred = True
        
        # Test passes when no timeout (fixed code with proactive flush)
        # Test fails when timeout occurs (unfixed code without proactive flush)
        assert not timeout_occurred, \
            f"BufferTimeoutError with duration={duration_seconds}s, interval={chunk_interval}s"
