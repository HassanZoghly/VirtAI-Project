/**
 * AvatarAnimationController — Pure Three.js body animation controller.
 *
 * Owns:
 *   - THREE.AnimationMixer
 *   - Body animation actions (idle + talk variants)
 *   - Crossfade transitions
 *   - 3-state FSM: IDLE → TALKING_MOVEMENT → TALKING_FACE_ONLY
 *   - Timer management for talk pauses
 *
 * Does NOT own:
 *   - Facial animation / lip sync / morph targets
 *   - Audio processing / WebAudioQueue
 *   - React hooks / state / effects
 *   - WebSocket / network
 *
 * Usage:
 *   const controller = new AvatarAnimationController(mixer);
 *   controller.registerActions(actionsMap);
 *   // On audio play:  controller.startTalking();
 *   // On audio end:   controller.stopTalking();
 *   // Every frame:    controller.update(dt);
 *   // On unmount:     controller.dispose();
 */
import * as THREE from 'three';

// ── States ───────────────────────────────────────────────────────────────────
export const BODY_STATES = {
  IDLE: 'IDLE',
  TALKING_MOVEMENT: 'TALKING_MOVEMENT',
  TALKING_FACE_ONLY: 'TALKING_FACE_ONLY',
};

// ── Config ───────────────────────────────────────────────────────────────────
const CROSSFADE_DURATION = 0.5; // seconds
const FACE_ONLY_DELAY_MIN = 4; // seconds
const FACE_ONLY_DELAY_MAX = 9; // seconds

export class AvatarAnimationController {
  /**
   * @param {THREE.AnimationMixer} mixer
   */
  constructor(mixer) {
    this.mixer = mixer;
    this.actions = {}; // { actionName: THREE.AnimationAction }
    this.talkActionNames = []; // ['Talk_0', 'Talk_1', ...]

    // FSM state
    this._state = BODY_STATES.IDLE;
    this._isSpeaking = false; // external signal: is AI still speaking?

    // Current body action tracking
    this._currentActionName = null;

    // Talk animation selection — simple avoidance of last played
    this._lastTalkIndex = -1;

    // Timer for TALKING_FACE_ONLY → re-enter TALKING_MOVEMENT
    this._faceOnlyTimerId = null;

    // Mixer event listener for detecting when talk animations finish
    this._onMixerFinished = this._onMixerFinished.bind(this);
    this.mixer.addEventListener('finished', this._onMixerFinished);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register animation actions. Call after loading all clips.
   * @param {{ [name: string]: THREE.AnimationAction }} actionsMap
   */
  registerActions(actionsMap) {
    this.actions = { ...this.actions, ...actionsMap };

    // Identify talk actions by name pattern
    this.talkActionNames = Object.keys(this.actions)
      .filter((name) => /^Talk_\d+$/i.test(name))
      .sort();

    // Configure all actions with sensible defaults
    for (const [name, action] of Object.entries(this.actions)) {
      if (name.toLowerCase() === 'idle') {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        // Talk animations play once then fire 'finished'
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
    }

    // Start in idle
    this._playAction('idle', 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — called by AvatarController (React layer)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Signal that audio playback has started.
   * Triggers body movement if in IDLE.
   * @param {boolean} movementEnabled - from setup settings
   */
  startTalking(movementEnabled = true) {
    this._isSpeaking = true;

    if (!movementEnabled) {
      // Movement disabled — stay in idle, only face animates
      return;
    }

    if (this._state === BODY_STATES.IDLE) {
      this._enterTalkingMovement();
    }
    // If already in TALKING_MOVEMENT or TALKING_FACE_ONLY, do nothing —
    // the FSM will cycle naturally.
  }

  /**
   * Signal that audio playback has ended (AI finished speaking).
   * Interrupts any running talk animation and returns to idle.
   */
  stopTalking() {
    this._isSpeaking = false;
    this._cancelFaceOnlyTimer();

    if (this._state !== BODY_STATES.IDLE) {
      this._transitionToIdle();
    }
  }

  /**
   * Called every frame from useFrame.
   * Only advances the mixer — no animation decisions here.
   * @param {number} dt - delta time in seconds
   */
  update(dt) {
    if (this.mixer && dt > 0) {
      this.mixer.update(dt);
    }
  }

  /**
   * @returns {string} Current FSM state
   */
  getState() {
    return this._state;
  }

  /**
   * Clean up timers and event listeners.
   */
  dispose() {
    this._cancelFaceOnlyTimer();
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this._onMixerFinished);
      this.mixer.stopAllAction();
    }
    this.actions = {};
    this.talkActionNames = [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — State transitions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enter TALKING_MOVEMENT: pick a talk animation and crossfade to it.
   */
  _enterTalkingMovement() {
    const talkName = this._pickNextTalkAnimation();
    if (!talkName) {
      // No talk animations loaded — stay idle
      return;
    }

    this._state = BODY_STATES.TALKING_MOVEMENT;
    this._playAction(talkName, CROSSFADE_DURATION);
  }

  /**
   * Enter TALKING_FACE_ONLY: stop body movement, start delay timer.
   */
  _enterTalkingFaceOnly() {
    this._state = BODY_STATES.TALKING_FACE_ONLY;

    // Crossfade back to idle (body stops moving, face keeps going)
    this._playAction('idle', CROSSFADE_DURATION);

    // After random delay, re-enter TALKING_MOVEMENT if still speaking
    const delay = FACE_ONLY_DELAY_MIN + Math.random() * (FACE_ONLY_DELAY_MAX - FACE_ONLY_DELAY_MIN);
    this._cancelFaceOnlyTimer();
    this._faceOnlyTimerId = setTimeout(() => {
      this._faceOnlyTimerId = null;
      this._onFaceOnlyTimerElapsed();
    }, delay * 1000);
  }

  /**
   * Return to IDLE with smooth crossfade.
   */
  _transitionToIdle() {
    this._state = BODY_STATES.IDLE;
    this._playAction('idle', CROSSFADE_DURATION);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Events
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Mixer 'finished' event — a talk animation completed its loop.
   */
  _onMixerFinished(event) {
    const finishedAction = event.action;

    // Only care about talk animations finishing
    const finishedName = this._findActionName(finishedAction);
    if (!finishedName || !this._isTalkAction(finishedName)) {
      return;
    }

    // Only transition if we're currently in TALKING_MOVEMENT
    if (this._state !== BODY_STATES.TALKING_MOVEMENT) {
      return;
    }

    if (this._isSpeaking) {
      // AI is still speaking — enter face-only pause
      this._enterTalkingFaceOnly();
    } else {
      // AI finished — go back to idle
      this._transitionToIdle();
    }
  }

  /**
   * Face-only timer elapsed — re-enter TALKING_MOVEMENT if still speaking.
   */
  _onFaceOnlyTimerElapsed() {
    if (this._state !== BODY_STATES.TALKING_FACE_ONLY) {
      return;
    }

    if (this._isSpeaking) {
      this._enterTalkingMovement();
    } else {
      this._transitionToIdle();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Animation playback
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crossfade to a named action. Only one action plays at a time.
   * @param {string} name - action name (e.g., 'idle', 'Talk_2')
   * @param {number} fadeDuration - crossfade duration in seconds
   */
  _playAction(name, fadeDuration) {
    const normalizedName = this._resolveActionName(name);
    const nextAction = this.actions[normalizedName];
    if (!nextAction) {
      return;
    }

    const prevAction = this._currentActionName
      ? this.actions[this._currentActionName]
      : null;

    // Don't re-trigger if same action is already playing (for idle looping)
    if (
      this._currentActionName === normalizedName &&
      prevAction &&
      prevAction.isRunning()
    ) {
      return;
    }

    // Configure and play the next action
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);

    if (fadeDuration > 0 && prevAction && prevAction !== nextAction) {
      nextAction.crossFadeFrom(prevAction, fadeDuration, true);
    }

    nextAction.play();

    // Stop all other actions that aren't part of the crossfade
    for (const [actionName, action] of Object.entries(this.actions)) {
      if (action !== nextAction && action !== prevAction) {
        action.stop();
        action.enabled = false;
        action.setEffectiveWeight(0);
      }
    }

    this._currentActionName = normalizedName;
  }

  /**
   * Pick the next talk animation, avoiding the last played.
   * @returns {string|null}
   */
  _pickNextTalkAnimation() {
    if (this.talkActionNames.length === 0) return null;
    if (this.talkActionNames.length === 1) {
      this._lastTalkIndex = 0;
      return this.talkActionNames[0];
    }

    // Pick random, avoiding last
    let index;
    let attempts = 0;
    do {
      index = Math.floor(Math.random() * this.talkActionNames.length);
      attempts++;
    } while (index === this._lastTalkIndex && attempts < 10);

    this._lastTalkIndex = index;
    return this.talkActionNames[index];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a name to the actual key in the actions map (case-insensitive).
   */
  _resolveActionName(name) {
    if (this.actions[name]) return name;
    const lower = name.toLowerCase();
    for (const key of Object.keys(this.actions)) {
      if (key.toLowerCase() === lower) return key;
    }
    return name;
  }

  /**
   * Find the name of an action in the actions map.
   */
  _findActionName(action) {
    for (const [name, a] of Object.entries(this.actions)) {
      if (a === action) return name;
    }
    return null;
  }

  /**
   * Check if a name is a talk animation.
   */
  _isTalkAction(name) {
    return /^Talk_\d+$/i.test(name);
  }

  /**
   * Cancel the face-only delay timer.
   */
  _cancelFaceOnlyTimer() {
    if (this._faceOnlyTimerId !== null) {
      clearTimeout(this._faceOnlyTimerId);
      this._faceOnlyTimerId = null;
    }
  }
}
