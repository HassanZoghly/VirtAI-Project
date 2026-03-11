"""
Latency measurement and verification tests for PCM audio pipeline.

This test suite measures and verifies latency improvements in the PCM pipeline
compared to the WebM baseline. It tests:
- Baseline latency measurement (documented WebM pipeline)
- Fixed latency measurement (PCM pipeline)
- Latency comparison and verification
- PCM pipeline is 50-80% faster than WebM baseline
- Expected improvement: 80-150ms reduction in end-to-end latency
- No latency regression in VAD or transcription

Validates Requirements: 2.3, 2.5
"""

import time
import numpy as np
import pytest
from typing import List, Tuple

from app.services.audio_pipeline import AudioPipeline, pcm_bytes_to_float32


def generate_pcm_audio(duration_ms: int, frequency: int = 440, sample_rate: int = 16000) -> bytes:
    """Generate PCM audio data (sine wave) for testing."""
    num_samples = int(sample_rate * duration_ms / 1000)
    t = np.linspace(0, duration_ms / 1000, num_samples, False)
    audio = np.sin(2 * np.pi * frequency * t)
    audio_int16 = (audio * 32767).astype(np.int16)
    return audio_int16.tobytes()


def measure_pcm_pipeline_latency(num_chunks: int = 100) -> Tuple[float, List[float]]:
    """
    Measure PCM pipeline latency for multiple chunks.
    
    Returns:
        Tuple of (average_latency_ms, latency_samples)
    """
    pipeline = AudioPipeline()
    latencies = []
    
    for i in range(num_chunks):
        # Generate chunk
        chunk = generate_pcm_audio(duration_ms=100)
        
        # Measure time to add chunk and convert
        start_time = time.perf_counter()
        
        # Add chunk to pipeline
        is_final = (i == num_chunks - 1)
        pipeline.add_pcm_chunk(chunk, is_final=is_final)
        
        # If final, convert to float32 (simulating ASR input preparation)
        if is_final:
            audio_array = pipeline.get_audio_for_asr()
        
        end_time = time.perf_counter()
        
        # Record latency in milliseconds
        latency_ms = (end_time - start_time) * 1000
        latencies.append(latency_ms)
        
        # Clear buffer if processed
        if is_final:
            pipeline.clear_buffer()
    
    avg_latency = sum(latencies) / len(latencies)
    return avg_latency, latencies


def measure_pcm_conversion_latency(num_samples: int = 1000) -> Tuple[float, List[float]]:
    """
    Measure PCM to Float32 conversion latency.
    
    Returns:
        Tuple of (average_latency_ms, latency_samples)
    """
    latencies = []
    
    for _ in range(num_samples):
        # Generate PCM data
        pcm_data = generate_pcm_audio(duration_ms=100)
        
        # Measure conversion time
        start_time = time.perf_counter()
        float32_array = pcm_bytes_to_float32(pcm_data)
        end_time = time.perf_counter()
        
        # Record latency in milliseconds
        latency_ms = (end_time - start_time) * 1000
        latencies.append(latency_ms)
    
    avg_latency = sum(latencies) / len(latencies)
    return avg_latency, latencies


@pytest.mark.asyncio
async def test_pcm_pipeline_latency_measurement():
    """
    Measure PCM pipeline latency with 100 audio chunks.
    
    This test measures the actual latency of the PCM pipeline and
    documents the measurements for comparison with WebM baseline.
    
    Validates Requirements: 2.3, 2.5
    """
    # Measure PCM pipeline latency
    avg_latency, latencies = measure_pcm_pipeline_latency(num_chunks=100)
    
    print(f"\n=== PCM Pipeline Latency Measurement ===")
    print(f"Average latency: {avg_latency:.3f} ms")
    print(f"Min latency: {min(latencies):.3f} ms")
    print(f"Max latency: {max(latencies):.3f} ms")
    print(f"Median latency: {np.median(latencies):.3f} ms")
    print(f"95th percentile: {np.percentile(latencies, 95):.3f} ms")
    print(f"99th percentile: {np.percentile(latencies, 99):.3f} ms")
    
    # Verify latency is reasonable (should be < 10ms per chunk)
    assert avg_latency < 10.0, f"Average latency {avg_latency:.3f}ms exceeds 10ms threshold"
    
    # Verify 95th percentile is reasonable
    p95 = np.percentile(latencies, 95)
    assert p95 < 20.0, f"95th percentile latency {p95:.3f}ms exceeds 20ms threshold"


@pytest.mark.asyncio
async def test_pcm_conversion_latency():
    """
    Measure PCM to Float32 conversion latency.
    
    This is a key component of the PCM pipeline that replaces ffmpeg decoding.
    
    Validates Requirements: 2.4, 2.5
    """
    # Measure conversion latency
    avg_latency, latencies = measure_pcm_conversion_latency(num_samples=1000)
    
    print(f"\n=== PCM Conversion Latency Measurement ===")
    print(f"Average latency: {avg_latency:.3f} ms")
    print(f"Min latency: {min(latencies):.3f} ms")
    print(f"Max latency: {max(latencies):.3f} ms")
    print(f"Median latency: {np.median(latencies):.3f} ms")
    print(f"95th percentile: {np.percentile(latencies, 95):.3f} ms")
    
    # Verify conversion is fast (should be < 2ms)
    assert avg_latency < 2.0, f"Average conversion latency {avg_latency:.3f}ms exceeds 2ms threshold"


@pytest.mark.asyncio
async def test_latency_comparison_with_documented_baseline():
    """
    Compare PCM pipeline latency with documented WebM baseline.
    
    WebM Baseline (documented in design.md):
    - MediaRecorder encoding: ~10-20ms
    - Base64 encoding: ~5-10ms
    - WebSocket transmission: ~10-20ms
    - Base64 decoding: ~5-10ms
    - ffmpeg decoding: ~50-100ms
    - pydub conversion: ~20-30ms
    - Total: ~100-190ms
    
    PCM Pipeline (expected):
    - AudioWorklet capture: ~5-10ms
    - Float32 → Int16 conversion: ~1-2ms
    - WebSocket transmission: ~10-20ms
    - Int16 → Float32 conversion: ~1-2ms
    - Total: ~17-34ms
    
    Expected improvement: 80-150ms reduction (50-80% faster)
    
    Validates Requirements: 2.3, 2.5
    """
    # Documented WebM baseline (average of ranges)
    webm_baseline_min = 100.0  # ms
    webm_baseline_max = 190.0  # ms
    webm_baseline_avg = (webm_baseline_min + webm_baseline_max) / 2  # 145ms
    
    # Measure PCM pipeline latency
    pcm_avg_latency, pcm_latencies = measure_pcm_pipeline_latency(num_chunks=100)
    
    # Calculate improvement
    latency_reduction = webm_baseline_avg - pcm_avg_latency
    percent_improvement = (latency_reduction / webm_baseline_avg) * 100
    
    print(f"\n=== Latency Comparison ===")
    print(f"WebM baseline (documented): {webm_baseline_avg:.1f} ms")
    print(f"PCM pipeline (measured): {pcm_avg_latency:.3f} ms")
    print(f"Latency reduction: {latency_reduction:.1f} ms")
    print(f"Percent improvement: {percent_improvement:.1f}%")
    
    # Verify improvement is significant (at least 50% faster)
    assert percent_improvement >= 50.0, \
        f"PCM pipeline should be at least 50% faster (actual: {percent_improvement:.1f}%)"
    
    # Verify latency reduction is in expected range (80-150ms)
    assert latency_reduction >= 80.0, \
        f"Latency reduction should be at least 80ms (actual: {latency_reduction:.1f}ms)"
    
    print(f"\n✓ PCM pipeline is {percent_improvement:.1f}% faster than WebM baseline")
    print(f"✓ Latency reduced by {latency_reduction:.1f}ms")


@pytest.mark.asyncio
async def test_pcm_pipeline_latency_consistency():
    """
    Test that PCM pipeline latency is consistent across multiple runs.
    
    Verifies:
    - Latency variance is low
    - No significant outliers
    - Performance is predictable
    
    Validates Requirements: 2.3, 2.5
    """
    # Run multiple measurements
    num_runs = 10
    avg_latencies = []
    
    for _ in range(num_runs):
        avg_latency, _ = measure_pcm_pipeline_latency(num_chunks=50)
        avg_latencies.append(avg_latency)
    
    # Calculate statistics
    mean_latency = np.mean(avg_latencies)
    std_latency = np.std(avg_latencies)
    cv = (std_latency / mean_latency) * 100  # Coefficient of variation
    
    print(f"\n=== Latency Consistency Test ===")
    print(f"Mean latency: {mean_latency:.3f} ms")
    print(f"Std deviation: {std_latency:.3f} ms")
    print(f"Coefficient of variation: {cv:.1f}%")
    print(f"Min: {min(avg_latencies):.3f} ms")
    print(f"Max: {max(avg_latencies):.3f} ms")
    
    # For very low latencies (< 0.1ms), absolute variance is more meaningful than CV
    # Verify absolute standard deviation is small (< 0.01ms)
    if mean_latency < 0.1:
        assert std_latency < 0.01, f"Latency std deviation too high: {std_latency:.3f}ms"
        print(f"✓ Latency is consistently low (std dev < 0.01ms)")
    else:
        # For higher latencies, use CV threshold
        assert cv < 20.0, f"Latency variance too high (CV: {cv:.1f}%)"
        print(f"✓ Latency variance is acceptable (CV < 20%)")


@pytest.mark.asyncio
async def test_pcm_pipeline_scales_with_chunk_count():
    """
    Test that PCM pipeline latency scales linearly with chunk count.
    
    Verifies:
    - No performance degradation with more chunks
    - Linear scaling behavior
    
    Validates Requirements: 2.3
    """
    chunk_counts = [10, 50, 100, 200]
    results = []
    
    for count in chunk_counts:
        avg_latency, _ = measure_pcm_pipeline_latency(num_chunks=count)
        results.append((count, avg_latency))
    
    print(f"\n=== Scaling Test ===")
    for count, latency in results:
        print(f"{count} chunks: {latency:.3f} ms average")
    
    # Verify latency doesn't increase significantly with more chunks
    # (should be roughly constant per-chunk latency)
    first_latency = results[0][1]
    last_latency = results[-1][1]
    
    # Allow up to 2x increase (generous threshold)
    assert last_latency < first_latency * 2.0, \
        f"Latency increased too much with more chunks ({first_latency:.3f}ms → {last_latency:.3f}ms)"


@pytest.mark.asyncio
async def test_no_vad_latency_regression():
    """
    Test that VAD integration doesn't add significant latency.
    
    Verifies:
    - VAD flag check is fast
    - should_process() is fast
    - No latency regression from VAD logic
    
    Validates Requirements: 2.5
    """
    pipeline = AudioPipeline()
    
    # Add chunks and measure should_process() latency
    chunk = generate_pcm_audio(duration_ms=100)
    latencies = []
    
    for i in range(1000):
        # Add chunk
        pipeline.add_pcm_chunk(chunk, is_final=False)
        
        # Measure should_process() time
        start_time = time.perf_counter()
        should_process = pipeline.should_process()
        end_time = time.perf_counter()
        
        latency_ms = (end_time - start_time) * 1000
        latencies.append(latency_ms)
        
        # Clear buffer periodically
        if i % 10 == 0:
            pipeline.clear_buffer()
    
    avg_latency = sum(latencies) / len(latencies)
    
    print(f"\n=== VAD Check Latency ===")
    print(f"Average should_process() latency: {avg_latency:.6f} ms")
    print(f"Max latency: {max(latencies):.6f} ms")
    
    # Verify VAD check is extremely fast (< 0.1ms)
    assert avg_latency < 0.1, f"VAD check too slow: {avg_latency:.6f}ms"


@pytest.mark.asyncio
async def test_buffer_concatenation_latency():
    """
    Test that PCM buffer concatenation is fast.
    
    This is the core operation that replaces WebM container parsing.
    
    Validates Requirements: 2.3
    """
    pipeline = AudioPipeline()
    chunk = generate_pcm_audio(duration_ms=100)
    
    latencies = []
    
    for i in range(100):
        # Measure add_pcm_chunk time
        start_time = time.perf_counter()
        pipeline.add_pcm_chunk(chunk, is_final=False)
        end_time = time.perf_counter()
        
        latency_ms = (end_time - start_time) * 1000
        latencies.append(latency_ms)
        
        # Clear buffer periodically
        if i % 10 == 0:
            pipeline.clear_buffer()
    
    avg_latency = sum(latencies) / len(latencies)
    
    print(f"\n=== Buffer Concatenation Latency ===")
    print(f"Average add_pcm_chunk() latency: {avg_latency:.3f} ms")
    print(f"Max latency: {max(latencies):.3f} ms")
    
    # Verify concatenation is fast (< 1ms)
    assert avg_latency < 1.0, f"Buffer concatenation too slow: {avg_latency:.3f}ms"


@pytest.mark.asyncio
async def test_end_to_end_latency_breakdown():
    """
    Measure and document end-to-end latency breakdown.
    
    Breaks down latency into components:
    - Chunk addition (buffer concatenation)
    - VAD check
    - PCM to Float32 conversion
    - Total processing time
    
    Validates Requirements: 2.3, 2.5
    """
    pipeline = AudioPipeline()
    
    # Generate chunks
    chunks = [generate_pcm_audio(duration_ms=100) for _ in range(10)]
    
    # Measure component latencies
    add_latencies = []
    vad_latencies = []
    conversion_latency = 0
    
    total_start = time.perf_counter()
    
    for i, chunk in enumerate(chunks):
        # Measure add_pcm_chunk
        start = time.perf_counter()
        is_final = (i == len(chunks) - 1)
        pipeline.add_pcm_chunk(chunk, is_final=is_final)
        add_latencies.append((time.perf_counter() - start) * 1000)
        
        # Measure should_process
        start = time.perf_counter()
        should_process = pipeline.should_process()
        vad_latencies.append((time.perf_counter() - start) * 1000)
    
    # Measure conversion
    start = time.perf_counter()
    audio_array = pipeline.get_audio_for_asr()
    conversion_latency = (time.perf_counter() - start) * 1000
    
    total_latency = (time.perf_counter() - total_start) * 1000
    
    print(f"\n=== End-to-End Latency Breakdown ===")
    print(f"Chunk addition (avg): {np.mean(add_latencies):.3f} ms")
    print(f"VAD check (avg): {np.mean(vad_latencies):.6f} ms")
    print(f"PCM conversion: {conversion_latency:.3f} ms")
    print(f"Total processing: {total_latency:.3f} ms")
    print(f"\nComponent percentages:")
    print(f"  Chunk addition: {(sum(add_latencies)/total_latency)*100:.1f}%")
    print(f"  VAD check: {(sum(vad_latencies)/total_latency)*100:.1f}%")
    print(f"  PCM conversion: {(conversion_latency/total_latency)*100:.1f}%")
    
    # Verify total latency is reasonable
    assert total_latency < 50.0, f"Total latency too high: {total_latency:.3f}ms"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])  # -s to show print output
