import { ANIMATION_REGISTRY } from '../data/animationRegistry';

/**
 * animationSelector.js
 * 
 * Implements semantic tag matching, weighted scoring, and cooldown/anti-repetition
 * memory to intelligently select animations (especially talk variants) based on intents.
 */

export class AnimationSelector {
  constructor() {
    this.playHistory = new Map(); // key: animationId, value: timestamp of last play
  }

  /**
   * Selects the best animation for a given category and set of intents.
   * 
   * @param {string} category - The animation category (e.g., 'talk')
   * @param {string[]} intents - The desired semantic intents (e.g., ['explain', 'positive'])
   * @returns {string|null} - The ID of the selected animation
   */
  selectAnimation(category, intents = []) {
    const candidates = Object.values(ANIMATION_REGISTRY).filter(
      (anim) => anim.category === category
    );

    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      this.playHistory.set(candidates[0].id, Date.now());
      return candidates[0].id;
    }

    const now = Date.now();
    let maxScore = -Infinity;

    // 1. Score each candidate
    const scoredCandidates = candidates.map((anim) => {
      let score = anim.baseWeight || 1.0;

      // Semantic Tag Matching
      let tagMatchCount = 0;
      if (intents && intents.length > 0 && anim.tags) {
        for (const intent of intents) {
          if (anim.tags.includes(intent.toLowerCase())) {
            tagMatchCount++;
          }
        }
        // Heavily reward direct semantic overlap
        score += tagMatchCount * 5.0;
      }

      // Cooldown / Anti-repetition Penalty
      const lastPlayed = this.playHistory.get(anim.id) || 0;
      const timeSinceLastPlay = now - lastPlayed;
      const cooldownMs = anim.cooldownMs || 3000;
      
      if (timeSinceLastPlay < cooldownMs) {
        // Linear penalty based on how recently it was played
        const penalty = (cooldownMs - timeSinceLastPlay) / cooldownMs;
        score -= penalty * 10.0; // Severe penalty to prevent immediate looping
      } else {
        // Slight freshness bonus for animations that haven't been seen in a while (cap at 10s)
        const freshness = Math.min(timeSinceLastPlay / 10000, 1.0);
        score += freshness * 0.5;
      }

      // Fallback: If no intents match, slightly boost 'neutral' to ensure safe defaults
      if (tagMatchCount === 0 && anim.tags?.includes('neutral')) {
        score += 1.0;
      }

      if (score > maxScore) {
        maxScore = score;
      }

      return { id: anim.id, score };
    });

    // 2. Softmax-like Selection
    // We drop candidates that scored significantly worse than the best score
    // to prevent choosing totally inappropriate animations, while still allowing variety.
    const temperature = 1.2; // Higher = more random, Lower = more deterministic
    let weightSum = 0;
    
    const validCandidates = scoredCandidates
      .filter(c => c.score >= maxScore - 4.0)
      .map(c => {
        const weight = Math.exp(c.score / temperature);
        weightSum += weight;
        return { ...c, weight };
      });

    // 3. Roll the dice
    let roll = Math.random() * weightSum;
    let selectedId = validCandidates[0].id;
    
    for (const candidate of validCandidates) {
      roll -= candidate.weight;
      if (roll <= 0) {
        selectedId = candidate.id;
        break;
      }
    }

    // 4. Update memory
    this.playHistory.set(selectedId, now);
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimationSelector] Picked '${selectedId}' for category '${category}' with intents:`, intents);
    }
    
    return selectedId;
  }
  
  clearHistory() {
    this.playHistory.clear();
  }
}

// Singleton for easy import across the scene
export const animationSelector = new AnimationSelector();
