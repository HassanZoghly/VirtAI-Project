/**
 * Circular Buffer for Audio Chunks
 * 
 * Implements a fixed-size circular buffer to minimize memory allocations
 * during continuous audio processing. Reuses buffer slots instead of
 * creating new arrays.
 * 
 * Requirements: 14.1, 14.2
 */

/**
 * Audio chunk stored in circular buffer
 */
export interface AudioChunk {
    data: Float32Array;
    timestamp: number;
    isFinal: boolean;
}

/**
 * Internal buffer slot with actual data length tracking
 */
interface BufferSlot {
    data: Float32Array;
    dataLength: number;
    timestamp: number;
    isFinal: boolean;
}

/**
 * Circular buffer for efficient audio chunk storage
 * 
 * Uses a fixed-size ring buffer to avoid repeated allocations.
 * When the buffer is full, oldest chunks are overwritten.
 */
export class CircularAudioBuffer {
    private buffer: BufferSlot[];
    private writeIndex: number;
    private readIndex: number;
    private size: number;
    private capacity: number;
    private maxChunkSize: number;

    /**
     * Create a new circular audio buffer
     * 
     * @param capacity - Maximum number of chunks to store
     * @param maxChunkSize - Maximum size of each audio chunk (samples)
     */
    constructor(capacity: number = 100, maxChunkSize: number = 16000) {
        this.capacity = capacity;
        this.maxChunkSize = maxChunkSize;
        this.buffer = new Array(capacity);
        this.writeIndex = 0;
        this.readIndex = 0;
        this.size = 0;

        // Pre-allocate buffer slots to avoid allocations during runtime
        for (let i = 0; i < capacity; i++) {
            this.buffer[i] = {
                data: new Float32Array(maxChunkSize),
                dataLength: 0,
                timestamp: 0,
                isFinal: false,
            };
        }
    }

    /**
     * Add an audio chunk to the buffer
     * 
     * Copies the audio data into a pre-allocated buffer slot.
     * If the buffer is full, overwrites the oldest chunk.
     * 
     * @param audioData - Audio samples to store
     * @param timestamp - Timestamp of the chunk
     * @param isFinal - Whether this is the final chunk
     * @returns True if chunk was added, false if data is too large
     */
    write(audioData: Float32Array, timestamp: number, isFinal: boolean = false): boolean {
        // Check if chunk fits in pre-allocated buffer
        if (audioData.length > this.maxChunkSize) {
            console.warn(`[CircularBuffer] Chunk size ${audioData.length} exceeds max ${this.maxChunkSize}`);
            return false;
        }

        // Get the current write slot
        const slot = this.buffer[this.writeIndex];

        // Copy audio data into pre-allocated buffer (avoid allocation)
        slot.data.set(audioData);
        slot.dataLength = audioData.length;
        slot.timestamp = timestamp;
        slot.isFinal = isFinal;

        // Advance write index (circular)
        this.writeIndex = (this.writeIndex + 1) % this.capacity;

        // Update size (capped at capacity)
        if (this.size < this.capacity) {
            this.size++;
        } else {
            // Buffer is full, advance read index to overwrite oldest
            this.readIndex = (this.readIndex + 1) % this.capacity;
        }

        return true;
    }

    /**
     * Read the next audio chunk from the buffer
     * 
     * @returns Audio chunk or null if buffer is empty
     */
    read(): AudioChunk | null {
        if (this.size === 0) {
            return null;
        }

        const slot = this.buffer[this.readIndex];

        // Create a copy to return (slice to actual data length)
        const chunk: AudioChunk = {
            data: slot.data.slice(0, slot.dataLength),
            timestamp: slot.timestamp,
            isFinal: slot.isFinal,
        };

        // Advance read index
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.size--;

        return chunk;
    }

    /**
     * Peek at the next chunk without removing it
     * 
     * @returns Audio chunk or null if buffer is empty
     */
    peek(): AudioChunk | null {
        if (this.size === 0) {
            return null;
        }

        const slot = this.buffer[this.readIndex];
        return {
            data: slot.data.slice(0, slot.dataLength),
            timestamp: slot.timestamp,
            isFinal: slot.isFinal,
        };
    }

    /**
     * Get all chunks in the buffer without removing them
     * 
     * @returns Array of audio chunks in order
     */
    peekAll(): AudioChunk[] {
        const chunks: AudioChunk[] = [];
        let index = this.readIndex;

        for (let i = 0; i < this.size; i++) {
            const slot = this.buffer[index];
            chunks.push({
                data: slot.data.slice(0, slot.dataLength),
                timestamp: slot.timestamp,
                isFinal: slot.isFinal,
            });
            index = (index + 1) % this.capacity;
        }

        return chunks;
    }

    /**
     * Clear all chunks from the buffer
     */
    clear(): void {
        this.readIndex = 0;
        this.writeIndex = 0;
        this.size = 0;
    }

    /**
     * Get the number of chunks currently in the buffer
     */
    getSize(): number {
        return this.size;
    }

    /**
     * Check if the buffer is empty
     */
    isEmpty(): boolean {
        return this.size === 0;
    }

    /**
     * Check if the buffer is full
     */
    isFull(): boolean {
        return this.size === this.capacity;
    }

    /**
     * Get the buffer capacity
     */
    getCapacity(): number {
        return this.capacity;
    }
}
