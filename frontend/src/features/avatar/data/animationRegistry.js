/**
 * animationRegistry.js — Simple animation metadata.
 *
 * No scoring weights, no priority levels, no cooldowns.
 * Just names, types, and paths for loading.
 */

const CACHE_BUST = import.meta.env.DEV ? `?v=${Date.now()}` : '';

export const REQUIRED_TALK_ANIMATION_NAMES = ['Talk_1', 'Talk_2'];

export const ANIMATIONS = {
  idle: {
    name: 'idle',
    type: 'idle',
    path: `/models/animations/Idle/Idle.fbx${CACHE_BUST}`,
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
  }
};

export function getMissingTalkAnimationNames(animations = ANIMATIONS) {
  return REQUIRED_TALK_ANIMATION_NAMES.filter((name) => {
    const animation = animations[name];
    return !animation || animation.type !== 'talk' || !animation.path;
  });
}

export function formatMissingTalkAnimationsWarning(missingNames) {
  return missingNames.map((name) => `${name} missing`).join('; ');
}

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
