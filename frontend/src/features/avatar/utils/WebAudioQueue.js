/**
 * WebAudioQueue — Deterministic gapless audio playback via Web Audio API.
 * AAA Polish: Transient-aware DSP Overlap-Add, Adaptive Streaming Reservoir, and Starvation Prediction.
 */
export class WebAudioQueue {
  constructor() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;
    this.analyser.connect(this.ctx.destination);

    // --- Timeline state ---
    this._sourceNodes = new Set();
    this._nextScheduledEnd = 0;
    this._responseStartTime = 0;
    this._isPlaying = false;

    // --- Chunk awareness & Adaptive Reservoir ---
    this._pendingChunkCount = 0;
    this._totalBuffersQueued = 0;
    
    // Adaptive Starvation Detection
    this._lastChunkArrivalTime = 0;
    this._arrivalJitterSum = 0;
    this._jitterSamples = 0;
    this.baseStarvationThreshold = 0.15; // 150ms
    
    // Starvation state
    this._isStarving = false;

    // --- Callbacks ---
    this.onPlay = null;   
    this.onEnded = null;  
    this.onStarvationImminent = null; // () => void
  }

  async decode(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  get currentTime() {
    if (!this._isPlaying || this._responseStartTime === 0) return 0;
    return Math.max(0, this.ctx.currentTime - this._responseStartTime);
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get bufferLeadTimeSeconds() {
    if (!this._isPlaying) return 0;
    return Math.max(0, this._nextScheduledEnd - this.ctx.currentTime);
  }

  get queueDepth() {
    return this._sourceNodes.size + this._pendingChunkCount;
  }

  /**
   * Calculates dynamic safety buffering threshold based on network jitter.
   */
  get adaptiveStarvationThreshold() {
    if (this._jitterSamples < 3) return this.baseStarvationThreshold;
    const avgJitter = this._arrivalJitterSum / this._jitterSamples;
    return Math.max(this.baseStarvationThreshold, avgJitter * 1.5);
  }

  setPendingChunkCount(count) {
    this._pendingChunkCount = Math.max(0, count);

    if (this._pendingChunkCount === 0 && this._isPlaying && this._sourceNodes.size === 0) {
       this._checkEnd();
    }
  }

  _detectTransient(audioBuffer) {
    // Analyze first 5ms for high energy (consonant attack)
    const channelData = audioBuffer.getChannelData(0);
    const samplesToCheck = Math.min(channelData.length, Math.floor(audioBuffer.sampleRate * 0.005));
    let energy = 0;
    for (let i = 0; i < samplesToCheck; i++) {
      energy += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(energy / samplesToCheck);
    return rms > 0.08; // High transient threshold
  }

  queueBuffer(audioBuffer) {
    if (!audioBuffer) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Adaptive Reservoir metrics
    const nowReal = performance.now();
    if (this._lastChunkArrivalTime > 0) {
       const gap = (nowReal - this._lastChunkArrivalTime) / 1000;
       // Only count jitter if we're not starting a brand new response
       if (this._isPlaying && this._totalBuffersQueued > 0) {
           this._arrivalJitterSum += gap;
           this._jitterSamples++;
       }
    }
    this._lastChunkArrivalTime = nowReal;

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    
    // DSP Crossfade: Transient-Aware Overlap-Add
    // We use a GainNode per source to control the envelope
    const gainNode = this.ctx.createGain();
    source.connect(gainNode);
    gainNode.connect(this.analyser);

    const now = this.ctx.currentTime;
    
    // Reset starvation flag since we got new data
    this._isStarving = false;

    let startAt;
    let fadeDuration = 0.01; // Default 10ms overlap
    const isTransient = this._detectTransient(audioBuffer);
    
    if (isTransient) {
       fadeDuration = 0.002; // 2ms quick fade for consonants
    }

    if (!this._isPlaying || this._nextScheduledEnd <= now) {
      // First buffer or resuming after full starvation drain
      startAt = now;
      this._responseStartTime = now;
      this._isPlaying = true;
      this._totalBuffersQueued = 0;
      this._arrivalJitterSum = 0;
      this._jitterSamples = 0;
      
      // Fast fade in for the very first chunk
      gainNode.gain.setValueAtTime(0.001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(1.0, startAt + 0.005);
      
      if (this.onPlay) this.onPlay();
    } else {
      // Append with overlap-add
      startAt = this._nextScheduledEnd - fadeDuration;
      
      // Fade in this new buffer
      gainNode.gain.setValueAtTime(0.001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(1.0, startAt + fadeDuration);
    }

    source.start(startAt);
    this._totalBuffersQueued++;
    
    // Advance timeline (accounting for overlap)
    this._nextScheduledEnd = startAt + audioBuffer.duration;
    
    // Set fade out at the end of THIS buffer so it crossfades with the next one
    gainNode.gain.setValueAtTime(1.0, this._nextScheduledEnd - fadeDuration);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this._nextScheduledEnd);

    this._sourceNodes.add(source);

    source.onended = () => {
      this._sourceNodes.delete(source);
      try { 
        source.disconnect(); 
        gainNode.disconnect();
      } catch (_) { /* ignore */ }
      
      this._checkEnd();
    };
  }

  /**
   * Run every frame (from useFrame) to predict starvation and emit events
   * synchronized to the AudioContext timeline. No setTimeouts.
   */
  updateDiagnostics() {
    if (!this._isPlaying) return;

    // 1. Check end state synchronously based on exact timeline
    if (this._sourceNodes.size === 0 && this.ctx.currentTime >= this._nextScheduledEnd) {
       this._checkEnd();
    }

    // 2. Starvation Prediction
    const leadTime = this.bufferLeadTimeSeconds;
    if (this._pendingChunkCount > 0 && leadTime > 0 && leadTime < this.adaptiveStarvationThreshold) {
       if (!this._isStarving) {
           this._isStarving = true;
           if (this.onStarvationImminent) this.onStarvationImminent();
       }
    }
  }

  getPlaybackState() {
     return {
         currentTime: this.currentTime,
         isPlaying: this.isPlaying,
         isStarving: this._isStarving,
         leadTime: this.bufferLeadTimeSeconds,
         queueDepth: this.queueDepth
     };
  }

  _checkEnd() {
    if (!this._isPlaying) return;
    if (this._pendingChunkCount > 0) return;
    
    // Timeline is authoritative
    if (this._sourceNodes.size === 0 && this.ctx.currentTime >= this._nextScheduledEnd - 0.005) {
      this._confirmEnd();
    }
  }

  _confirmEnd() {
    this._isPlaying = false;
    this._nextScheduledEnd = 0;
    this._responseStartTime = 0;
    this._totalBuffersQueued = 0;
    this._isStarving = false;
    if (this.onEnded) this.onEnded();
  }

  stop() {
    for (const source of this._sourceNodes) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch (_) {}
    }
    this._sourceNodes.clear();
    this._isPlaying = false;
    this._nextScheduledEnd = 0;
    this._responseStartTime = 0;
    this._pendingChunkCount = 0;
    this._totalBuffersQueued = 0;
    this._isStarving = false;
  }

  dispose() {
    this.stop();
    try { this.analyser.disconnect(); } catch (_) {}
    this.ctx.close().catch(() => {});
  }
}
