import * as THREE from 'three';
import { getAnimationMeta } from '../data/animationRegistry';

/**
 * animationStateMachine.js
 * A layered, deterministic state machine with priority scoring.
 * Enforces Priority and Cooldowns to prevent action fighting and robotic looping.
 */

export const ANIMATION_PRIORITY = {
  IDLE: 0,
  THINKING: 1,
  TALKING: 2,
  GESTURE: 3,
  INTERRUPT: 999
};

export class AnimationStateMachine {
  constructor(mixer) {
    this.mixer = mixer;
    this.actions = {}; // map of id -> AnimationAction
    
    // Base Layer state
    this.currentBaseActionId = null;
    this.currentBasePriority = ANIMATION_PRIORITY.IDLE;
    
    // Additive Layer state
    this.currentAdditiveActionId = null;
    
    // Bind mixer event listener
    this.onFinished = this.onFinished.bind(this);
    this.mixer.addEventListener('finished', this.onFinished);
  }

  registerActions(actionsMap) {
    this.actions = actionsMap;
  }

  dispose() {
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onFinished);
    }
    this.actions = {};
  }

  onFinished(e) {
    const finishedAction = e.action;
    const actionId = Object.keys(this.actions).find(
      (id) => this.actions[id] === finishedAction
    );

    // If an additive gesture finishes, clean it up
    if (actionId === this.currentAdditiveActionId) {
       this.currentAdditiveActionId = null;
    }
  }

  /**
   * Request an animation playback. Priority is enforced.
   * @param {string} animationId - ID from the animationRegistry
   * @param {number} forcePriority - Optional override priority (e.g., 999 for interrupt)
   */
  play(animationId, forcePriority = null) {
    const meta = getAnimationMeta(animationId);
    if (!meta) return;

    const reqPriority = forcePriority !== null ? forcePriority : (meta.priority ?? 0);
    const isAdditive = meta.category === 'gesture';
    
    // Priority check for base layer
    if (!isAdditive && reqPriority < this.currentBasePriority && reqPriority !== ANIMATION_PRIORITY.INTERRUPT) {
       // Refuse transition to lower priority state
       return;
    }

    this.transitionTo(animationId, meta, isAdditive, reqPriority);
  }

  transitionTo(targetActionId, meta, isAdditive, reqPriority) {
    const nextAction = this.actions[targetActionId];
    if (!nextAction) return;

    const fadeDuration = 0.5; // HARDCODED crossfade duration (Step 4: Fix Crossfading)

    // Configure the incoming action
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);
    
    if (meta.loop === 'once') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    if (isAdditive) {
      // Additive layer transition
      const prevAdditiveAction = this.currentAdditiveActionId ? this.actions[this.currentAdditiveActionId] : null;
      if (prevAdditiveAction && prevAdditiveAction !== nextAction) {
        prevAdditiveAction.fadeOut(fadeDuration);
      }
      
      // Ensure it's additive
      nextAction.setEffectiveWeight(meta.baseWeight || 1);
      nextAction.reset();
      nextAction.fadeIn(fadeDuration).play();
      this.currentAdditiveActionId = targetActionId;
      
    } else {
      // Base layer transition
      if (this.currentBaseActionId === targetActionId && meta.loop === 'repeat') {
        // If we are overriding priority of the currently playing base loop, just update priority.
        if (reqPriority === ANIMATION_PRIORITY.INTERRUPT) {
          this.currentBasePriority = ANIMATION_PRIORITY.IDLE;
        } else {
          this.currentBasePriority = reqPriority;
        }
        return; // Already playing
      }
      
      const prevBaseAction = this.currentBaseActionId ? this.actions[this.currentBaseActionId] : null;
      
      nextAction.setEffectiveWeight(1);
      nextAction.reset();
      nextAction.fadeIn(fadeDuration).play();

      if (prevBaseAction && prevBaseAction !== nextAction) {
        prevBaseAction.fadeOut(fadeDuration);
      }
      
      // Immediately halt any other background BASE actions to prevent overlap bugs
      for (const id in this.actions) {
        const action = this.actions[id];
        const m = getAnimationMeta(id);
        if (action !== nextAction && action !== prevBaseAction && m && m.category !== 'gesture') {
          action.stop();
          action.enabled = false;
          action.setEffectiveWeight(0);
        }
      }

      // Update state
      this.currentBaseActionId = targetActionId;
      this.currentBasePriority = reqPriority === ANIMATION_PRIORITY.INTERRUPT ? ANIMATION_PRIORITY.IDLE : reqPriority;
    }
  }
  
  stopAdditive() {
      if (this.currentAdditiveActionId) {
          const action = this.actions[this.currentAdditiveActionId];
          if (action) {
              action.fadeOut(0.2);
          }
          this.currentAdditiveActionId = null;
      }
  }

  interruptToIdle() {
     this.stopAdditive();
     this.play('idle', ANIMATION_PRIORITY.INTERRUPT);
  }

  getCurrentBaseActionId() {
    return this.currentBaseActionId;
  }
}
