/**
 * AvatarLipSyncController — Facial animation compositor.
 *
 * Composes two independent face systems into a single morph target pass:
 *   1. AvatarFaceController — blink, emotion, idle micro-expressions
 *   2. useAudioDrivenLipSync — viseme-driven mouth shapes from audio clock
 *
 * Responsibilities:
 *   - Initialize meshes for the face controller
 *   - Composite face + lip sync morph targets every frame
 *   - Apply merged values to mesh morph target influences
 *   - Maintain strict separation: face morphs NEVER touch body
 *
 * Does NOT own:
 *   - Body animation / mixer
 *   - Audio playback
 *   - React hooks / state
 */
import * as THREE from 'three';
import { AvatarFaceController } from './AvatarFaceController';

export class AvatarLipSyncController {
  constructor() {
    this.faceController = new AvatarFaceController();
    this.meshes = [];
    this._visemeIndexCache = new WeakMap();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register meshes that have morph targets. Call after model loads.
   * @param {THREE.Mesh[]} allMorphMeshes - meshes with morphTargetDictionary
   */
  initializeMeshes(allMorphMeshes) {
    this.meshes = allMorphMeshes;
    this.faceController.initializeMeshes(allMorphMeshes);
  }

  /**
   * Forward emotion data to the face controller.
   * @param {object|null} emotionData - { primary, secondary, intensity, transitions }
   */
  setEmotionData(emotionData) {
    if (emotionData) {
      this.faceController.applyAIResponse(emotionData);
    }
  }

  /**
   * Set whether the avatar is currently speaking (for face emphasis).
   * @param {boolean} isSpeaking
   */
  setSpeaking(isSpeaking) {
    this.faceController.setSpeaking(isSpeaking);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // PER-FRAME UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Apply all face morphs to meshes. Call every frame from useFrame.
   *
   * @param {number} dt - delta time in seconds
   * @param {Record<string, number>} lipSyncMorphs - morph targets from useAudioDrivenLipSync
   */
  applyToMeshes(dt, lipSyncMorphs = {}) {
    // 1. Get face controller output (blink, emotion, idle micro-expressions)
    const faceMorphs = this.faceController.update(dt);

    // 2. Apply to all morph meshes
    for (const mesh of this.meshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
        continue;
      }

      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;

      // Get or build cached viseme index list for this mesh
      let visemeIndices = this._visemeIndexCache.get(mesh);
      if (!visemeIndices) {
        visemeIndices = [];
        for (const [name, index] of Object.entries(dict)) {
          const lower = name.toLowerCase();
          if (
            lower.startsWith('viseme_') ||
            lower.includes('jaw') ||
            lower.includes('mouth')
          ) {
            visemeIndices.push(index);
          }
        }
        this._visemeIndexCache.set(mesh, visemeIndices);
      }

      // SINGLE pass logic: Blend face expressions and audio visemes
      for (const [name, index] of Object.entries(dict)) {
        const faceVal = faceMorphs[name] || 0;

        if (visemeIndices.includes(index)) {
          // Viseme/mouth target: blend expression AND lipsync additively
          const lipVal = lipSyncMorphs[name] || 0;
          const combined = Math.min(faceVal + lipVal, 1.0);
          infl[index] = THREE.MathUtils.lerp(infl[index], combined, Math.min(dt * 15, 1));
        } else {
          // Pure expression target, preserve blinks if present directly
          const isBlink = name === 'eyeBlinkLeft' || name === 'eyeBlinkRight';
          if (isBlink) {
            infl[index] = Math.max(0, Math.min(1, faceVal));
          } else {
            infl[index] = THREE.MathUtils.lerp(infl[index], faceVal, Math.min(dt * 6, 1));
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  dispose() {
    this.faceController.dispose();
    this.meshes = [];
    this._visemeIndexCache = new WeakMap();
  }

  // ═══════════════════════════════════════════════════════════════════════════
}

