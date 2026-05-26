import * as THREE from 'three';

const STATES = {
  IDLE:           'IDLE',
  LISTENING:      'LISTENING',
  THINKING:       'THINKING',
  PRE_SPEECH:     'PRE_SPEECH',
  SPEAKING:       'SPEAKING',
  MICRO_PAUSE:    'MICRO_PAUSE',
  POST_SPEECH_DECAY: 'POST_SPEECH_DECAY',
  SETTLING:       'SETTLING',
  STILL_IDLE:     'STILL_IDLE',
  WAITING:        'WAITING' // For starvation/network latency
};

export const INTENTS = {
  NEUTRAL: 'NEUTRAL',
  CONFIDENT: 'CONFIDENT',
  UNCERTAIN: 'UNCERTAIN',
  LISTENING: 'LISTENING',
};

export { STATES as CONVERSATION_STATES };

export class ConversationalStateMachine {
  constructor() {
    this._state = STATES.IDLE;
    this._intent = INTENTS.NEUTRAL;
    
    this._stateTime = 0;
    
    // Continuous blending weights for procedural layers [0..1]
    this.weights = {
      idle: 1.0,
      listening: 0.0,
      thinking: 0.0,
      speaking: 0.0,
      waiting: 0.0
    };

    this._pendingAudioChunks = 0;
    this._onStateChange = null;
  }

  get state() { return this._state; }
  get intent() { return this._intent; }
  get stateTime() { return this._stateTime; }

  onStateChange(fn) {
    this._onStateChange = fn;
  }

  setIntent(intentStr) {
    if (this._intent !== intentStr) {
       this._intent = intentStr;
    }
  }

  /**
   * Run every frame. Synchronized by AvatarScene.
   */
  update(dt, playbackState) {
    this._stateTime += dt;

    // Use playbackState to drive deterministic transitions
    if (playbackState) {
       if (playbackState.isStarving && this._state === STATES.SPEAKING) {
           this._transition(STATES.WAITING);
       } else if (!playbackState.isStarving && this._state === STATES.WAITING && playbackState.isPlaying) {
           this._transition(STATES.SPEAKING);
       } else if (!playbackState.isPlaying && this._state === STATES.SPEAKING) {
           this._transition(STATES.POST_SPEECH_DECAY);
       }
    }

    // Auto-transitions
    switch (this._state) {
      case STATES.PRE_SPEECH:
        if (this._stateTime >= 0.15) this._transition(STATES.SPEAKING);
        break;
      case STATES.POST_SPEECH_DECAY:
        if (this._stateTime >= 0.8) this._transition(STATES.SETTLING);
        break;
      case STATES.SETTLING:
        if (this._stateTime >= 1.5) this._transition(STATES.IDLE);
        break;
      case STATES.IDLE:
        if (this._stateTime >= 3.0) this._transition(STATES.STILL_IDLE);
        break;
      case STATES.MICRO_PAUSE:
        if (this._stateTime >= 0.5 && this._pendingAudioChunks === 0) {
          this._transition(STATES.POST_SPEECH_DECAY);
        }
        break;
    }

    // Update continuous weights (Hysteresis & Blending)
    this._updateWeights(dt);
  }

  _updateWeights(dt) {
    const targets = {
      idle: 0, listening: 0, thinking: 0, speaking: 0, waiting: 0
    };

    switch (this._state) {
      case STATES.IDLE:
      case STATES.STILL_IDLE: 
      case STATES.POST_SPEECH_DECAY:
      case STATES.SETTLING:
        targets.idle = 1.0; 
        break;
      case STATES.LISTENING: 
        targets.listening = 1.0; 
        break;
      case STATES.THINKING: 
        targets.thinking = 1.0; 
        break;
      case STATES.WAITING:
        targets.waiting = 1.0;
        break;
      case STATES.SPEAKING:
      case STATES.PRE_SPEECH:
      case STATES.MICRO_PAUSE:
        targets.speaking = 1.0;
        break;
    }

    // Smooth blending
    const speed = 3.0; // Converges in ~1s
    const alpha = 1.0 - Math.exp(-speed * dt);
    
    this.weights.idle = THREE.MathUtils.lerp(this.weights.idle, targets.idle, alpha);
    this.weights.listening = THREE.MathUtils.lerp(this.weights.listening, targets.listening, alpha);
    this.weights.thinking = THREE.MathUtils.lerp(this.weights.thinking, targets.thinking, alpha);
    this.weights.speaking = THREE.MathUtils.lerp(this.weights.speaking, targets.speaking, alpha);
    this.weights.waiting = THREE.MathUtils.lerp(this.weights.waiting, targets.waiting, alpha);
  }

  // EVENT-DRIVEN TRANSITIONS
  onThinkingStart() {
    if (this._state === STATES.IDLE || this._state === STATES.STILL_IDLE || this._state === STATES.LISTENING) {
      this._transition(STATES.THINKING);
    }
  }

  onAudioStart() {
    if (this._state === STATES.THINKING || this._state === STATES.IDLE || this._state === STATES.STILL_IDLE || this._state === STATES.LISTENING || this._state === STATES.SETTLING || this._state === STATES.POST_SPEECH_DECAY) {
      this._transition(STATES.PRE_SPEECH);
    } else {
      this._transition(STATES.SPEAKING);
    }
  }

  onAudioChunkEnd() {
    if (this._state === STATES.SPEAKING && this._pendingAudioChunks > 0) {
      this._transition(STATES.MICRO_PAUSE);
    } else if (this._state === STATES.SPEAKING && this._pendingAudioChunks === 0) {
      this._transition(STATES.POST_SPEECH_DECAY);
    }
  }

  onUserInput() {
    if (this._state === STATES.IDLE || this._state === STATES.STILL_IDLE) {
      this._transition(STATES.LISTENING);
    }
  }

  forceIdle() {
    this._transition(STATES.IDLE);
  }

  setPendingAudioChunks(count) {
    this._pendingAudioChunks = Math.max(0, count);
  }

  _transition(newState) {
    if (this._state === newState) return;
    const prevState = this._state;
    this._state = newState;
    this._stateTime = 0;
    if (this._onStateChange) {
      this._onStateChange(newState, prevState);
    }
  }

  getAnimationForState() {
    switch (this._state) {
      case STATES.SPEAKING:
      case STATES.PRE_SPEECH:
      case STATES.MICRO_PAUSE:
        return 'speaking';
      case STATES.THINKING:
      case STATES.WAITING:
        return 'thinking';
      case STATES.POST_SPEECH_DECAY:
      case STATES.SETTLING:
      case STATES.IDLE:
      case STATES.STILL_IDLE:
      case STATES.LISTENING:
      default:
        return 'idle';
    }
  }
}
