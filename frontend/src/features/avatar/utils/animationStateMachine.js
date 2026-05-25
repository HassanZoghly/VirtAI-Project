import * as THREE from 'three';
import { getAnimationMeta } from '../data/animationRegistry';

/**
 * animationStateMachine.js
 * A lightweight, deterministic state machine for avatar animation.
 * Drives playback purely through THREE.AnimationMixer and its finished events.
 */

export const ANIMATION_STATES = {
  IDLE: 'IDLE',
  TALKING: 'TALKING',
  THINKING: 'THINKING',
  GESTURE: 'GESTURE',
  RETURN_TO_IDLE: 'RETURN_TO_IDLE',
};

export class AnimationStateMachine {
  constructor(mixer) {
    this.mixer = mixer;
    this.actions = {}; // map of id -> AnimationAction
    this.currentState = ANIMATION_STATES.IDLE;
    this.currentActionId = null;
    
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
    // Find the ID of the finished action
    const actionId = Object.keys(this.actions).find(
      (id) => this.actions[id] === finishedAction
    );

    if (actionId === this.currentActionId) {
      // The primary action finished. If it's a GESTURE, transition back to IDLE.
      if (this.currentState === ANIMATION_STATES.GESTURE) {
        this.transitionTo(ANIMATION_STATES.RETURN_TO_IDLE, 'idle');
      }
    }
  }

  /**
   * Request an animation playback. State is derived from the animation category.
   * @param {string} animationId - ID from the animationRegistry
   */
  play(animationId) {
    const meta = getAnimationMeta(animationId);
    if (!meta) return;

    let targetState = ANIMATION_STATES.IDLE;
    if (meta.category === 'talk') targetState = ANIMATION_STATES.TALKING;
    if (meta.category === 'thinking') targetState = ANIMATION_STATES.THINKING;
    if (meta.category === 'gesture') targetState = ANIMATION_STATES.GESTURE;

    this.transitionTo(targetState, animationId, meta);
  }

  transitionTo(newState, targetActionId, targetMeta = null) {
    const meta = targetMeta || getAnimationMeta(targetActionId);
    if (!meta) return;

    const nextAction = this.actions[targetActionId];
    if (!nextAction) return;

    // Don't re-trigger if already playing the exact same repeating clip
    if (this.currentActionId === targetActionId && meta.loop === 'repeat') {
      return;
    }

    const prevActionId = this.currentActionId;
    const prevAction = prevActionId ? this.actions[prevActionId] : null;

    // Determine fade duration safely
    const fadeDuration = meta.fadeIn || 0.25;

    // Configure the incoming action
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    
    if (meta.loop === 'once') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    nextAction.reset();
    nextAction.fadeIn(fadeDuration).play();

    // Fade out previous action
    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(fadeDuration);
    }

    // Immediately halt any other background actions to prevent overlap bugs
    for (const id in this.actions) {
      const action = this.actions[id];
      if (action !== nextAction && action !== prevAction) {
        action.stop();
        action.enabled = false;
        action.setEffectiveWeight(0);
      }
    }

    // Update state
    this.currentState = newState === ANIMATION_STATES.RETURN_TO_IDLE ? ANIMATION_STATES.IDLE : newState;
    this.currentActionId = targetActionId;
  }

  getCurrentState() {
    return this.currentState;
  }

  getCurrentActionId() {
    return this.currentActionId;
  }
}
