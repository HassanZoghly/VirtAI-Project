import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * useRealismEnhancements - Adds coarticulation, jaw coupling, blinks, and subtle head/eye motion
 *
 * Features:
 * - Coarticulation: Blend between current and next viseme near boundaries
 * - Jaw coupling: Add jawOpen when viseme is AA/E/I/O/U
 * - Subtle random blinks (if eyeBlink morph exists)
 * - Slow eye look-at camera (if LeftEye/RightEye bones exist)
 * - Tiny head bob on Head bone only (never Spine)
 *
 * @param {THREE.Scene} scene - The loaded avatar scene
 * @param {Object} baseMorphTargets - Base morph targets from lip sync
 * @param {boolean} isPlaying - Whether audio is playing
 * @param {React.RefObject} audioRef - Reference to audio element
 * @param {Array} mouthCues - Mouth cues for coarticulation
 * @returns {Object} Enhanced morph targets with realism features
 */
export function useRealismEnhancements(scene, baseMorphTargets, isPlaying, audioRef, mouthCues) {
  const [enhancedTargets, setEnhancedTargets] = useState({});
  
  // Refs for bones
  const headBoneRef = useRef(null);
  const leftEyeBoneRef = useRef(null);
  const rightEyeBoneRef = useRef(null);
  
  // Refs for morph target meshes
  const headMeshRef = useRef(null);
  
  // Blink state
  const nextBlinkTimeRef = useRef(0);
  const blinkDurationRef = useRef(0);
  const isBlinkingRef = useRef(false);
  
  // Head bob state
  const headBobPhaseRef = useRef(0);
  
  // Eye look-at state
  const eyeLookPhaseRef = useRef(0);
  
  // Animation frame
  const frameRef = useRef(null);

  // Find bones and meshes on scene load
  useEffect(() => {
    if (!scene) return;

    scene.traverse((o) => {
      // Find head bone
      if (o.isBone && o.name.toLowerCase().includes('head') && !headBoneRef.current) {
        headBoneRef.current = o;
        if (import.meta.env.DEV) {
          console.debug('[RealismEnhancements] Found head bone:', o.name);
        }
      }
      
      // Find eye bones
      if (o.isBone) {
        const nameLower = o.name.toLowerCase();
        if ((nameLower.includes('lefteye') || nameLower.includes('eye_l')) && !leftEyeBoneRef.current) {
          leftEyeBoneRef.current = o;
          if (import.meta.env.DEV) {
            console.debug('[RealismEnhancements] Found left eye bone:', o.name);
          }
        }
        if ((nameLower.includes('righteye') || nameLower.includes('eye_r')) && !rightEyeBoneRef.current) {
          rightEyeBoneRef.current = o;
          if (import.meta.env.DEV) {
            console.debug('[RealismEnhancements] Found right eye bone:', o.name);
          }
        }
      }
      
      // Find head mesh for blink morphs
      if ((o.isMesh || o.isSkinnedMesh) && o.morphTargetDictionary) {
        const nameLower = o.name.toLowerCase();
        if (nameLower.includes('head') && !headMeshRef.current) {
          headMeshRef.current = o;
          if (import.meta.env.DEV) {
            const hasEyeBlink = Object.keys(o.morphTargetDictionary).some(k => 
              k.toLowerCase().includes('eyeblink') || k.toLowerCase().includes('blink')
            );
            console.debug('[RealismEnhancements] Found head mesh, has blink morphs:', hasEyeBlink);
          }
        }
      }
    });
  }, [scene]);

  // Main enhancement loop
  useEffect(() => {
    const updateEnhancements = () => {
      const now = performance.now();
      const enhanced = { ...baseMorphTargets };

      // 1. COARTICULATION: Blend between current and next viseme near boundaries
      if (isPlaying && audioRef?.current && mouthCues && mouthCues.length > 0) {
        const currentTime = audioRef.current.currentTime;
        const activeCue = findActiveCue(mouthCues, currentTime);
        
        if (activeCue) {
          const timeInCue = currentTime - activeCue.start;
          const cueDuration = activeCue.end - activeCue.start;
          const timeUntilEnd = activeCue.end - currentTime;
          
          // Blend with next viseme in last 80ms
          if (timeUntilEnd < 0.08 && timeUntilEnd > 0) {
            const nextCue = findNextCue(mouthCues, currentTime);
            if (nextCue) {
              const blendFactor = 1 - (timeUntilEnd / 0.08); // 0 to 1
              const currentValue = enhanced[activeCue.value] || 0;
              const nextValue = 0.5; // Anticipate next viseme
              
              enhanced[activeCue.value] = currentValue * (1 - blendFactor * 0.3);
              enhanced[nextCue.value] = nextValue * blendFactor * 0.3;
            }
          }
        }
      }

      // 2. JAW COUPLING: Add jawOpen when viseme is AA/E/I/O/U
      const openVowels = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];
      let maxVowelInfluence = 0;
      for (const vowel of openVowels) {
        if (enhanced[vowel]) {
          maxVowelInfluence = Math.max(maxVowelInfluence, enhanced[vowel]);
        }
      }
      
      if (maxVowelInfluence > 0) {
        // Add subtle jaw open coupling
        enhanced.jawOpen = Math.min((enhanced.jawOpen || 0) + maxVowelInfluence * 0.3, 1.0);
      }

      // 3. SUBTLE RANDOM BLINKS
      if (headMeshRef.current && headMeshRef.current.morphTargetDictionary) {
        const blinkKeys = Object.keys(headMeshRef.current.morphTargetDictionary).filter(k =>
          k.toLowerCase().includes('eyeblink') || k.toLowerCase().includes('blink')
        );
        
        if (blinkKeys.length > 0) {
          // Schedule next blink
          if (now >= nextBlinkTimeRef.current && !isBlinkingRef.current) {
            isBlinkingRef.current = true;
            blinkDurationRef.current = 80 + Math.random() * 40; // 80-120ms
            nextBlinkTimeRef.current = now + blinkDurationRef.current + 2000 + Math.random() * 3000; // 2-5s between blinks
          }
          
          // Apply blink
          if (isBlinkingRef.current) {
            const blinkProgress = (now - (nextBlinkTimeRef.current - blinkDurationRef.current - 2000 - Math.random() * 3000)) / blinkDurationRef.current;
            
            if (blinkProgress >= 1) {
              isBlinkingRef.current = false;
              // Reset blink morphs
              for (const key of blinkKeys) {
                enhanced[key] = 0;
              }
            } else {
              // Blink curve: quick close, slower open
              const blinkValue = blinkProgress < 0.3 
                ? blinkProgress / 0.3 // Close quickly
                : 1 - ((blinkProgress - 0.3) / 0.7); // Open slowly
              
              for (const key of blinkKeys) {
                enhanced[key] = Math.min(blinkValue, 1.0);
              }
            }
          }
        }
      }

      // 4. TINY HEAD BOB (Head bone only, never Spine) - DISABLED to prevent ugly motion
      // The head motion is now handled entirely by applySubtleHeadMotion in AvatarScene.jsx
      // This prevents conflicting motion from two different systems
      
      // 5. SLOW EYE LOOK-AT CAMERA (subtle) - REDUCED for more natural look
      if (leftEyeBoneRef.current && rightEyeBoneRef.current && isPlaying) {
        eyeLookPhaseRef.current += 0.005; // Slower (was 0.01)
        const lookX = Math.sin(eyeLookPhaseRef.current) * 0.025; // Reduced (was 0.05)
        const lookY = Math.cos(eyeLookPhaseRef.current * 0.7) * 0.015; // Reduced (was 0.03)
        
        // Apply to eye bones with smooth interpolation
        leftEyeBoneRef.current.rotation.x = THREE.MathUtils.lerp(leftEyeBoneRef.current.rotation.x, lookY, 0.05);
        leftEyeBoneRef.current.rotation.y = THREE.MathUtils.lerp(leftEyeBoneRef.current.rotation.y, lookX, 0.05);
        rightEyeBoneRef.current.rotation.x = THREE.MathUtils.lerp(rightEyeBoneRef.current.rotation.x, lookY, 0.05);
        rightEyeBoneRef.current.rotation.y = THREE.MathUtils.lerp(rightEyeBoneRef.current.rotation.y, lookX, 0.05);
      } else if (leftEyeBoneRef.current && rightEyeBoneRef.current) {
        // Return to neutral
        leftEyeBoneRef.current.rotation.x *= 0.95;
        leftEyeBoneRef.current.rotation.y *= 0.95;
        rightEyeBoneRef.current.rotation.x *= 0.95;
        rightEyeBoneRef.current.rotation.y *= 0.95;
      }

      setEnhancedTargets(enhanced);
      frameRef.current = requestAnimationFrame(updateEnhancements);
    };

    frameRef.current = requestAnimationFrame(updateEnhancements);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [baseMorphTargets, isPlaying, audioRef, mouthCues, scene]);

  return enhancedTargets;
}

/**
 * Find the active mouth cue at current time
 */
function findActiveCue(mouthCues, currentTime) {
  if (!mouthCues || mouthCues.length === 0) return null;
  
  for (const cue of mouthCues) {
    if (currentTime >= cue.start && currentTime < cue.end) {
      return cue;
    }
  }
  return null;
}

/**
 * Find the next mouth cue after current time
 */
function findNextCue(mouthCues, currentTime) {
  if (!mouthCues || mouthCues.length === 0) return null;
  
  for (const cue of mouthCues) {
    if (cue.start > currentTime) {
      return cue;
    }
  }
  return null;
}
