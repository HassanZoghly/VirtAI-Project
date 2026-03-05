/**
 * Unit tests for Voice Activity Detection (VAD)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceActivityDetector, VADConfig } from './vad';

describe('VoiceActivityDetector', () => {
    let vad: VoiceActivityDetector;
    let config: VADConfig;

    beforeEach(() => {
        config = {
            silenceThreshold: 0.01,
            silenceDuration: 800,
            minSpeechDuration: 300
        };
        vad = new VoiceActivityDetector(config);
    });

    describe('RMS Energy Calculation', () => {
        it('should return 0 for empty audio data', () => {
            const emptyData = new Float32Array(0);
            const result = vad.processAudioChunk(emptyData);
            expect(result.energy).toBe(0.0);
        });

        it('should return 0 for silent audio (all zeros)', () => {
            const silentData = new Float32Array(1000).fill(0);
            const result = vad.processAudioChunk(silentData);
            expect(result.energy).toBe(0.0);
        });

        it('should calculate energy between 0 and 1 for any audio input', () => {
            const audioData = new Float32Array(1000);
            for (let i = 0; i < audioData.length; i++) {
                audioData[i] = Math.random() * 2 - 1; // Random values between -1 and 1
            }
            const result = vad.processAudioChunk(audioData);
            expect(result.energy).toBeGreaterThanOrEqual(0.0);
            expect(result.energy).toBeLessThanOrEqual(1.0);
        });

        it('should calculate higher energy for louder audio', () => {
            const quietData = new Float32Array(1000).fill(0.01);
            const loudData = new Float32Array(1000).fill(0.5);

            const quietResult = vad.processAudioChunk(quietData);
            vad.reset();
            const loudResult = vad.processAudioChunk(loudData);

            expect(loudResult.energy).toBeGreaterThan(quietResult.energy);
        });
    });

    describe('Speech Detection', () => {
        it('should detect speech when energy exceeds threshold', () => {
            // Create audio with energy above threshold (0.01)
            const speechData = new Float32Array(1000).fill(0.1);
            const result = vad.processAudioChunk(speechData);

            expect(result.isSpeech).toBe(true);
            expect(result.energy).toBeGreaterThan(config.silenceThreshold);
        });

        it('should detect silence when energy is below threshold', () => {
            // Create audio with energy below threshold (0.01)
            const silenceData = new Float32Array(1000).fill(0.001);
            const result = vad.processAudioChunk(silenceData);

            expect(result.isSpeech).toBe(false);
            expect(result.energy).toBeLessThan(config.silenceThreshold);
        });

        it('should reset silence timer when speech is detected', () => {
            const speechData = new Float32Array(1000).fill(0.1);

            // First speech chunk
            const result1 = vad.processAudioChunk(speechData);
            expect(result1.silenceDurationMs).toBe(0);

            // Wait a bit and send another speech chunk
            const delay = 100;
            const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            return wait(delay).then(() => {
                const result2 = vad.processAudioChunk(speechData);
                expect(result2.silenceDurationMs).toBe(0);
            });
        });
    });

    describe('Silence Duration Tracking', () => {
        it('should increment silence duration when silence is detected', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // First, detect speech to establish baseline
            vad.processAudioChunk(speechData);

            // Wait and then send silence
            await new Promise(resolve => setTimeout(resolve, 100));
            const result = vad.processAudioChunk(silenceData);

            expect(result.isSpeech).toBe(false);
            expect(result.silenceDurationMs).toBeGreaterThan(0);
        });

        it('should track silence duration across multiple chunks', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Detect speech first
            vad.processAudioChunk(speechData);

            // Send multiple silence chunks with delays
            await new Promise(resolve => setTimeout(resolve, 200));
            const result1 = vad.processAudioChunk(silenceData);

            await new Promise(resolve => setTimeout(resolve, 200));
            const result2 = vad.processAudioChunk(silenceData);

            expect(result2.silenceDurationMs).toBeGreaterThan(result1.silenceDurationMs);
        });
    });

    describe('Finalization Logic', () => {
        it('should not finalize if minimum speech duration not met', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Very short speech (less than minSpeechDuration of 300ms)
            vad.processAudioChunk(speechData);

            // Wait for silence threshold (800ms)
            await new Promise(resolve => setTimeout(resolve, 900));
            const result = vad.processAudioChunk(silenceData);

            // Should not finalize because speech was too short
            expect(result.shouldFinalize).toBe(false);
        });

        it('should finalize when both silence and speech duration thresholds are met', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Speak for longer than minSpeechDuration (300ms)
            vad.processAudioChunk(speechData);
            await new Promise(resolve => setTimeout(resolve, 400));
            vad.processAudioChunk(speechData);

            // Wait for silence threshold (800ms)
            await new Promise(resolve => setTimeout(resolve, 900));
            const result = vad.processAudioChunk(silenceData);

            // Should finalize because both thresholds met
            expect(result.shouldFinalize).toBe(true);
        });

        it('should not finalize during speech', () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const result = vad.processAudioChunk(speechData);

            expect(result.shouldFinalize).toBe(false);
        });

        it('should not finalize if silence duration not met', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Speak for longer than minSpeechDuration
            vad.processAudioChunk(speechData);
            await new Promise(resolve => setTimeout(resolve, 400));
            vad.processAudioChunk(speechData);

            // Short silence (less than 800ms)
            await new Promise(resolve => setTimeout(resolve, 100));
            const result = vad.processAudioChunk(silenceData);

            expect(result.shouldFinalize).toBe(false);
        });
    });

    describe('State Management', () => {
        it('should start in silence state', () => {
            expect(vad.getState()).toBe('silence');
        });

        it('should transition to speech state when speech detected', () => {
            const speechData = new Float32Array(1000).fill(0.1);
            vad.processAudioChunk(speechData);

            expect(vad.getState()).toBe('speech');
        });

        it('should transition to pending state after speech ends', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Detect speech
            vad.processAudioChunk(speechData);
            expect(vad.getState()).toBe('speech');

            // Detect silence
            await new Promise(resolve => setTimeout(resolve, 100));
            vad.processAudioChunk(silenceData);
            expect(vad.getState()).toBe('pending');
        });

        it('should reset to silence state after reset()', () => {
            const speechData = new Float32Array(1000).fill(0.1);

            // Detect speech
            vad.processAudioChunk(speechData);
            expect(vad.getState()).toBe('speech');

            // Reset
            vad.reset();
            expect(vad.getState()).toBe('silence');
        });

        it('should clear timing information after reset()', async () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Detect speech and silence
            vad.processAudioChunk(speechData);
            await new Promise(resolve => setTimeout(resolve, 100));
            vad.processAudioChunk(silenceData);

            // Reset
            vad.reset();

            // Process new audio - should start fresh
            const result = vad.processAudioChunk(speechData);
            expect(result.silenceDurationMs).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle very small audio chunks', () => {
            const tinyData = new Float32Array(1);
            tinyData[0] = 0.5;

            const result = vad.processAudioChunk(tinyData);
            expect(result.energy).toBeGreaterThanOrEqual(0.0);
            expect(result.energy).toBeLessThanOrEqual(1.0);
        });

        it('should handle very large audio chunks', () => {
            const largeData = new Float32Array(100000).fill(0.1);

            const result = vad.processAudioChunk(largeData);
            expect(result.energy).toBeGreaterThanOrEqual(0.0);
            expect(result.energy).toBeLessThanOrEqual(1.0);
        });

        it('should handle audio with extreme values', () => {
            const extremeData = new Float32Array(1000);
            for (let i = 0; i < extremeData.length; i++) {
                extremeData[i] = i % 2 === 0 ? 1.0 : -1.0;
            }

            const result = vad.processAudioChunk(extremeData);
            expect(result.energy).toBeGreaterThanOrEqual(0.0);
            expect(result.energy).toBeLessThanOrEqual(1.0);
        });

        it('should handle rapid speech/silence transitions', () => {
            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Rapid alternation
            vad.processAudioChunk(speechData);
            vad.processAudioChunk(silenceData);
            vad.processAudioChunk(speechData);
            vad.processAudioChunk(silenceData);

            const result = vad.processAudioChunk(speechData);
            expect(result.isSpeech).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should respect custom silence threshold', () => {
            const customConfig: VADConfig = {
                silenceThreshold: 0.5, // Higher threshold
                silenceDuration: 800,
                minSpeechDuration: 300
            };
            const customVad = new VoiceActivityDetector(customConfig);

            // Audio that would be speech with default threshold
            const audioData = new Float32Array(1000).fill(0.1);
            const result = customVad.processAudioChunk(audioData);

            // Should be silence with higher threshold
            expect(result.isSpeech).toBe(false);
        });

        it('should respect custom silence duration', async () => {
            const customConfig: VADConfig = {
                silenceThreshold: 0.01,
                silenceDuration: 100, // Shorter duration
                minSpeechDuration: 50
            };
            const customVad = new VoiceActivityDetector(customConfig);

            const speechData = new Float32Array(1000).fill(0.1);
            const silenceData = new Float32Array(1000).fill(0.001);

            // Short speech
            customVad.processAudioChunk(speechData);
            await new Promise(resolve => setTimeout(resolve, 100));
            customVad.processAudioChunk(speechData);

            // Short silence
            await new Promise(resolve => setTimeout(resolve, 150));
            const result = customVad.processAudioChunk(silenceData);

            // Should finalize with shorter threshold
            expect(result.shouldFinalize).toBe(true);
        });
    });
});

/**
 * Property-Based Tests for Voice Activity Detection
 * 
 * These tests use fast-check to verify universal properties across
 * all possible inputs, ensuring correctness beyond specific examples.
 */

import * as fc from 'fast-check';

describe('VAD Property-Based Tests', () => {
    describe('Property 2: VAD Finalization Correctness', () => {
        /**
         * **Validates: Requirements 2.6, 2.7**
         * 
         * Property: For all audio chunks processed by VAD, shouldFinalize is true
         * if and only if silence duration exceeds configured threshold AND minimum
         * speech duration requirement is met.
         * 
         * Formal Statement: ∀ chunk ∈ AudioChunks: 
         *   VAD.process(chunk).shouldFinalize ⟺ 
         *   (silenceDuration(chunk) ≥ config.silenceDuration ∧ 
         *    totalSpeechDuration ≥ config.minSpeechDuration)
         */
        it('shouldFinalize is true iff silence duration exceeds threshold and min speech duration is met', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate VAD configuration with smaller ranges to avoid timeouts
                    fc.record({
                        silenceThreshold: fc.double({ min: 0.001, max: 0.05 }),
                        silenceDuration: fc.integer({ min: 100, max: 400 }),
                        minSpeechDuration: fc.integer({ min: 50, max: 300 })
                    }),
                    // Generate speech energy level (well above threshold)
                    fc.double({ min: 0.15, max: 1.0 }),
                    // Generate silence energy level (well below threshold)
                    fc.double({ min: 0.0, max: 0.001 }),
                    // Generate speech duration (how long to speak)
                    fc.integer({ min: 0, max: 400 }),
                    // Generate silence duration (how long to be silent)
                    fc.integer({ min: 0, max: 500 }),
                    async (config, speechEnergy, silenceEnergy, speechDuration, silenceDuration) => {
                        const vad = new VoiceActivityDetector(config);

                        // Create speech audio chunk
                        const speechData = new Float32Array(1000).fill(speechEnergy);

                        // Create silence audio chunk
                        const silenceData = new Float32Array(1000).fill(silenceEnergy);

                        // Simulate speech for the specified duration
                        if (speechDuration > 0) {
                            vad.processAudioChunk(speechData);
                            if (speechDuration > 100) {
                                await new Promise(resolve => setTimeout(resolve, speechDuration));
                                vad.processAudioChunk(speechData);
                            }
                        }

                        // Simulate silence for the specified duration
                        if (silenceDuration > 0) {
                            await new Promise(resolve => setTimeout(resolve, silenceDuration));
                        }

                        // Process final silence chunk
                        const result = vad.processAudioChunk(silenceData);

                        // Calculate expected conditions
                        const actualSilenceDuration = result.silenceDurationMs;
                        const silenceThresholdMet = actualSilenceDuration >= config.silenceDuration;
                        const minSpeechMet = speechDuration >= config.minSpeechDuration;

                        // Property: shouldFinalize ⟺ (silence threshold met ∧ min speech met)
                        const expectedFinalize = silenceThresholdMet && minSpeechMet;

                        // Verify the property holds
                        expect(result.shouldFinalize).toBe(expectedFinalize);

                        // Additional invariants
                        if (result.shouldFinalize) {
                            // If finalizing, both conditions must be true
                            expect(actualSilenceDuration).toBeGreaterThanOrEqual(config.silenceDuration);
                            expect(speechDuration).toBeGreaterThanOrEqual(config.minSpeechDuration);
                        }

                        if (!silenceThresholdMet || !minSpeechMet) {
                            // If either condition is false, should not finalize
                            expect(result.shouldFinalize).toBe(false);
                        }
                    }
                ),
                { numRuns: 30, timeout: 20000 } // Run 30 test cases with 20s timeout
            );
        }, 25000); // Vitest timeout

        it('shouldFinalize is false during speech regardless of durations', () => {
            fc.assert(
                fc.property(
                    // Generate VAD configuration (filter out NaN)
                    fc.record({
                        silenceThreshold: fc.double({ min: 0.001, max: 0.05, noNaN: true }),
                        silenceDuration: fc.integer({ min: 100, max: 1000 }),
                        minSpeechDuration: fc.integer({ min: 50, max: 500 })
                    }),
                    // Generate speech energy level (well above threshold to avoid boundary issues, no NaN)
                    fc.double({ min: 0.15, max: 1.0, noNaN: true }),
                    (config, speechEnergy) => {
                        const vad = new VoiceActivityDetector(config);

                        // Create speech audio chunk
                        const speechData = new Float32Array(1000).fill(speechEnergy);

                        // Process speech chunk
                        const result = vad.processAudioChunk(speechData);

                        // Property: shouldFinalize must be false during speech
                        expect(result.shouldFinalize).toBe(false);
                        expect(result.isSpeech).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('shouldFinalize is false if minimum speech duration not met', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate VAD configuration
                    fc.record({
                        silenceThreshold: fc.double({ min: 0.001, max: 0.05 }),
                        silenceDuration: fc.integer({ min: 100, max: 300 }),
                        minSpeechDuration: fc.integer({ min: 200, max: 400 })
                    }),
                    // Generate speech energy level
                    fc.double({ min: 0.15, max: 1.0 }),
                    // Generate silence energy level
                    fc.double({ min: 0.0, max: 0.001 }),
                    // Generate short speech duration (less than min)
                    fc.integer({ min: 0, max: 150 }),
                    async (config, speechEnergy, silenceEnergy, shortSpeechDuration) => {
                        // Ensure speech duration is less than minimum
                        if (shortSpeechDuration >= config.minSpeechDuration) {
                            return; // Skip this test case
                        }

                        const vad = new VoiceActivityDetector(config);

                        const speechData = new Float32Array(1000).fill(speechEnergy);
                        const silenceData = new Float32Array(1000).fill(silenceEnergy);

                        // Very short speech
                        if (shortSpeechDuration > 0) {
                            vad.processAudioChunk(speechData);
                            await new Promise(resolve => setTimeout(resolve, shortSpeechDuration));
                        }

                        // Long silence (exceeds threshold)
                        await new Promise(resolve => setTimeout(resolve, config.silenceDuration + 50));
                        const result = vad.processAudioChunk(silenceData);

                        // Property: should not finalize if min speech duration not met
                        expect(result.shouldFinalize).toBe(false);
                    }
                ),
                { numRuns: 20, timeout: 15000 }
            );
        }, 20000);

        it('shouldFinalize is false if silence duration not met', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate VAD configuration
                    fc.record({
                        silenceThreshold: fc.double({ min: 0.001, max: 0.05 }),
                        silenceDuration: fc.integer({ min: 300, max: 500 }),
                        minSpeechDuration: fc.integer({ min: 100, max: 250 })
                    }),
                    // Generate speech energy level
                    fc.double({ min: 0.15, max: 1.0 }),
                    // Generate silence energy level
                    fc.double({ min: 0.0, max: 0.001 }),
                    // Generate short silence duration (less than threshold)
                    fc.integer({ min: 0, max: 250 }),
                    async (config, speechEnergy, silenceEnergy, shortSilenceDuration) => {
                        // Ensure silence duration is less than threshold
                        if (shortSilenceDuration >= config.silenceDuration) {
                            return; // Skip this test case
                        }

                        const vad = new VoiceActivityDetector(config);

                        const speechData = new Float32Array(1000).fill(speechEnergy);
                        const silenceData = new Float32Array(1000).fill(silenceEnergy);

                        // Long speech (exceeds minimum)
                        vad.processAudioChunk(speechData);
                        await new Promise(resolve => setTimeout(resolve, config.minSpeechDuration + 50));
                        vad.processAudioChunk(speechData);

                        // Short silence (less than threshold)
                        if (shortSilenceDuration > 0) {
                            await new Promise(resolve => setTimeout(resolve, shortSilenceDuration));
                        }
                        const result = vad.processAudioChunk(silenceData);

                        // Property: should not finalize if silence duration not met
                        expect(result.shouldFinalize).toBe(false);
                    }
                ),
                { numRuns: 20, timeout: 15000 }
            );
        }, 20000);
    });

    describe('Property: Energy Bounds', () => {
        /**
         * Property: RMS energy is always between 0.0 and 1.0 for any audio input
         * 
         * This ensures the energy calculation is properly bounded regardless of
         * input audio characteristics.
         */
        it('energy is always between 0.0 and 1.0 for any audio input', () => {
            fc.assert(
                fc.property(
                    // Generate random audio data (filter out NaN and Infinity)
                    fc.float32Array({ minLength: 1, maxLength: 10000 }).filter(arr =>
                        arr.every(val => Number.isFinite(val))
                    ),
                    (audioData) => {
                        const config: VADConfig = {
                            silenceThreshold: 0.01,
                            silenceDuration: 800,
                            minSpeechDuration: 300
                        };
                        const vad = new VoiceActivityDetector(config);

                        const result = vad.processAudioChunk(audioData);

                        // Property: energy must be bounded
                        expect(result.energy).toBeGreaterThanOrEqual(0.0);
                        expect(result.energy).toBeLessThanOrEqual(1.0);
                        expect(Number.isFinite(result.energy)).toBe(true);
                    }
                ),
                { numRuns: 200 }
            );
        });
    });

    describe('Property: State Consistency', () => {
        /**
         * Property: Silence duration is always non-negative
         */
        it('silenceDurationMs is always non-negative', () => {
            fc.assert(
                fc.property(
                    fc.float32Array({ minLength: 100, maxLength: 5000 }),
                    (audioData) => {
                        const config: VADConfig = {
                            silenceThreshold: 0.01,
                            silenceDuration: 800,
                            minSpeechDuration: 300
                        };
                        const vad = new VoiceActivityDetector(config);

                        const result = vad.processAudioChunk(audioData);

                        // Property: silence duration must be non-negative
                        expect(result.silenceDurationMs).toBeGreaterThanOrEqual(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property: Speech resets silence duration to zero
         */
        it('speech detection always resets silence duration to zero', () => {
            fc.assert(
                fc.property(
                    fc.double({ min: 0.1, max: 1.0 }), // Speech energy
                    (speechEnergy) => {
                        const config: VADConfig = {
                            silenceThreshold: 0.01,
                            silenceDuration: 800,
                            minSpeechDuration: 300
                        };
                        const vad = new VoiceActivityDetector(config);

                        const speechData = new Float32Array(1000).fill(speechEnergy);
                        const result = vad.processAudioChunk(speechData);

                        // Property: speech must reset silence duration
                        if (result.isSpeech) {
                            expect(result.silenceDurationMs).toBe(0);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
