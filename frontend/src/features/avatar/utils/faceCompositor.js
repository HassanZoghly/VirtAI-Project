import * as THREE from 'three';

/**
 * faceCompositor.js
 * Strict ownership model for face morph targets.
 * Ensures lip-sync visemes solely own the mouth/jaw while emotions own brows/cheeks.
 */

export class FaceCompositor {
  constructor() {
    this.channels = {
      viseme: {},
      emotion: {},
      blink: {}
    };
  }

  /**
   * Updates a specific facial channel.
   * @param {'viseme'|'emotion'|'blink'} channelName 
   * @param {Record<string, number>} data 
   */
  writeChannel(channelName, data) {
    if (this.channels[channelName]) {
      this.channels[channelName] = data;
    }
  }

  /**
   * Reads from the specified channel.
   * @param {'viseme'|'emotion'|'blink'} channelName
   */
  readChannel(channelName) {
    return this.channels[channelName] || {};
  }

  /**
   * Applies the composed frame to the specified meshes.
   * Emotion controller targets are applied, but visemes are STRICTLY excluded.
   * @param {THREE.Mesh[]} morphMeshes - Meshes with morphTargetInfluences
   * @param {number} delta - Delta time for smooth transitions
   */
  applyBaseEmotions(morphMeshes, delta) {
    const safeDt = THREE.MathUtils.clamp(delta || 0, 1 / 120, 1 / 15);
    
    // Merge emotion and blink channels. Visemes will be applied by the lip-sync engine.
    const combinedFace = { ...this.channels.emotion, ...this.channels.blink };
    
    for (const mesh of morphMeshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      
      for (const [name, value] of Object.entries(combinedFace)) {
        if (name in dict) {
          const idx = dict[name];
          const clamped = Math.max(0, Math.min(1, value));
          
          const isBlink = name === 'eyeBlinkLeft' || name === 'eyeBlinkRight';
          const isVisemeRelated = name.toLowerCase().startsWith('viseme_') || name.toLowerCase().includes('jaw') || name.toLowerCase().includes('mouth');
          
          if (isBlink) {
            infl[idx] = clamped;
          } else if (isVisemeRelated) {
            // Emotion controller must not write to viseme targets.
            continue;
          } else {
            // Muscle feel lerp: slower transition for deeper human feel
            infl[idx] = THREE.MathUtils.lerp(infl[idx], clamped, Math.min(safeDt * 6, 1));
          }
        }
      }
    }
  }
}

// Export a singleton instance for global rendering usage
export const faceCompositor = new FaceCompositor();
