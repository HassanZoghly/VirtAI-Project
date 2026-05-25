import { ANIMATION_REGISTRY } from '../data/animationRegistry';

/**
 * animationSelector.js
 * 
 * Implements semantic tag matching, weighted scoring, and cooldown/anti-repetition
 * memory to intelligently select animations (especially talk variants) based on intents.
 */

export class AnimationSelector {
  constructor() {
    this.playHistory = []; // Array of last N animationIds, index 0 is most recent
    this.maxHistorySize = 5;
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
      this.playHistory.unshift(candidates[0].id);
      if (this.playHistory.length > this.maxHistorySize) {
        this.playHistory.pop();
      }
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

      // Cooldown / Anti-repetition Penalty using a rolling window
      let repetitionPenalty = 0;
      let isRecent = false;
      
      // Look backward through the last N gestures
      for (let i = 0; i < this.playHistory.length; i++) {
        if (this.playHistory[i] === anim.id) {
          isRecent = true;
          // Exponential penalty based on recency:
          // The most recent gesture (i=0) gets the highest penalty
          const penaltyWeight = Math.pow(0.5, i);
          repetitionPenalty += penaltyWeight * 10.0;
        }
      }
      
      score -= repetitionPenalty;

      if (!isRecent) {
        // Slight freshness bonus for animations that aren't in the recent history
        score += 0.5;
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
    this.playHistory.unshift(selectedId);
    if (this.playHistory.length > this.maxHistorySize) {
      this.playHistory.pop();
    }
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimationSelector] Picked '${selectedId}' for category '${category}' with intents:`, intents);
    }
    
    return selectedId;
  }
  
  clearHistory() {
    this.playHistory = [];
  }
}

// Singleton for easy import across the scene
export const animationSelector = new AnimationSelector();
