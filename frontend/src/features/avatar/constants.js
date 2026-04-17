/** Duration (seconds) for animation cross-fade in/out. */
export const CROSSFADE_DURATION = 0.15;

/** Smoothing factor (0-1) for morph target interpolation. Higher = faster response. */
export const MORPH_SMOOTHING = 0.4;

/**
 * Cross-fade durations (seconds) per transition type.
 * Longer fades = smoother blends between states.
 */
export const TRANSITION_FADE = {
  'idle→talk':     0.35,
  'talk→idle':     0.55,  // longer wind-down to avoid pop on speech end
  'talk→talk':     0.45,  // smooth blend when switching talk variants between responses
  'idle→greeting': 0.3,
  'greeting→idle': 0.4,
  'idle→think':    0.4,
  'think→idle':    0.5,
  'think→talk':    0.35,
  'talk→think':    0.45,
  default:         0.35,
};

/**
 * Get transition fade duration between two animation states.
 * @param {string} from - Source state name
 * @param {string} to - Target state name
 * @returns {number} Fade duration in seconds
 */
export function getTransitionFade(from, to) {
  return TRANSITION_FADE[`${from}→${to}`] ?? TRANSITION_FADE.default;
}

/**
 * Animation metadata registry.
 * Each entry: { id, category, weight, canFollowIds? }
 * weight: relative probability for random selection (higher = more likely)
 * canFollowIds: optional whitelist of animation IDs that can follow this one
 */
export const ANIMATION_METADATA = {
  idle: { id: 'idle', category: 'idle', weight: 1 },
  thinking: { id: 'thinking', category: 'think', weight: 1 },
  greeting: { id: 'greeting', category: 'greeting', weight: 1 },
  talk1: { id: 'talk1', category: 'talk', weight: 1.0 },
  talk2: { id: 'talk2', category: 'talk', weight: 1.0 },
  talk3: { id: 'talk3', category: 'talk', weight: 1.0 },
  talk4: { id: 'talk4', category: 'talk', weight: 1.0 },
  talk5: { id: 'talk5', category: 'talk', weight: 0.8 },
  talk6: { id: 'talk6', category: 'talk', weight: 0.8 },
  talk7: { id: 'talk7', category: 'talk', weight: 0.8 },
};

/**
 * Get all animations for a given category.
 * @param {string} category - 'idle', 'talk', 'greeting', 'think'
 * @returns {Array<{id: string, category: string, weight: number}>}
 */
export function getAnimationsByCategory(category) {
  return Object.values(ANIMATION_METADATA).filter((a) => a.category === category);
}

/**
 * Pick a weighted-random animation from a category, avoiding consecutive repeats.
 * @param {string} category - e.g. 'talk'
 * @param {string|null} lastPlayedId - ID of the last played animation (to avoid repeats)
 * @returns {string} Animation ID (e.g. 'talk3')
 */
export function pickWeightedRandom(category, lastPlayedId = null) {
  let pool = getAnimationsByCategory(category);
  if (pool.length === 0) {
    return null;
  }

  // Avoid consecutive repeat if more than one option
  if (pool.length > 1 && lastPlayedId) {
    pool = pool.filter((a) => a.id !== lastPlayedId);
  }

  const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const anim of pool) {
    rand -= anim.weight;
    if (rand <= 0) {
      return anim.id;
    }
  }
  return pool[pool.length - 1].id;
}
