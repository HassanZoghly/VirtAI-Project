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

  /**
   * Trigger an immediate blink (e.g., from saccade coupling).
   */
  triggerBlink() {
    this.faceController.triggerBlink();
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

      // ── Pass 1: Apply face morphs (blink, emotion, idle) ──────────────
      for (const [name, value] of Object.entries(faceMorphs)) {
        if (!(name in dict)) continue;
        const idx = dict[name];
        const clamped = Math.max(0, Math.min(1, value));

        const isBlink = name === 'eyeBlinkLeft' || name === 'eyeBlinkRight';
        const isVisemeRelated =
          name.startsWith('viseme_') ||
          name.includes('jaw') ||
          name.includes('mouth');

        if (isBlink) {
          // Blinks are applied directly (no smoothing)
          infl[idx] = clamped;
        } else if (isVisemeRelated) {
          // Skip — viseme/mouth morphs are handled by lip sync below
          continue;
        } else {
          // Smooth transition for expression morphs
          infl[idx] = THREE.MathUtils.lerp(
            infl[idx],
            clamped,
            Math.min(dt * 6, 1)
          );
        }
      }

      // ── Pass 2: Apply lip sync morphs ─────────────────────────────────
      this._applyLipSyncToMesh(mesh, lipSyncMorphs);
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
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Apply lip sync morph targets to a single mesh.
   * Resets all viseme-related morphs toward zero first, then applies active values.
   */
  _applyLipSyncToMesh(mesh, morphTargets) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
      return;
    }

    const dict = mesh.morphTargetDictionary;
    const infl = mesh.morphTargetInfluences;
    const resetSpeed = 0.15;

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

    // Reset all viseme morphs toward zero
    for (const index of visemeIndices) {
      if (index < 0 || index >= infl.length) continue;
      const current = infl[index];
      infl[index] = Math.max(0, Math.min(1, THREE.MathUtils.lerp(current, 0, resetSpeed)));
    }

    // Apply active lip sync values
    for (const [visemeName, targetValue] of Object.entries(morphTargets)) {
      const index = dict[visemeName];
      if (index === undefined || index < 0 || index >= infl.length) continue;

      const clampedTarget = Math.max(0, Math.min(1, targetValue)) * 0.75;
      const current = infl[index];
      infl[index] = Math.max(
        0,
        Math.min(1, THREE.MathUtils.lerp(current, clampedTarget, 0.15))
      );
    }
  }
}
