/**
 * Bug Condition Exploration Test for Animation Name Resolution
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 * 
 * CHECKPOINT (Task 4): After the fix is implemented, these tests should PASS
 * 
 * This test validates that the actual implementation in AvatarScene.jsx correctly handles
 * animation name mismatches using fuzzy matching.
 * 
 * GOAL: Verify the fix works correctly with the actual implementation
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveAnimationName, ANIMATION_ALIASES } from './AvatarScene.jsx';

/**
 * Simulates the playAction behavior using the actual resolveAnimationName implementation
 */
function playAction_actual(requestedName, availableClips, fallbackMap = {}) {
  // Try to resolve the requested name using the actual implementation
  let resolvedName = resolveAnimationName(requestedName, availableClips);
  
  // If not resolved, try fallback
  if (!resolvedName && fallbackMap[requestedName]) {
    resolvedName = resolveAnimationName(fallbackMap[requestedName], availableClips);
  }
  
  if (!resolvedName) {
    return { success: false, error: `Animation '${requestedName}' not found` };
  }

  return { success: true, clipName: resolvedName };
}

/**
 * Bug Condition A: Animation Clip Name Mismatch
 * Returns true when the bug condition is present
 */
function isBugCondition_A(requestedName, availableClips) {
  const requested = requestedName.toLowerCase();
  
  // Bug exists when:
  // 1. Requesting 'talk' or 'speaking'
  // 2. Exact name not in available clips
  // 3. But a fuzzy match exists
  if (!['talk', 'speaking'].includes(requested)) {
    return false;
  }
  
  // Check if exact match exists
  if (availableClips.some(clip => clip.toLowerCase() === requested)) {
    return false;
  }
  
  // Check if fuzzy match exists
  const fuzzyKeywords = ['talk', 'speaking', 'speak', 'talking', 'idle_talking', 'talk_retargeted'];
  const hasFuzzyMatch = availableClips.some(clip => 
    fuzzyKeywords.some(keyword => clip.toLowerCase().includes(keyword))
  );
  
  return hasFuzzyMatch;
}

describe('Bug A: Animation Name Resolution - Preservation Tests', () => {
  describe('Property 2: Preservation - Exact Name Match Behavior', () => {
    it('PRESERVATION: playAction("idle") works when FBX contains "idle"', () => {
      const requestedName = 'idle';
      const availableClips = ['idle', 'talk', 'greeting'];
      const fallbackMap = { speaking: 'talk' };
      
      // Verify this is NOT a bug condition (exact match exists)
      expect(isBugCondition_A(requestedName, availableClips)).toBe(false);
      
      // Test actual implementation
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      // Should succeed with exact match
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('idle');
    });

    it('PRESERVATION: playAction("greeting") works when FBX contains "greeting"', () => {
      const requestedName = 'greeting';
      const availableClips = ['idle', 'talk', 'greeting'];
      const fallbackMap = { speaking: 'talk' };
      
      expect(isBugCondition_A(requestedName, availableClips)).toBe(false);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('greeting');
    });

    it('PRESERVATION: playAction("talk") works when FBX contains "talk"', () => {
      const requestedName = 'talk';
      const availableClips = ['idle', 'talk', 'greeting'];
      const fallbackMap = { speaking: 'talk' };
      
      expect(isBugCondition_A(requestedName, availableClips)).toBe(false);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('talk');
    });

    it('PRESERVATION: Fallback mechanism works when exact match exists', () => {
      const requestedName = 'thinking';
      const availableClips = ['idle', 'talk', 'greeting'];
      const fallbackMap = { thinking: 'idle' };
      
      // Not a bug condition because 'thinking' is not in ['talk', 'speaking']
      // and fallback 'idle' exists exactly
      expect(isBugCondition_A(requestedName, availableClips)).toBe(false);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('idle');
    });

    it('PRESERVATION: Case-sensitive exact match works', () => {
      const requestedName = 'Idle';
      const availableClips = ['Idle', 'Talk', 'Greeting'];
      const fallbackMap = {};
      
      // Actual implementation uses case-insensitive matching
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('Idle');
    });
  });

  describe('Property-Based Test: Preservation - Exact Name Matches', () => {
    it('PBT: For all animations with exact name matches, behavior is correct', () => {
      // Generator for animation names that exist exactly in clips
      const exactMatchGen = fc.constantFrom('idle', 'talk', 'greeting', 'Idle', 'Talk', 'Greeting');
      
      // Generator for clip arrays that contain the requested animation
      const clipsWithMatchGen = fc.array(
        fc.constantFrom('idle', 'talk', 'greeting', 'wave', 'thinking'),
        { minLength: 1, maxLength: 5 }
      );

      // Property: When exact match exists, actual implementation succeeds
      fc.assert(
        fc.property(
          exactMatchGen,
          clipsWithMatchGen,
          (requestedName, baseClips) => {
            // Ensure the requested animation is in the clips
            const availableClips = Array.from(new Set([requestedName, ...baseClips]));
            const fallbackMap = { speaking: 'talk', thinking: 'idle' };

            // Only test when bug condition is NOT present (exact match exists)
            if (isBugCondition_A(requestedName, availableClips)) {
              return true; // Skip this case
            }

            const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);

            // Should succeed with exact match
            return actualResult.success === true;
          }
        ),
        { numRuns: 100 } // Run 100 test cases for strong guarantees
      );
    });

    it('PBT: For all fallback scenarios with exact matches, behavior is correct', () => {
      // Generator for animation names that use fallback
      const fallbackNameGen = fc.constantFrom('speaking', 'thinking');
      
      // Generator for clip arrays
      const clipsGen = fc.array(
        fc.constantFrom('idle', 'talk', 'greeting', 'wave'),
        { minLength: 1, maxLength: 5 }
      );

      // Property: When fallback resolves to exact match, behavior is correct
      fc.assert(
        fc.property(
          fallbackNameGen,
          clipsGen,
          (requestedName, baseClips) => {
            const fallbackMap = { speaking: 'talk', thinking: 'idle' };
            const fallbackName = fallbackMap[requestedName];
            
            // Ensure fallback animation is in clips (exact match)
            const availableClips = Array.from(new Set([fallbackName, ...baseClips]));

            // Only test when bug condition is NOT present
            if (isBugCondition_A(requestedName, availableClips)) {
              return true; // Skip this case
            }

            const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);

            // Should succeed with fallback
            return actualResult.success === true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('PBT: For all non-talk/speaking animations, behavior is correct', () => {
      // Generator for animations that are NOT affected by the bug
      const nonBuggyAnimGen = fc.constantFrom('idle', 'greeting', 'wave', 'thinking');
      
      // Generator for clip arrays
      const clipsGen = fc.array(
        fc.constantFrom('idle', 'greeting', 'wave', 'thinking', 'jump', 'run'),
        { minLength: 1, maxLength: 5 }
      );

      // Property: Non-talk/speaking animations work correctly
      fc.assert(
        fc.property(
          nonBuggyAnimGen,
          clipsGen,
          (requestedName, baseClips) => {
            // Ensure requested animation is in clips
            const availableClips = Array.from(new Set([requestedName, ...baseClips]));
            const fallbackMap = { speaking: 'talk', thinking: 'idle' };

            const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);

            // Should succeed
            return actualResult.success === true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('Bug A: Animation Name Resolution - Fault Condition Exploration', () => {
  describe('Property 1: Fault Condition - Animation Clip Name Mismatch (FIXED)', () => {
    it('FIX VERIFICATION: request "talk" succeeds when FBX contains "Talk_Retargeted"', () => {
      // Concrete failing case from bug report - should now PASS with fix
      const requestedName = 'talk';
      const availableClips = ['Talk_Retargeted', 'idle', 'greeting'];
      const fallbackMap = { speaking: 'talk' };
      
      // Verify this is a bug condition (would fail without fix)
      expect(isBugCondition_A(requestedName, availableClips)).toBe(true);
      
      // Test actual implementation - should succeed with fuzzy matching
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      // CRITICAL: Should PASS with the fix
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('Talk_Retargeted');
    });

    it('FIX VERIFICATION: request "talk" succeeds when FBX contains "TALKING"', () => {
      const requestedName = 'talk';
      const availableClips = ['TALKING', 'idle'];
      const fallbackMap = { speaking: 'talk' };
      
      expect(isBugCondition_A(requestedName, availableClips)).toBe(true);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      // Should succeed with fuzzy matching
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('TALKING');
    });

    it('FIX VERIFICATION: request "talk" succeeds when FBX contains only "Speak_Animation"', () => {
      const requestedName = 'talk';
      const availableClips = ['Speak_Animation']; // Only one clip
      const fallbackMap = { speaking: 'talk' };
      
      expect(isBugCondition_A(requestedName, availableClips)).toBe(true);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      // Should succeed with auto-select (single clip)
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('Speak_Animation');
    });

    it('FIX VERIFICATION: request "speaking" with fallback succeeds when FBX contains "Idle_Talking"', () => {
      const requestedName = 'speaking';
      const availableClips = ['Idle_Talking', 'idle', 'greeting'];
      const fallbackMap = { speaking: 'talk' };
      
      // Bug condition: 'speaking' not in clips, fallback 'talk' not in clips, but fuzzy match exists
      expect(isBugCondition_A(requestedName, availableClips)).toBe(true);
      
      const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);
      
      // Should succeed with fuzzy matching on fallback
      expect(actualResult.success).toBe(true);
      expect(actualResult.clipName).toBe('Idle_Talking');
    });
  });

  describe('Property-Based Test: Scoped PBT for Animation Name Mismatch (FIXED)', () => {
    it('PBT: For all inputs where bug condition holds, actual implementation succeeds with fuzzy matching', () => {
      // Generator for clip names that would cause the bug without fuzzy matching
      const mismatchedClipNameGen = fc.oneof(
        fc.constant('Talk_Retargeted'),
        fc.constant('TALKING'),
        fc.constant('Speak_Animation'),
        fc.constant('Idle_Talking'),
        fc.constant('talk_anim'),
        fc.constant('Speaking_Idle')
      );

      // Generator for other animation clips
      const otherClipsGen = fc.array(
        fc.oneof(
          fc.constant('idle'),
          fc.constant('greeting'),
          fc.constant('Idle'),
          fc.constant('Wave')
        ),
        { minLength: 0, maxLength: 3 }
      );

      // Property: When bug condition exists, actual implementation succeeds with fuzzy matching
      fc.assert(
        fc.property(
          mismatchedClipNameGen,
          otherClipsGen,
          fc.constantFrom('talk', 'speaking'),
          (mismatchedClip, otherClips, requestedName) => {
            const availableClips = [mismatchedClip, ...otherClips];
            const fallbackMap = { speaking: 'talk' };

            // Only test when bug condition is present
            if (!isBugCondition_A(requestedName, availableClips)) {
              return true; // Skip this case
            }

            const actualResult = playAction_actual(requestedName, availableClips, fallbackMap);

            // With the fix, should succeed and resolve to the mismatched clip
            return actualResult.success === true && actualResult.clipName === mismatchedClip;
          }
        ),
        { numRuns: 50 } // Run 50 test cases
      );
    });
  });
});
