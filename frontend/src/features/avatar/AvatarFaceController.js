/**
 * AvatarFaceController — Standalone facial animation module for Ready Player Me avatars.
 *
 * Controls: blink, idle micro-expressions, emotion presets, speaking enhancements.
 * Does NOT handle avatar loading, lip-sync visemes, or body animations —
 * those remain in existing code. This class returns computed morph target values
 * via update(dt) so the caller can merge them with the lip-sync pipeline.
 */

// ── Easing helpers ───────────────────────────────────────────────────────────
function easeInQuad(t) {
  return t * t;
}
function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/** Sum of sine waves → organic oscillation (0 to ~sum(amplitudes)). */
function layeredSine(time, frequencies, amplitudes, phases) {
  let sum = 0;
  for (let i = 0; i < frequencies.length; i++) {
    sum += amplitudes[i] * (Math.sin(time * frequencies[i] + (phases[i] || 0)) * 0.5 + 0.5);
  }
  return sum;
}

// ── Blink FSM states ─────────────────────────────────────────────────────────
const BL_IDLE = 0;
const BL_CLOSING = 1;
const BL_HOLD = 2;
const BL_OPENING = 3;

// ── Emotion validation ──────────────────────────────────────────────────────
const VALID_EMOTIONS = new Set([
  'neutral',
  'happy',
  'joyful',
  'sad',
  'surprised',
  'angry',
  'thinking',
  'confused',
  'empathetic',
  'sympathetic',
  'excited',
  'concerned',
  'reassuring',
  'proud',
  'disappointed',
  'sarcastic',
  'grateful',
  'curious',
]);

// ═══════════════════════════════════════════════════════════════════════════════
export class AvatarFaceController {
  /* ─── Emotion → morph-target mapping (16 presets) ─────────────────────── */
  static EMOTION_MAP = {
    neutral: {},
    happy: {
      mouthSmileLeft: 0.8,
      mouthSmileRight: 0.8,
      cheekSquintLeft: 0.5,
      cheekSquintRight: 0.5,
    },
    joyful: {
      mouthSmileLeft: 0.8,
      mouthSmileRight: 0.8,
      cheekSquintLeft: 0.5,
      cheekSquintRight: 0.5,
    },
    sad: {
      mouthFrownLeft: 0.55,
      mouthFrownRight: 0.55,
      browInnerUp: 0.65,
      browDownLeft: 0.1,
      browDownRight: 0.1,
      mouthPressLeft: 0.25,
      mouthPressRight: 0.25,
      eyeSquintLeft: 0.15,
      eyeSquintRight: 0.15,
    },
    surprised: {
      browOuterUpLeft: 0.8,
      browOuterUpRight: 0.8,
      eyeWideLeft: 0.7,
      eyeWideRight: 0.7,
      jawOpen: 0.1,
    },
    angry: {
      browDownLeft: 0.65,
      browDownRight: 0.65,
      eyeSquintLeft: 0.45,
      eyeSquintRight: 0.45,
      noseSneerLeft: 0.45,
      noseSneerRight: 0.45,
      mouthShrugUpper: 0.3,
      jawForward: 0.15,
      mouthPressLeft: 0.2,
      mouthPressRight: 0.2,
    },
    thinking: {
      browDownRight: 0.5,
      browDownLeft: 0.5,
      eyeSquintLeft: 0.4,
      eyeSquintRight: 0.4,
    },
    confused: {
      browInnerUp: 0.5,
      browDownRight: 0.3,
      eyeSquintLeft: 0.3,
      eyeSquintRight: 0.1,
      mouthPucker: 0.15,
      mouthLeft: 0.15,
      jawOpen: 0.05,
    },
    empathetic: {
      browInnerUp: 0.7,
      mouthSmileLeft: 0.2,
      mouthSmileRight: 0.2,
      mouthRollLower: 0.3,
    },
    sympathetic: {
      browInnerUp: 0.7,
      mouthSmileLeft: 0.2,
      mouthSmileRight: 0.2,
      mouthRollLower: 0.3,
    },
    excited: {
      mouthSmileLeft: 0.8,
      mouthSmileRight: 0.8,
      eyeWideLeft: 0.4,
      eyeWideRight: 0.4,
      cheekSquintLeft: 0.5,
      cheekSquintRight: 0.5,
      browInnerUp: 0.3,
      browOuterUpLeft: 0.3,
      browOuterUpRight: 0.3,
      jawOpen: 0.1,
    },
    concerned: {
      browInnerUp: 0.6,
      browDownLeft: 0.2,
      browDownRight: 0.2,
      eyeSquintLeft: 0.15,
      eyeSquintRight: 0.15,
      mouthFrownLeft: 0.25,
      mouthFrownRight: 0.25,
      mouthPressLeft: 0.15,
      mouthPressRight: 0.15,
    },
    reassuring: {
      mouthSmileLeft: 0.4,
      mouthSmileRight: 0.4,
      browInnerUp: 0.25,
      browOuterUpLeft: 0.15,
      browOuterUpRight: 0.15,
      eyeSquintLeft: 0.15,
      eyeSquintRight: 0.15,
      cheekSquintLeft: 0.2,
      cheekSquintRight: 0.2,
    },
    proud: {
      mouthSmileLeft: 0.5,
      mouthSmileRight: 0.5,
      browOuterUpLeft: 0.25,
      browOuterUpRight: 0.25,
      cheekSquintLeft: 0.3,
      cheekSquintRight: 0.3,
      eyeSquintLeft: 0.2,
      eyeSquintRight: 0.2,
      mouthShrugUpper: 0.15,
    },
    disappointed: {
      mouthFrownLeft: 0.45,
      mouthFrownRight: 0.45,
      browInnerUp: 0.3,
      browDownLeft: 0.25,
      browDownRight: 0.25,
      eyeLookDownLeft: 0.3,
      eyeLookDownRight: 0.3,
      mouthRollLower: 0.15,
      jawOpen: 0.03,
    },
    sarcastic: {
      mouthSmileLeft: 0.5,
      mouthSmileRight: 0.15, // asymmetric
      browOuterUpLeft: 0.4,
      browDownRight: 0.2, // one brow up
      eyeSquintLeft: 0.3,
      eyeSquintRight: 0.1,
      mouthDimpleLeft: 0.3,
    },
    grateful: {
      mouthSmileLeft: 0.55,
      mouthSmileRight: 0.55,
      browInnerUp: 0.35,
      eyeSquintLeft: 0.2,
      eyeSquintRight: 0.2,
      cheekSquintLeft: 0.25,
      cheekSquintRight: 0.25,
      mouthPressLeft: 0.1,
      mouthPressRight: 0.1,
    },
    curious: {
      browOuterUpLeft: 0.35,
      browOuterUpRight: 0.35,
      browInnerUp: 0.2,
      eyeWideLeft: 0.25,
      eyeWideRight: 0.25,
      mouthSmileLeft: 0.1,
      mouthSmileRight: 0.1,
      jawOpen: 0.05,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  constructor() {
    // Mesh tracking
    this.meshes = [];
    this.availableMorphs = new Set(); // union of all morph names across meshes

    // Blink
    this.isBlinking = true; // master toggle
    this._blinkState = BL_IDLE;
    this._blinkTimer = 0;
    this._blinkValue = 0;
    this._nextBlinkIn = this._randomBlinkInterval();
    this._doubleBlinkQueued = false;
    this._isDoubleBlink = false;
    this._slowBlink = false;

    // Idle
    this.idleEnabled = true;
    this._elapsedTime = 0;

    // Emotion
    this._currentEmotion = 'neutral';
    this._emotionIntensity = 0;
    this._emotionValues = {}; // current lerped emotion targets
    this._transitioning = false;
    this._transFrom = {};
    this._transTo = {};
    this._transElapsed = 0;
    this._transDuration = 0.6;
    this._secondaryValues = {}; // secondary emotion contribution

    // Speaking
    this.isSpeaking = false;
    this._speakBrowTimer = 0;
    this._speakBrowNext = this._randomRange(2, 4);
    this._speakBrowPhase = 0;
    this._speakGazeTimer = 0;
    this._speakGazeNext = this._randomRange(3, 6);
    this._speakGazePhase = 0;

    // Scheduled timers for transitions (setTimeout IDs)
    this._scheduledTimers = [];

    // Idle micro-expression channels — 3 layered sine waves each, unique frequencies
    this._idleChannels = {
      browInnerUp: { f: [0.37, 0.83, 1.47], a: [0.07, 0.05, 0.03], p: [0, 1.2, 3.7], max: 0.1 },
      browDownLeft: { f: [0.29, 0.71, 1.31], a: [0.06, 0.05, 0.04], p: [0.5, 2.1, 4.3], max: 0.1 },
      browDownRight: { f: [0.31, 0.73, 1.29], a: [0.06, 0.05, 0.04], p: [0.8, 2.4, 4.1], max: 0.1 },
      mouthSmileLeft: {
        f: [0.23, 0.61, 1.13],
        a: [0.05, 0.03, 0.02],
        p: [1.1, 3.3, 5.2],
        max: 0.06,
      },
      mouthSmileRight: {
        f: [0.25, 0.59, 1.17],
        a: [0.05, 0.03, 0.02],
        p: [1.3, 3.1, 5.5],
        max: 0.06,
      },
      jawOpen: { f: [0.19, 0.47, 0.97], a: [0.015, 0.01, 0.005], p: [0.7, 2.8, 4.9], max: 0.02 },
      eyeSquintLeft: {
        f: [0.27, 0.67, 1.21],
        a: [0.04, 0.025, 0.015],
        p: [1.5, 3.6, 5.8],
        max: 0.05,
      },
      eyeSquintRight: {
        f: [0.28, 0.69, 1.19],
        a: [0.04, 0.025, 0.015],
        p: [1.7, 3.4, 6.0],
        max: 0.05,
      },
      eyeLookInLeft: {
        f: [0.05, 0.13, 0.31],
        a: [0.015, 0.01, 0.005],
        p: [2.5, 4.0, 5.5],
        max: 0.03,
      },
      eyeLookInRight: {
        f: [0.06, 0.14, 0.29],
        a: [0.015, 0.01, 0.005],
        p: [2.7, 4.2, 5.3],
        max: 0.03,
      },
      noseSneerLeft: {
        f: [0.04, 0.11, 0.23],
        a: [0.01, 0.006, 0.004],
        p: [2.0, 4.5, 6.3],
        max: 0.02,
      },
      noseSneerRight: {
        f: [0.045, 0.12, 0.25],
        a: [0.01, 0.006, 0.004],
        p: [2.2, 4.7, 6.1],
        max: 0.02,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC — call once after the avatar loads
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register meshes that have morphTargetDictionary.
   * @param {THREE.Mesh[]} meshesArray
   */
  initializeMeshes(meshesArray) {
    this.meshes = meshesArray;
    this.availableMorphs = new Set();
    for (const mesh of meshesArray) {
      if (mesh.morphTargetDictionary) {
        for (const name of Object.keys(mesh.morphTargetDictionary)) {
          this.availableMorphs.add(name);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BLINK SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  _randomBlinkInterval() {
    // Base: 5-9 s.  Emotion-aware adjustments happen in the countdown.
    return this._randomRange(5, 9);
  }

  _getBlinkIntervalMultiplier() {
    switch (this._currentEmotion) {
      case 'surprised':
        return 1.5; // blink less often
      case 'sad':
        return 0.7; // blink more often
      case 'thinking':
        return 1.0;
      default:
        return 1.0;
    }
  }

  _getSlowBlinkChance() {
    return this._currentEmotion === 'thinking' ? 0.2 : 0.05;
  }

  _updateBlink(dt) {
    if (!this.isBlinking) {
      this._blinkValue = 0;
      return;
    }

    const closeDur = this._slowBlink ? 0.126 : 0.07;
    const holdDur = this._slowBlink ? 0.072 : 0.04;
    const openDur = this._slowBlink ? 0.18 : 0.1;

    switch (this._blinkState) {
      case BL_IDLE:
        this._nextBlinkIn -= dt * (1 / this._getBlinkIntervalMultiplier());
        if (this._nextBlinkIn <= 0) {
          this._blinkState = BL_CLOSING;
          this._blinkTimer = 0;
          this._slowBlink = Math.random() < this._getSlowBlinkChance();
          this._doubleBlinkQueued = Math.random() < 0.15;
        }
        this._blinkValue = 0;
        break;

      case BL_CLOSING:
        this._blinkTimer += dt;
        if (this._blinkTimer >= closeDur) {
          this._blinkState = BL_HOLD;
          this._blinkTimer = 0;
          this._blinkValue = 1;
        } else {
          this._blinkValue = easeInQuad(this._blinkTimer / closeDur);
        }
        break;

      case BL_HOLD:
        this._blinkTimer += dt;
        this._blinkValue = 1;
        if (this._blinkTimer >= holdDur) {
          this._blinkState = BL_OPENING;
          this._blinkTimer = 0;
        }
        break;

      case BL_OPENING:
        this._blinkTimer += dt;
        if (this._blinkTimer >= openDur) {
          this._blinkValue = 0;
          if (this._doubleBlinkQueued && !this._isDoubleBlink) {
            // Queue second blink after 150 ms pause
            this._isDoubleBlink = true;
            this._blinkState = BL_IDLE;
            this._nextBlinkIn = 0.15;
          } else {
            this._blinkState = BL_IDLE;
            this._blinkTimer = 0;
            this._isDoubleBlink = false;
            this._doubleBlinkQueued = false;
            this._nextBlinkIn = this._randomBlinkInterval();
          }
        } else {
          this._blinkValue = 1 - easeOutQuad(this._blinkTimer / openDur);
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IDLE MICRO-EXPRESSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  _computeIdle() {
    const out = {};
    if (!this.idleEnabled) {
      return out;
    }

    // Dampen idle when emotion or speaking is active
    let mult = 1.0;
    if (this._currentEmotion !== 'neutral') {
      mult = 0.4;
    } else if (this.isSpeaking) {
      mult = 0.6;
    }

    for (const [name, cfg] of Object.entries(this._idleChannels)) {
      const ampSum = cfg.a[0] + cfg.a[1] + cfg.a[2];
      const raw = layeredSine(this._elapsedTime, cfg.f, cfg.a, cfg.p);
      out[name] = (raw / ampSum) * cfg.max * mult;
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMOTION SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transition to a new emotion.
   * @param {string} name      One of VALID_EMOTIONS
   * @param {number} intensity 0-1
   */
  setEmotion(name, intensity = 1.0) {
    if (!VALID_EMOTIONS.has(name)) {
      name = 'neutral';
    }
    intensity = Math.max(0, Math.min(1, intensity));

    const preset = AvatarFaceController.EMOTION_MAP[name] || {};

    this._currentEmotion = name;
    this._emotionIntensity = intensity;

    // Build target values
    this._transTo = {};
    for (const [k, v] of Object.entries(preset)) {
      this._transTo[k] = v * intensity;
    }

    // Ensure we start pulling towards new targets
    this._transitioning = true;
  }

  /**
   * Parse an AI response emotion payload and apply it.
   * Expected shape: { primary, secondary?, intensity?, transitions? }
   * @param {object|null} emotionData
   */
  applyAIResponse(emotionData) {
    if (!emotionData) {
      return;
    }

    const primary = emotionData.primary || 'neutral';
    const intensity =
      typeof emotionData.intensity === 'number'
        ? Math.max(0, Math.min(1, emotionData.intensity))
        : 0.5;

    this.setEmotion(primary, intensity);

    // Secondary emotion blended at 30 % of its own intensity
    this._secondaryValues = {};
    if (
      emotionData.secondary &&
      emotionData.secondary !== 'none' &&
      VALID_EMOTIONS.has(emotionData.secondary)
    ) {
      const secPreset = AvatarFaceController.EMOTION_MAP[emotionData.secondary] || {};
      for (const [k, v] of Object.entries(secPreset)) {
        this._secondaryValues[k] = v * intensity * 0.3;
      }
    }

    // Clear previous scheduled transitions
    for (const id of this._scheduledTimers) {
      clearTimeout(id);
    }
    this._scheduledTimers = [];

    // Schedule mid-response transitions
    if (Array.isArray(emotionData.transitions)) {
      for (const tr of emotionData.transitions) {
        if (!tr.emotion || typeof tr.at_char_index !== 'number') {
          continue;
        }
        // Rough conversion: at ~25 chars/sec reading speed
        const delayMs = (tr.at_char_index / 25) * 1000;
        const timerId = setTimeout(() => {
          this.setEmotion(
            tr.emotion,
            typeof tr.intensity === 'number' ? tr.intensity : 0.5
          );
        }, delayMs);
        this._scheduledTimers.push(timerId);
      }
    }
  }

  _updateEmotion(dt) {
    if (!this._transitioning) {
      return;
    }

    // Continuous pull towards target values (asymptotic lerp)
    // Roughly 0.1 at 60fps -> factor of 6
    const lerpAlpha = Math.min(dt * 6, 1.0);
    
    const allKeys = new Set([...Object.keys(this._emotionValues), ...Object.keys(this._transTo)]);
    let anySignificantDiff = false;

    for (const k of allKeys) {
      const current = this._emotionValues[k] || 0;
      const target = this._transTo[k] || 0;
      
      const nextValue = current + (target - current) * lerpAlpha;
      this._emotionValues[k] = nextValue;

      if (Math.abs(target - nextValue) > 0.001) {
        anySignificantDiff = true;
      }
    }

    if (!anySignificantDiff) {
      this._transitioning = false;
      // Cleanup near-zero values
      for (const k of Object.keys(this._emotionValues)) {
        if (Math.abs(this._emotionValues[k]) < 0.001) {
          delete this._emotionValues[k];
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPEAKING ENHANCEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  setSpeaking(active) {
    this.isSpeaking = active;
    if (active) {
      this._speakBrowTimer = 0;
      this._speakBrowNext = this._randomRange(2, 4);
      this._speakGazeTimer = 0;
      this._speakGazeNext = this._randomRange(3, 6);
    }
  }

  /** Returns small additive morph targets for speaking emphasis. */
  _computeSpeaking(dt) {
    const out = {};
    if (!this.isSpeaking) {
      return out;
    }

    // Micro eyebrow raises every 2-4 s
    this._speakBrowTimer += dt;
    if (this._speakBrowTimer >= this._speakBrowNext) {
      this._speakBrowTimer = 0;
      this._speakBrowPhase = 1; // start a raise
      this._speakBrowNext = this._randomRange(2, 4);
    }
    if (this._speakBrowPhase > 0) {
      this._speakBrowPhase -= dt / 0.4; // 400 ms up-down cycle
      const v = Math.sin(Math.max(0, this._speakBrowPhase) * Math.PI) * 0.15;
      out.browInnerUp = v;
    }

    // Eye gaze micro-shifts every 3-6 s
    this._speakGazeTimer += dt;
    if (this._speakGazeTimer >= this._speakGazeNext) {
      this._speakGazeTimer = 0;
      this._speakGazePhase = Math.random() * Math.PI * 2;
      this._speakGazeNext = this._randomRange(3, 6);
    }
    const gaze = Math.sin(this._elapsedTime * 0.4 + this._speakGazePhase) * 0.03;
    out.eyeLookInLeft = Math.max(0, gaze);
    out.eyeLookInRight = Math.max(0, -gaze);

    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MASTER UPDATE — call every frame. Returns { morphName: value } dict.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {number} deltaTime  Seconds since last frame
   * @returns {Record<string, number>}  Morph target name → clamped [0,1] value
   */
  update(deltaTime) {
    this._elapsedTime += deltaTime;

    // 1. Blink
    this._updateBlink(deltaTime);

    // 2. Emotion transition
    this._updateEmotion(deltaTime);

    // 3. Idle
    const idle = this._computeIdle();

    // 4. Speaking
    const speak = this._computeSpeaking(deltaTime);

    // 5. Merge: idle + emotion + secondary + speaking + blink
    const final = {};

    // Start with idle
    for (const [k, v] of Object.entries(idle)) {
      final[k] = v;
    }

    // Add emotion
    for (const [k, v] of Object.entries(this._emotionValues)) {
      final[k] = (final[k] || 0) + v;
    }

    // Add secondary
    for (const [k, v] of Object.entries(this._secondaryValues)) {
      final[k] = (final[k] || 0) + v;
    }

    // Add speaking emphasis
    for (const [k, v] of Object.entries(speak)) {
      final[k] = (final[k] || 0) + v;
    }

    // Add blink
    if (this._blinkValue > 0) {
      final.eyeBlinkLeft = (final.eyeBlinkLeft || 0) + this._blinkValue;
      final.eyeBlinkRight = (final.eyeBlinkRight || 0) + this._blinkValue;
    }

    // Clamp everything to [0, 1], drop morph names not on the meshes
    for (const k of Object.keys(final)) {
      final[k] = Math.max(0, Math.min(1, final[k]));
    }

    return final;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  _randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /** Cancel all pending timers. Call on component unmount. */
  dispose() {
    for (const id of this._scheduledTimers) {
      clearTimeout(id);
    }
    this._scheduledTimers = [];
  }
}
