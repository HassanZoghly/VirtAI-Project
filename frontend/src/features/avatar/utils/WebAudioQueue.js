export class WebAudioQueue {
  constructor() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();
    
    // Resume context if suspended (common in browsers)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;
    this.analyser.connect(this.ctx.destination);

    this.sourceNodes = new Set();
    this.queue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
    this.firstChunkStartTime = 0; // For global time tracking

    this.onPlay = null;
    this.onEnded = null;
    this.onError = null;
  }

  async decode(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  get currentTime() {
    if (!this.isPlaying || this.firstChunkStartTime === 0) return 0;
    // Return relative time since the first chunk started playing
    return Math.max(0, this.ctx.currentTime - this.firstChunkStartTime);
  }

  playBuffer(audioBuffer, delayMs = 0) {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyser);

    // If queue was empty/not playing, start immediately (with optional delay)
    const now = this.ctx.currentTime;
    if (!this.isPlaying || this.nextStartTime <= now) {
      this.nextStartTime = now + (delayMs / 1000);
      this.firstChunkStartTime = this.nextStartTime;
      this.isPlaying = true;
      if (this.onPlay) this.onPlay();
    }

    source.start(this.nextStartTime);
    
    // Advance next start time by exact buffer duration (Zero-gap chunk stitching)
    this.nextStartTime += audioBuffer.duration;
    
    this.sourceNodes.add(source);

    source.onended = () => {
      this.sourceNodes.delete(source);
      source.disconnect();
      // If no more sources are scheduled or playing, we've ended
      if (this.sourceNodes.size === 0 && this.ctx.currentTime >= this.nextStartTime) {
        this.isPlaying = false;
        this.nextStartTime = 0;
        this.firstChunkStartTime = 0;
        if (this.onEnded) this.onEnded();
      }
    };

    return source;
  }

  stop() {
    for (const source of this.sourceNodes) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch (e) {
        // ignore
      }
    }
    this.sourceNodes.clear();
    this.isPlaying = false;
    this.nextStartTime = 0;
    this.firstChunkStartTime = 0;
  }

  dispose() {
    this.stop();
    this.analyser.disconnect();
    this.ctx.close();
  }
}
