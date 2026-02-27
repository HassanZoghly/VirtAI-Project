import { useState, useEffect, useRef } from 'react';

/**
 * useLipSync - Custom hook for lip sync with morph targets
 *
 * This hook updates morph targets in sync with audio playback using mouthCues timeline.
 * It uses requestAnimationFrame to check the current audio time and find the active cue.
 *
 * @param {React.RefObject} audioRef - Reference to HTMLAudioElement
 * @param {Array} mouthCues - Array of {start, end, value} for lip sync timeline
 * @param {boolean} isPlaying - Whether audio is currently playing
 * @returns {Object} morphTargets - Object mapping viseme names to influence values (0-1)
 */
export function useLipSync(audioRef, mouthCues = [], isPlaying = false) {
  const [morphTargets, setMorphTargets] = useState({});
  const animationFrameRef = useRef(null);

  useEffect(() => {
    // If not playing or no cues, reset morph targets
    if (!isPlaying || !mouthCues || mouthCues.length === 0) {
      setMorphTargets({});
      return;
    }

    // If no audio element, reset
    if (!audioRef.current) {
      setMorphTargets({});
      return;
    }

    // Update morph targets in sync with audio playback
    const updateLipSync = () => {
      if (!audioRef.current) {
        return;
      }

      const currentTime = audioRef.current.currentTime;

      // Find active cue at current time
      const activeCue = findActiveCue(mouthCues, currentTime);

      if (activeCue) {
        // Set morph target for active viseme with full influence
        setMorphTargets({
          [activeCue.value]: 1.0,
        });
      } else {
        // No active cue, smooth transition to neutral (empty object)
        setMorphTargets({});
      }

      // Continue updating
      animationFrameRef.current = requestAnimationFrame(updateLipSync);
    };

    // Start lip sync loop
    animationFrameRef.current = requestAnimationFrame(updateLipSync);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioRef, mouthCues, isPlaying]);

  return morphTargets;
}

/**
 * Find the active mouth cue at current time
 *
 * This function searches through the mouthCues array to find the cue
 * that is active at the current audio time.
 *
 * @param {Array} mouthCues - Array of {start, end, value} sorted by start time
 * @param {number} currentTime - Current audio time in seconds
 * @returns {Object|null} Active cue or null if no cue is active
 */
function findActiveCue(mouthCues, currentTime) {
  if (!mouthCues || mouthCues.length === 0) {
    return null;
  }

  // Find cue where start <= currentTime < end
  // Linear search is acceptable since we're checking every frame
  for (const cue of mouthCues) {
    if (currentTime >= cue.start && currentTime < cue.end) {
      return cue;
    }
  }

  return null;
}
