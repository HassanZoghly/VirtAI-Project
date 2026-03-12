/**
 * AudioWorkletProcessor for low-latency PCM audio capture
 *
 * Runs on the audio rendering thread to capture microphone input
 * and send Float32Array chunks to the main thread for PCM conversion.
 *
 * Requirements: 2.1 - Capture raw PCM audio using AudioWorklet
 */
class PCMWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Target chunk size: 20-40ms at 16kHz = 320-640 samples
        // Using 30ms (480 samples) as a good balance
        this.targetChunkSize = 480;

        // Accumulation buffer for samples
        this.buffer = [];
    }

    /**
     * Process audio samples from microphone input
     *
     * Called by the audio system for each render quantum (128 samples at any sample rate).
     * Accumulates samples until target chunk size is reached, then sends to main thread.
     *
     * @param {Float32Array[][]} inputs - Input audio data [input][channel][sample]
     * @param {Float32Array[][]} _outputs - Output audio data (unused)
     * @param {Object} _parameters - Audio parameters (unused)
     * @returns {boolean} - true to keep processor alive
     */
    process(inputs, _outputs, _parameters) {
        // Get first input (microphone)
        const input = inputs[0];

        // If no input or no channels, skip this quantum
        if (!input || input.length === 0) {
            return true;
        }

        // Get first channel (mono audio)
        const channelData = input[0];

        // Accumulate samples
        for (let i = 0; i < channelData.length; i++) {
            this.buffer.push(channelData[i]);
        }

        // Send chunk when target size reached
        if (this.buffer.length >= this.targetChunkSize) {
            // Create Float32Array from accumulated samples
            const chunk = new Float32Array(this.buffer);

            // Send to main thread
            this.port.postMessage(chunk);

            // Clear buffer
            this.buffer = [];
        }

        // Keep processor alive
        return true;
    }
}

// Register the processor
registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
