/**
 * Unit tests for CircularAudioBuffer
 * 
 * Tests the circular buffer implementation for audio chunk storage
 * with minimal memory allocations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircularAudioBuffer } from './circularBuffer';

describe('CircularAudioBuffer', () => {
    let buffer: CircularAudioBuffer;

    beforeEach(() => {
        buffer = new CircularAudioBuffer(5, 100); // Small capacity for testing
    });

    describe('Basic Operations', () => {
        it('should initialize with correct capacity', () => {
            expect(buffer.getCapacity()).toBe(5);
            expect(buffer.getSize()).toBe(0);
            expect(buffer.isEmpty()).toBe(true);
            expect(buffer.isFull()).toBe(false);
        });

        it('should write and read a single chunk', () => {
            const audioData = new Float32Array([0.1, 0.2, 0.3]);
            const timestamp = Date.now();

            const success = buffer.write(audioData, timestamp, false);
            expect(success).toBe(true);
            expect(buffer.getSize()).toBe(1);
            expect(buffer.isEmpty()).toBe(false);

            const chunk = buffer.read();
            expect(chunk).not.toBeNull();
            expect(chunk!.data.length).toBe(audioData.length);
            expect(chunk!.timestamp).toBe(timestamp);
            expect(chunk!.isFinal).toBe(false);
            expect(buffer.getSize()).toBe(0);
            expect(buffer.isEmpty()).toBe(true);
        });

        it('should write multiple chunks', () => {
            for (let i = 0; i < 3; i++) {
                const audioData = new Float32Array([i, i + 0.1, i + 0.2]);
                buffer.write(audioData, Date.now() + i, false);
            }

            expect(buffer.getSize()).toBe(3);
            expect(buffer.isEmpty()).toBe(false);
            expect(buffer.isFull()).toBe(false);
        });

        it('should read chunks in FIFO order', () => {
            const chunks = [
                new Float32Array([1, 2, 3]),
                new Float32Array([4, 5, 6]),
                new Float32Array([7, 8, 9]),
            ];

            chunks.forEach((data, i) => {
                buffer.write(data, i, false);
            });

            for (let i = 0; i < chunks.length; i++) {
                const chunk = buffer.read();
                expect(chunk).not.toBeNull();
                expect(chunk!.timestamp).toBe(i);
                expect(chunk!.data[0]).toBe(chunks[i][0]);
            }

            expect(buffer.isEmpty()).toBe(true);
        });
    });

    describe('Circular Behavior', () => {
        it('should overwrite oldest chunk when full', () => {
            // Fill buffer to capacity
            for (let i = 0; i < 5; i++) {
                const audioData = new Float32Array([i]);
                buffer.write(audioData, i, false);
            }

            expect(buffer.isFull()).toBe(true);
            expect(buffer.getSize()).toBe(5);

            // Write one more chunk (should overwrite oldest)
            const newData = new Float32Array([99]);
            buffer.write(newData, 99, false);

            expect(buffer.getSize()).toBe(5); // Still at capacity
            expect(buffer.isFull()).toBe(true);

            // First chunk should be the second one we wrote (index 1)
            const firstChunk = buffer.read();
            expect(firstChunk!.timestamp).toBe(1);
        });

        it('should handle wrap-around correctly', () => {
            // Fill buffer
            for (let i = 0; i < 5; i++) {
                buffer.write(new Float32Array([i]), i, false);
            }

            // Read 3 chunks
            buffer.read();
            buffer.read();
            buffer.read();

            expect(buffer.getSize()).toBe(2);

            // Write 3 more chunks (should wrap around)
            for (let i = 5; i < 8; i++) {
                buffer.write(new Float32Array([i]), i, false);
            }

            expect(buffer.getSize()).toBe(5);

            // Read all and verify order
            const timestamps = [];
            while (!buffer.isEmpty()) {
                const chunk = buffer.read();
                timestamps.push(chunk!.timestamp);
            }

            expect(timestamps).toEqual([3, 4, 5, 6, 7]);
        });
    });

    describe('Peek Operations', () => {
        it('should peek without removing chunk', () => {
            const audioData = new Float32Array([1, 2, 3]);
            buffer.write(audioData, 100, false);

            const peeked = buffer.peek();
            expect(peeked).not.toBeNull();
            expect(peeked!.timestamp).toBe(100);
            expect(buffer.getSize()).toBe(1); // Size unchanged

            const read = buffer.read();
            expect(read!.timestamp).toBe(100);
            expect(buffer.getSize()).toBe(0);
        });

        it('should peek all chunks in order', () => {
            for (let i = 0; i < 3; i++) {
                buffer.write(new Float32Array([i]), i, false);
            }

            const allChunks = buffer.peekAll();
            expect(allChunks.length).toBe(3);
            expect(allChunks[0].timestamp).toBe(0);
            expect(allChunks[1].timestamp).toBe(1);
            expect(allChunks[2].timestamp).toBe(2);
            expect(buffer.getSize()).toBe(3); // Size unchanged
        });

        it('should return null when peeking empty buffer', () => {
            expect(buffer.peek()).toBeNull();
            expect(buffer.peekAll()).toEqual([]);
        });
    });

    describe('Clear Operation', () => {
        it('should clear all chunks', () => {
            for (let i = 0; i < 3; i++) {
                buffer.write(new Float32Array([i]), i, false);
            }

            expect(buffer.getSize()).toBe(3);

            buffer.clear();

            expect(buffer.getSize()).toBe(0);
            expect(buffer.isEmpty()).toBe(true);
            expect(buffer.read()).toBeNull();
        });

        it('should allow writing after clear', () => {
            buffer.write(new Float32Array([1]), 1, false);
            buffer.clear();

            const success = buffer.write(new Float32Array([2]), 2, false);
            expect(success).toBe(true);
            expect(buffer.getSize()).toBe(1);

            const chunk = buffer.read();
            expect(chunk!.timestamp).toBe(2);
        });
    });

    describe('Size Limits', () => {
        it('should reject chunks larger than maxChunkSize', () => {
            const largeData = new Float32Array(200); // Exceeds maxChunkSize of 100
            const success = buffer.write(largeData, Date.now(), false);

            expect(success).toBe(false);
            expect(buffer.getSize()).toBe(0);
        });

        it('should accept chunks at maxChunkSize', () => {
            const maxData = new Float32Array(100); // Exactly maxChunkSize
            const success = buffer.write(maxData, Date.now(), false);

            expect(success).toBe(true);
            expect(buffer.getSize()).toBe(1);
        });
    });

    describe('Final Flag', () => {
        it('should preserve isFinal flag', () => {
            buffer.write(new Float32Array([1]), 1, false);
            buffer.write(new Float32Array([2]), 2, true);

            const chunk1 = buffer.read();
            expect(chunk1!.isFinal).toBe(false);

            const chunk2 = buffer.read();
            expect(chunk2!.isFinal).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty audio data', () => {
            const emptyData = new Float32Array(0);
            const success = buffer.write(emptyData, Date.now(), false);

            expect(success).toBe(true);
            expect(buffer.getSize()).toBe(1);

            const chunk = buffer.read();
            expect(chunk!.data.length).toBe(0);
        });

        it('should handle reading from empty buffer', () => {
            expect(buffer.read()).toBeNull();
            expect(buffer.read()).toBeNull(); // Multiple reads
        });

        it('should handle capacity of 1', () => {
            const smallBuffer = new CircularAudioBuffer(1, 100);

            smallBuffer.write(new Float32Array([1]), 1, false);
            expect(smallBuffer.isFull()).toBe(true);

            smallBuffer.write(new Float32Array([2]), 2, false);
            expect(smallBuffer.getSize()).toBe(1);

            const chunk = smallBuffer.read();
            expect(chunk!.timestamp).toBe(2); // Should have overwritten first
        });
    });
});
