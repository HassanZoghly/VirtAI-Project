import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMicrophoneStream } from './useMicrophoneStream';

/**
 * Unit tests for useMicrophoneStream hook
 * 
 * Tests microphone audio capture lifecycle, error handling,
 * and audio chunk emission.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.2, 13.1, 13.2
 */

describe('useMicrophoneStream', () => {
    let mockMediaStream: MediaStream;
    let mockMediaRecorder: any;
    let getUserMediaSpy: any;
    let consoleLogSpy: any;
    let consoleErrorSpy: any;

    beforeEach(() => {
        // Mock MediaStream
        const trackStopSpy = vi.fn();
        mockMediaStream = {
            getTracks: vi.fn(() => [
                {
                    stop: trackStopSpy,
                    kind: 'audio',
                },
            ]),
            _trackStopSpy: trackStopSpy, // Store reference for testing
        } as any;

        // Mock MediaRecorder
        const eventHandlers: Record<string, any> = {};
        mockMediaRecorder = vi.fn(function (this: any, stream: MediaStream, options: any) {
            this.stream = stream;
            this.options = options;
            this.state = 'inactive';
            this.ondataavailable = null;
            this.onerror = null;
            this._eventHandlers = eventHandlers;

            this.start = vi.fn((timeslice?: number) => {
                this.state = 'recording';
            });

            this.stop = vi.fn(() => {
                this.state = 'inactive';
            });

            return this;
        });

        // Mock MediaRecorder.isTypeSupported
        mockMediaRecorder.isTypeSupported = vi.fn((mimeType: string) => {
            return mimeType === 'audio/webm;codecs=opus';
        });

        global.MediaRecorder = mockMediaRecorder as any;

        // Mock getUserMedia
        getUserMediaSpy = vi.fn(() => Promise.resolve(mockMediaStream));
        global.navigator.mediaDevices = {
            getUserMedia: getUserMediaSpy,
        } as any;

        // Spy on console methods
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Test: Initial state
     * Requirement: 1.6
     */
    it('should initialize with isListening false and no error', () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        expect(result.current.isListening).toBe(false);
        expect(result.current.error).toBeNull();
    });

    /**
     * Test: Start listening successfully
     * Requirements: 1.1, 1.2, 1.3, 1.5, 13.1
     */
    it('should start listening and configure audio correctly', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk, { sampleRate: 16000 }));

        // Act: Start listening
        await act(async () => {
            await result.current.startListening();
        });

        // Assert: getUserMedia called with correct constraints (Requirements 1.1, 1.2)
        expect(getUserMediaSpy).toHaveBeenCalledWith({
            audio: {
                sampleRate: { ideal: 16000 },
                channelCount: { ideal: 1 },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        // Assert: MediaRecorder created with Opus codec (Requirement 13.1)
        expect(mockMediaRecorder).toHaveBeenCalledWith(
            mockMediaStream,
            expect.objectContaining({
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000,
            })
        );

        // Assert: MediaRecorder started with 100ms chunks (Requirement 1.3)
        const recorderInstance = mockMediaRecorder.mock.results[0].value;
        expect(recorderInstance.start).toHaveBeenCalledWith(100);

        // Assert: isListening is true (Requirement 1.5)
        expect(result.current.isListening).toBe(true);
        expect(result.current.error).toBeNull();
    });

    /**
     * Test: Fallback to WebM codec
     * Requirement: 13.2
     */
    it('should fallback to WebM codec when Opus not supported', async () => {
        // Mock Opus not supported
        mockMediaRecorder.isTypeSupported = vi.fn((mimeType: string) => {
            return mimeType === 'audio/webm';
        });

        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        // Assert: MediaRecorder created with WebM fallback (Requirement 13.2)
        expect(mockMediaRecorder).toHaveBeenCalledWith(
            mockMediaStream,
            expect.objectContaining({
                mimeType: 'audio/webm',
            })
        );
    });

    /**
     * Test: Audio chunk emission
     * Requirement: 1.3
     */
    it('should emit audio chunks via callback', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        const recorderInstance = mockMediaRecorder.mock.results[0].value;

        // Simulate audio chunk
        const mockBlob = new Blob(['audio data'], { type: 'audio/webm' });
        const mockEvent = { data: mockBlob };

        act(() => {
            if (recorderInstance.ondataavailable) {
                recorderInstance.ondataavailable(mockEvent);
            }
        });

        // Assert: Callback invoked with audio chunk (Requirement 1.3)
        expect(onAudioChunk).toHaveBeenCalledWith(mockBlob);
    });

    /**
     * Test: Stop listening
     * Requirements: 1.4, 1.6
     */
    it('should stop listening and cleanup resources', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        // Start listening first
        await act(async () => {
            await result.current.startListening();
        });

        expect(result.current.isListening).toBe(true);

        const recorderInstance = mockMediaRecorder.mock.results[0].value;
        const trackStopSpy = (mockMediaStream as any)._trackStopSpy;

        // Act: Stop listening
        act(() => {
            result.current.stopListening();
        });

        // Assert: MediaRecorder stopped (Requirement 1.4)
        expect(recorderInstance.stop).toHaveBeenCalled();

        // Assert: Media tracks stopped (Requirement 1.4)
        expect(trackStopSpy).toHaveBeenCalled();

        // Assert: isListening is false (Requirement 1.6)
        expect(result.current.isListening).toBe(false);
    });

    /**
     * Test: Handle NotAllowedError (permission denied)
     * Requirements: 8.1, 8.2
     */
    it('should handle microphone permission denied error', async () => {
        const permissionError = new Error('Permission denied');
        permissionError.name = 'NotAllowedError';
        getUserMediaSpy.mockRejectedValue(permissionError);

        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        // Act: Try to start listening
        await act(async () => {
            await result.current.startListening();
        });

        // Assert: Error state set with user-friendly message (Requirements 8.1, 8.2)
        expect(result.current.error).toBe(
            'Microphone access denied. Please grant permission in your browser settings.'
        );
        expect(result.current.isListening).toBe(false);
    });

    /**
     * Test: Handle NotFoundError (no microphone)
     * Requirement: 8.2
     */
    it('should handle no microphone found error', async () => {
        const notFoundError = new Error('No microphone');
        notFoundError.name = 'NotFoundError';
        getUserMediaSpy.mockRejectedValue(notFoundError);

        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        // Assert: Error state set with appropriate message
        expect(result.current.error).toBe(
            'No microphone found. Please connect a microphone and try again.'
        );
        expect(result.current.isListening).toBe(false);
    });

    /**
     * Test: Handle NotReadableError (microphone in use)
     * Requirement: 8.2
     */
    it('should handle microphone already in use error', async () => {
        const notReadableError = new Error('Microphone in use');
        notReadableError.name = 'NotReadableError';
        getUserMediaSpy.mockRejectedValue(notReadableError);

        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        // Assert: Error state set with appropriate message
        expect(result.current.error).toBe(
            'Microphone is already in use by another application.'
        );
        expect(result.current.isListening).toBe(false);
    });

    /**
     * Test: Clear error on successful start
     * Requirement: 8.2
     */
    it('should clear previous error on successful start', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        // First attempt fails
        const permissionError = new Error('Permission denied');
        permissionError.name = 'NotAllowedError';
        getUserMediaSpy.mockRejectedValueOnce(permissionError);

        await act(async () => {
            await result.current.startListening();
        });

        expect(result.current.error).not.toBeNull();

        // Second attempt succeeds
        getUserMediaSpy.mockResolvedValue(mockMediaStream);

        await act(async () => {
            await result.current.startListening();
        });

        // Assert: Error cleared
        expect(result.current.error).toBeNull();
        expect(result.current.isListening).toBe(true);
    });

    /**
     * Test: Safe to call stopListening when not listening
     * Requirement: 1.4
     */
    it('should safely handle stopListening when not listening', () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        // Act: Stop without starting
        act(() => {
            result.current.stopListening();
        });

        // Assert: No errors, state remains false
        expect(result.current.isListening).toBe(false);
        expect(result.current.error).toBeNull();
    });

    /**
     * Test: Handle MediaRecorder error
     * Requirement: 8.2
     */
    it('should handle MediaRecorder errors', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        const recorderInstance = mockMediaRecorder.mock.results[0].value;

        // Simulate MediaRecorder error
        act(() => {
            if (recorderInstance.onerror) {
                recorderInstance.onerror(new Event('error'));
            }
        });

        // Assert: Error state set and listening stopped
        expect(result.current.error).toBe('Audio recording error occurred');
        expect(result.current.isListening).toBe(false);
    });

    /**
     * Test: Ignore empty audio chunks
     * Requirement: 1.3
     */
    it('should not emit empty audio chunks', async () => {
        const onAudioChunk = vi.fn();
        const { result } = renderHook(() => useMicrophoneStream(onAudioChunk));

        await act(async () => {
            await result.current.startListening();
        });

        const recorderInstance = mockMediaRecorder.mock.results[0].value;

        // Simulate empty chunk
        const emptyBlob = new Blob([], { type: 'audio/webm' });
        const mockEvent = { data: emptyBlob };

        act(() => {
            if (recorderInstance.ondataavailable) {
                recorderInstance.ondataavailable(mockEvent);
            }
        });

        // Assert: Callback not invoked for empty chunk
        expect(onAudioChunk).not.toHaveBeenCalled();
    });
});
