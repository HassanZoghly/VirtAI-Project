/**
 * Animation State Controller
 * Manages animation states with smooth cross-fading
 */

import * as THREE from 'three';

/**
 * Animation states
 */
export const AnimationState = {
  IDLE: 'IDLE',
  TALK: 'TALK',
  GREETING: 'GREETING',
  THINK: 'THINK',
};

/**
 * Animation State Controller
 * Handles state transitions with cross-fading
 */
export class AnimationStateController {
  constructor(mixer, clips) {
    this.mixer = mixer;
    this.clips = clips; // Map<string, THREE.AnimationClip>
    this.actions = new Map(); // Map<string, THREE.AnimationAction>
    this.currentState = null;
    this.currentAction = null;
    
    // Fade durations
    this.fadeInDuration = 0.15;
    this.fadeOutDuration = 0.15;
    
    // Initialize actions
    this._initializeActions();
    
    if (import.meta.env.DEV) {
      console.debug('[AnimController] Initialized with states:', Array.from(this.actions.keys()));
    }
  }
  
  /**
   * Initialize animation actions from clips
   * @private
   */
  _initializeActions() {
    for (const [name, clip] of this.clips.entries()) {
      if (!clip) continue;
      
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      
      this.actions.set(name, action);
      
      if (import.meta.env.DEV) {
        console.debug(`[AnimController] Created action: ${name} (${clip.duration.toFixed(2)}s)`);
      }
    }
  }
  
  /**
   * Get action for a state
   * @param {string} state - Animation state
   * @returns {THREE.AnimationAction|null}
   * @private
   */
  _getAction(state) {
    // Direct mapping
    if (this.actions.has(state)) {
      return this.actions.get(state);
    }
    
    // Fallback mapping
    const fallbacks = {
      [AnimationState.TALK]: AnimationState.IDLE,
      [AnimationState.THINK]: AnimationState.IDLE,
      [AnimationState.GREETING]: AnimationState.IDLE,
    };
    
    const fallback = fallbacks[state];
    if (fallback && this.actions.has(fallback)) {
      if (import.meta.env.DEV) {
        console.debug(`[AnimController] Using fallback: ${state} → ${fallback}`);
      }
      return this.actions.get(fallback);
    }
    
    return null;
  }
  
  /**
   * Transition to a new state
   * @param {string} newState - Target animation state
   * @param {boolean} force - Force transition even if already in this state
   */
  transitionTo(newState, force = false) {
    // Skip if already in this state (unless forced)
    if (!force && this.currentState === newState) {
      return;
    }
    
    const newAction = this._getAction(newState);
    
    if (!newAction) {
      console.warn(`[AnimController] No action found for state: ${newState}`);
      return;
    }
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimController] Transition: ${this.currentState || 'null'} → ${newState}`);
    }
    
    // Handle transition
    if (this.currentAction && this.currentAction !== newAction) {
      // Cross-fade from current to new
      this.currentAction.fadeOut(this.fadeOutDuration);
      newAction.reset();
      newAction.fadeIn(this.fadeInDuration);
      newAction.play();
    } else if (!this.currentAction) {
      // First animation - just fade in
      newAction.reset();
      newAction.fadeIn(this.fadeInDuration);
      newAction.play();
    } else {
      // Same action - just reset and play
      newAction.reset();
      newAction.play();
    }
    
    this.currentState = newState;
    this.currentAction = newAction;
  }
  
  /**
   * Start with idle state
   * Should be called once after initialization
   */
  start() {
    this.transitionTo(AnimationState.IDLE, true);
    
    if (import.meta.env.DEV) {
      console.debug('[AnimController] Started with IDLE state');
    }
  }
  
  /**
   * Update animation mixer
   * Should be called every frame
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
  }
  
  /**
   * Get current state
   * @returns {string|null}
   */
  getCurrentState() {
    return this.currentState;
  }
  
  /**
   * Check if a state is available
   * @param {string} state - State to check
   * @returns {boolean}
   */
  hasState(state) {
    return this.actions.has(state) || this._getAction(state) !== null;
  }
  
  /**
   * Stop all animations
   */
  stopAll() {
    for (const action of this.actions.values()) {
      action.stop();
    }
    this.currentState = null;
    this.currentAction = null;
    
    if (import.meta.env.DEV) {
      console.debug('[AnimController] Stopped all animations');
    }
  }
  
  /**
   * Dispose controller and cleanup
   */
  dispose() {
    this.stopAll();
    this.actions.clear();
    this.clips.clear();
    this.mixer = null;
    
    if (import.meta.env.DEV) {
      console.debug('[AnimController] Disposed');
    }
  }
}
