/**
 * animationRegistry.js — Simple animation metadata.
 *
 * No scoring weights, no priority levels, no cooldowns.
 * Just names, types, and paths for loading.
 */

const CACHE_BUST = import.meta.env.DEV ? `?v=${Date.now()}` : '';

export const ANIMATIONS = {
  idle: {
    name: 'idle',
    type: 'idle',
    path: `/models/animations/Idle/Idle.fbx${CACHE_BUST}`,
  },
  Talk_0: {
    name: 'Talk_0',
    type: 'talk',
    path: `/models/animations/Talk/Talk_0.fbx${CACHE_BUST}`,
  },
  Talk_1: {
    name: 'Talk_1',
    type: 'talk',
    path: `/models/animations/Talk/Talk_1.fbx${CACHE_BUST}`,
  },
  Talk_2: {
    name: 'Talk_2',
    type: 'talk',
    path: `/models/animations/Talk/Talk_2.fbx${CACHE_BUST}`,
  },
  Talk_3: {
    name: 'Talk_3',
    type: 'talk',
    path: `/models/animations/Talk/Talk_3.fbx${CACHE_BUST}`,
  },
  Talk_4: {
    name: 'Talk_4',
    type: 'talk',
    path: `/models/animations/Talk/Talk_4.fbx${CACHE_BUST}`,
  },
  Talk_5: {
    name: 'Talk_5',
    type: 'talk',
    path: `/models/animations/Talk/Talk_5.fbx${CACHE_BUST}`,
  },
  Talk_6: {
    name: 'Talk_6',
    type: 'talk',
    path: `/models/animations/Talk/Talk_6.fbx${CACHE_BUST}`,
  },
};

/**
 * Get all animation entries of a given type.
 * @param {'idle' | 'talk'} type
 * @returns {Array<{ name: string, type: string, path: string }>}
 */
export function getAnimationsByType(type) {
  return Object.values(ANIMATIONS).filter((a) => a.type === type);
}

/**
 * Get a single animation entry by name.
 * @param {string} name
 * @returns {{ name: string, type: string, path: string } | null}
 */
export function getAnimation(name) {
  return ANIMATIONS[name] || null;
}
