/**
 * Property-Based Tests for Voice Activity Detection (VAD)
 * 
 * These tests verify universal properties that should hold for all inputs.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VoiceActivityDetector, VADConfig } from './vad';

describe('VoiceActivityDetector - Property-Based Tests', () => {
    /**
     * Property: VAD energy calculation is always between 0.0 and 1.0 for any audio input
     * 
     * This property ensures that regardless of the input audio data, the calculated
     * RMS energy will always be normalized to the range [0.0, 1.0].
     * 
     * **Validates: Requirements 2.1, 14.3**
     */
    it('Property: Energy is always between 0.0 and 1.0 for any audio input', () => {
        fc.assert(
            fc.property(
                // Generate arbitrary Float32Arrays with various lengths and values
                fc.array(fc.float({ min: -1.0, max: 1.0, noNaN: true }), { minLength: 1, maxLength: 10000 }),
                (audioArray) => {
                    const audioData = new Float32Array(audioArray);
                    const vad = new VoiceActivityDetector({
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    const result = vad.processAudioChunk(audioData);

                    // Energy must be in valid range
                    return result.energy >= 0.0 && result.energy <= 1.0;
                }
            ),
            { numRuns: 1000 }
        );
    });

    /**
     * Property: Speech detection is consistent with threshold
     * 
     * If energy exceeds threshold, isSpeech must be true.
     * If energy is below threshold, isSpeech must be false.
     * 
     * **Validates: Requirements 2.2, 2.3**
     */
    it('Property: Speech detection is consistent with energy threshold', () => {
        fc.assert(
            fc.property(
                fc.array(fc.float({ min: -1.0, max: 1.0, noNaN: true }), { minLength: 1, maxLength: 5000 }),
                fc.float({ min: Math.fround(0.001), max: Math.fround(0.5) }), // Threshold
                (audioArray, threshold) => {
                    const audioData = new Float32Array(audioArray);
                    const vad = new VoiceActivityDetector({
                        silenceThreshold: threshold,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    const result = vad.processAudioChunk(audioData);

                    // Speech detection must be consistent with threshold
                    if (result.energy > threshold) {
                        return result.isSpeech === true;
                    } else {
                        return result.isSpeech === false;
                    }
                }
            ),
            { numRuns: 500 }
        );
    });

    /**
     * Property: Silence duration never decreases during continuous silence
     * 
     * When processing consecutive silence chunks, the silence duration should
     * monotonically increase (never decrease).
     * 
     * **Validates: Requirement 2.5**
     */
    it('Property: Silence duration increases monotonically during silence', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 10 }), // Number of silence chunks
                (numChunks) => {
                    const vad = new VoiceActivityDetector({
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    // First establish speech
                    const speechData = new Float32Array(1000).fill(0.1);
                    vad.processAudioChunk(speechData);

                    // Then process silence chunks
                    const silenceData = new Float32Array(1000).fill(0.001);
                    let previousDuration = 0;

                    for (let i = 0; i < numChunks; i++) {
                        const result = vad.processAudioChunk(silenceData);

                        // Silence duration should never decrease
                        if (result.silenceDurationMs < previousDuration) {
                            return false;
                        }

                        previousDuration = result.silenceDurationMs;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Reset clears all state
     * 
     * After calling reset(), the VAD should behave identically to a newly
     * constructed instance.
     * 
     * **Validates: State management correctness**
     */
    it('Property: Reset returns VAD to initial state', () => {
        fc.assert(
            fc.property(
                fc.array(fc.float({ min: -1.0, max: 1.0, noNaN: true }), { minLength: 100, maxLength: 1000 }),
                (audioArray) => {
                    const config: VADConfig = {
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    };

                    const vad1 = new VoiceActivityDetector(config);
                    const vad2 = new VoiceActivityDetector(config);

                    const audioData = new Float32Array(audioArray);

                    // Process some audio with vad1, then reset
                    vad1.processAudioChunk(audioData);
                    vad1.reset();

                    // Both should now produce identical results
                    const result1 = vad1.processAudioChunk(audioData);
                    const result2 = vad2.processAudioChunk(audioData);

                    return (
                        result1.isSpeech === result2.isSpeech &&
                        Math.abs(result1.energy - result2.energy) < 0.0001 &&
                        vad1.getState() === vad2.getState()
                    );
                }
            ),
            { numRuns: 200 }
        );
    });

    /**
     * Property: shouldFinalize is false during speech
     * 
     * When isSpeech is true, shouldFinalize must always be false.
     * 
     * **Validates: Requirement 2.6**
     */
    it('Property: shouldFinalize is never true during speech', () => {
        fc.assert(
            fc.property(
                fc.array(fc.float({ min: Math.fround(0.1), max: 1.0, noNaN: true }), { minLength: 100, maxLength: 5000 }),
                (audioArray) => {
                    const audioData = new Float32Array(audioArray);
                    const vad = new VoiceActivityDetector({
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    const result = vad.processAudioChunk(audioData);

                    // If speech is detected, should not finalize
                    if (result.isSpeech) {
                        return result.shouldFinalize === false;
                    }

                    return true;
                }
            ),
            { numRuns: 500 }
        );
    });

    /**
     * Property: State transitions are valid
     * 
     * The VAD state should only transition through valid sequences:
     * - silence -> speech -> pending -> silence (after reset)
     * - silence -> speech -> speech (continued speech)
     * - pending -> speech (speech resumed)
     * 
     * **Validates: State consistency**
     */
    it('Property: State transitions follow valid sequences', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.oneof(
                        fc.constant('speech'),
                        fc.constant('silence')
                    ),
                    { minLength: 5, maxLength: 20 }
                ),
                (sequence) => {
                    const vad = new VoiceActivityDetector({
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    let previousState = vad.getState();

                    for (const action of sequence) {
                        const audioData = action === 'speech'
                            ? new Float32Array(1000).fill(0.1)
                            : new Float32Array(1000).fill(0.001);

                        vad.processAudioChunk(audioData);
                        const currentState = vad.getState();

                        // Validate state transition
                        const validTransitions: Record<string, string[]> = {
                            'silence': ['silence', 'speech'],
                            'speech': ['speech', 'pending'],
                            'pending': ['pending', 'speech']
                        };

                        if (!validTransitions[previousState].includes(currentState)) {
                            return false;
                        }

                        previousState = currentState;
                    }

                    return true;
                }
            ),
            { numRuns: 200 }
        );
    });

    /**
     * Property: RMS energy is deterministic
     * 
     * Processing the same audio data multiple times should produce
     * identical energy values.
     * 
     * **Validates: Requirement 2.1**
     */
    it('Property: RMS energy calculation is deterministic', () => {
        fc.assert(
            fc.property(
                fc.array(fc.float({ min: -1.0, max: 1.0, noNaN: true }), { minLength: 100, maxLength: 2000 }),
                (audioArray) => {
                    const audioData = new Float32Array(audioArray);
                    const config: VADConfig = {
                        silenceThreshold: 0.01,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    };

                    const vad1 = new VoiceActivityDetector(config);
                    const vad2 = new VoiceActivityDetector(config);

                    const result1 = vad1.processAudioChunk(audioData);
                    const result2 = vad2.processAudioChunk(audioData);

                    // Energy should be identical (within floating point precision)
                    return Math.abs(result1.energy - result2.energy) < 1e-10;
                }
            ),
            { numRuns: 300 }
        );
    });

    /**
     * Property: Configuration parameters are respected
     * 
     * Different configurations should produce different behavior for the
     * same input when thresholds are crossed.
     * 
     * **Validates: Requirement 20 (Configuration)**
     */
    it('Property: Different thresholds produce different speech detection', () => {
        fc.assert(
            fc.property(
                fc.array(fc.float({ min: Math.fround(0.01), max: Math.fround(0.1), noNaN: true }), { minLength: 100, maxLength: 1000 }),
                (audioArray) => {
                    const audioData = new Float32Array(audioArray);

                    const lowThresholdVad = new VoiceActivityDetector({
                        silenceThreshold: 0.001,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    const highThresholdVad = new VoiceActivityDetector({
                        silenceThreshold: 0.5,
                        silenceDuration: 800,
                        minSpeechDuration: 300
                    });

                    const lowResult = lowThresholdVad.processAudioChunk(audioData);
                    const highResult = highThresholdVad.processAudioChunk(audioData);

                    // With different thresholds, we should get different results
                    // for audio in the middle range
                    if (lowResult.energy > 0.001 && lowResult.energy < 0.5) {
                        return lowResult.isSpeech !== highResult.isSpeech;
                    }

                    return true;
                }
            ),
            { numRuns: 200 }
        );
    });
});
