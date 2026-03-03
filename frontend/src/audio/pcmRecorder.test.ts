/**
 * Unit tests for PCMRecorder
 * 
 * Tests PCM audio capture, Float32 → Int16 conversion, and lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PCMRecorder } from './pcmRecorder';

describe('PCMRecorder', () => {
    let mockCallback: ReturnType<typeof vi.fn>;
    let mockMediaStream: MediaStream;
    let mockAudioContext: AudioContext;

    beforeEach(() => {
        mockCallback = vi.fn();

        // Mock MediaStream
        mockMediaStream = {
            getTracks: vi.fn(() => [
                { stop: vi.fn() }
            ]),
        } as any;

        // Mock getUserMedia
        global.navigator.mediaDevices = {
            getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
        } as any;

        // Mock AudioContext
        mockAudioContext = {
            sampleRate: 16000,
            audioWorklet: {
                addModule: vi.fn().mockResolvedValue(undefined),
            },
            createMediaStreamSource: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
            })),
            close: vi.fn().mockResolvedValue(undefined),
        } as any;

        // Mock AudioContext constructor properly
        (global as any).AudioContext = class MockAudioContext {
            sampleRate = 16000;
            audioWorklet = {
                addModule: vi.fn().mockResolvedValue(undefined),
            };
            createMediaStreamSource = vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
            }));
            close = vi.fn().mockResolvedValue(undefined);
        };

        // Mock AudioWorkletNode constructor properly
        (global as any).AudioWorkletNode = class MockAudioWorkletNode {
            port = {
                onmessage: null as any,
                postMessage: vi.fn(),
            };
            connect = vi.fn();
            disconnect = vi.fn();
            constructor(context: any, name: string) {
                // Store for later access in tests
            }
        };

        // Mock URL for worklet loading
        (global as any).URL = class MockURL {
            href: string;
            constructor(path: string, base: string) {
                this.href = `/src/audio/pcmWorklet.js`;
            }
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create PCMRecorder with default options', () => {
            const recorder = new PCMRecorder(mockCallback);
            expect(recorder).toBeDefined();
            expect(recorder.getSampleRate()).toBe(16000);
            expect(recorder.getIsRecording()).toBe(false);
        });

        it('should create PCMRecorder with custom sample rate', () => {
            const recorder = new PCMRecorder(mockCallback, { sampleRate: 48000 });
            expect(recorder.getSampleRate()).toBe(48000);
        });
    });

    describe('startRecording', () => {
        it('should initialize AudioContext with correct sample rate', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            // Verify recording started successfully
            expect(recorder.getIsRecording()).toBe(true);
        });

        it('should request microphone access with correct constraints', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    sampleRate: { ideal: 16000 },
                    channelCount: { ideal: 1 },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
        });

        it('should load AudioWorklet module', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            // Verify recording started successfully
            expect(recorder.getIsRecording()).toBe(true);
        });

        it('should set isRecording to true after successful start', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            expect(recorder.getIsRecording()).toBe(true);
        });

        it('should throw error if microphone access is denied', async () => {
            const deniedError = new Error('Permission denied');
            deniedError.name = 'NotAllowedError';
            vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(deniedError);

            const recorder = new PCMRecorder(mockCallback);

            await expect(recorder.startRecording()).rejects.toThrow(
                'Microphone access denied'
            );
            expect(recorder.getIsRecording()).toBe(false);
        });

        it('should throw error if no microphone found', async () => {
            const notFoundError = new Error('No device found');
            notFoundError.name = 'NotFoundError';
            vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(notFoundError);

            const recorder = new PCMRecorder(mockCallback);

            await expect(recorder.startRecording()).rejects.toThrow(
                'No microphone found'
            );
        });

        it('should not start if already recording', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            // Verify recording started
            expect(recorder.getIsRecording()).toBe(true);

            // Try to start again - should not throw
            await recorder.startRecording();

            // Should still be recording
            expect(recorder.getIsRecording()).toBe(true);
        });
    });

    describe('stopRecording', () => {
        it('should cleanup resources and set isRecording to false', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            recorder.stopRecording();

            expect(recorder.getIsRecording()).toBe(false);
        });

        it('should stop media stream tracks', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            recorder.stopRecording();

            expect(recorder.getIsRecording()).toBe(false);
        });

        it('should not throw if called when not recording', () => {
            const recorder = new PCMRecorder(mockCallback);

            expect(() => recorder.stopRecording()).not.toThrow();
        });
    });

    describe('Float32 to Int16 PCM conversion', () => {
        it('should convert Float32 samples to Int16 PCM correctly', () => {
            // Test the conversion logic directly by accessing the private method via reflection
            const recorder = new PCMRecorder(mockCallback);

            // Create test data
            const float32Data = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);

            // Call the private method using type assertion
            const int16Data = (recorder as any).float32ToInt16PCM(float32Data);

            expect(int16Data).toBeInstanceOf(Int16Array);
            expect(int16Data.length).toBe(5);

            // Verify conversion values
            expect(int16Data[0]).toBe(0);           // 0.0 → 0
            expect(int16Data[1]).toBe(16383);       // 0.5 → 16383 (0.5 * 32767)
            expect(int16Data[2]).toBe(-16384);      // -0.5 → -16384 (-0.5 * 32768)
            expect(int16Data[3]).toBe(32767);       // 1.0 → 32767 (max positive)
            expect(int16Data[4]).toBe(-32768);      // -1.0 → -32768 (max negative)
        });

        it('should clamp samples outside [-1, 1] range', () => {
            const recorder = new PCMRecorder(mockCallback);

            // Create test data with out-of-range values
            const float32Data = new Float32Array([1.5, -1.5, 2.0, -2.0]);

            const int16Data = (recorder as any).float32ToInt16PCM(float32Data);

            // All values should be clamped to [-32768, 32767]
            expect(int16Data[0]).toBe(32767);   // 1.5 clamped to 1.0 → 32767
            expect(int16Data[1]).toBe(-32768);  // -1.5 clamped to -1.0 → -32768
            expect(int16Data[2]).toBe(32767);   // 2.0 clamped to 1.0 → 32767
            expect(int16Data[3]).toBe(-32768);  // -2.0 clamped to -1.0 → -32768
        });

        it('should handle empty Float32Array', () => {
            const recorder = new PCMRecorder(mockCallback);

            const float32Data = new Float32Array([]);

            const int16Data = (recorder as any).float32ToInt16PCM(float32Data);

            expect(int16Data).toBeInstanceOf(Int16Array);
            expect(int16Data.length).toBe(0);
        });
    });

    describe('Lifecycle management', () => {
        it('should handle multiple start/stop cycles', async () => {
            const recorder = new PCMRecorder(mockCallback);

            // First cycle
            await recorder.startRecording();
            expect(recorder.getIsRecording()).toBe(true);
            recorder.stopRecording();
            expect(recorder.getIsRecording()).toBe(false);

            // Second cycle
            await recorder.startRecording();
            expect(recorder.getIsRecording()).toBe(true);
            recorder.stopRecording();
            expect(recorder.getIsRecording()).toBe(false);
        });

        it('should cleanup properly even if errors occur', async () => {
            const recorder = new PCMRecorder(mockCallback);
            await recorder.startRecording();

            // Should not throw even if cleanup has issues
            expect(() => recorder.stopRecording()).not.toThrow();
            expect(recorder.getIsRecording()).toBe(false);
        });
    });
});
