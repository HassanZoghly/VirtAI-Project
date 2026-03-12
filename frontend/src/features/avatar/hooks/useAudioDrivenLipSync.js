/* eslint-disable no-console */
import { useEffect, useRef, useState } from 'react';

/**
 * useAudioDrivenLipSync - Enhanced lip sync with audio amplitude fallback
 *
 * This hook provides robust lip sync that works in two modes:
 * 1. When mouthCues exist: Use precise viseme timeline
 * 2. When mouthCues are missing/empty: Drive mouth with audio amplitude analysis
 *
 * Features:
 * - WebAudio AnalyserNode for real-time amplitude detection
 * - Smooth attack/release envelope to avoid jitter
 * - Drives viseme_aa (jaw open) + optional viseme_O/viseme_U blend
 * - Subtle body motion (head bob) synchronized with speech
 * - Clamps all values to [0, 1] for safety
 *
 * @param {React.RefObject} audioRef - Reference to HTMLAudioElement
 * @param {Array} mouthCues - Array of {start, end, value} for lip sync timeline
 * @param {boolean} isPlaying - Whether audio is currently playing
 * @returns {Object} { morphTargets, bodyMotion } - Morph targets and body motion values
 */
export function useAudioDrivenLipSync(audioRef, mouthCues = [], isPlaying = false) {
  const [morphTargets, setMorphTargets] = useState({});
  const [bodyMotion, setBodyMotion] = useState({ headBob: 0, chestBob: 0 });

  const animationFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const dataArrayRef = useRef(null);

  // Smoothing state for amplitude envelope
  const smoothedAmplitudeRef = useRef(0);
  const ATTACK_SPEED = 0.3; // How fast mouth opens
  const RELEASE_SPEED = 0.15; // How fast mouth closes (slower for natural look)

  // Body motion phase for subtle animation
  const bodyPhaseRef = useRef(0);

  // Setup WebAudio analyser when audio starts playing
  useEffect(() => {
    if (!isPlaying || !audioRef.current) {
      // Reset when not playing
      smoothedAmplitudeRef.current = 0;
      bodyPhaseRef.current = 0;
      return;
    }

    const audio = audioRef.current;

    // Create audio context and analyser (only once per audio element)
    if (!audioContextRef.current) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioContext();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256; // Small FFT for fast response
        analyserRef.current.smoothingTimeConstant = 0.3;

        const bufferLength = analyserRef.current.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);
      } catch (err) {
        console.error('[AudioDrivenLipSync] Failed to create AudioContext:', err);
        return;
      }
    }

    // Connect audio element to analyser (only if not already connected)
    if (!sourceRef.current && audioContextRef.current) {
      try {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      } catch (err) {
        // Source might already be connected, ignore error
        if (import.meta.env.DEV) {
          console.debug('[AudioDrivenLipSync] Audio source already connected');
        }
      }
    }

    return () => {
      // Cleanup: disconnect source when audio changes
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect();
        } catch (err) {
          // Ignore disconnect errors
        }
        sourceRef.current = null;
      }
    };
  }, [isPlaying, audioRef]);

  // Close AudioContext on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  // Main lip sync update loop
  useEffect(() => {
    if (!isPlaying || !audioRef.current) {
      // Reset morph targets when not playing
      setMorphTargets({});
      setBodyMotion({ headBob: 0, chestBob: 0 });
      return;
    }

    const hasMouthCues = mouthCues && mouthCues.length > 0;

    const updateLipSync = () => {
      if (!audioRef.current) {
        return;
      }

      const currentTime = audioRef.current.currentTime;
      let amplitude = 0;

      // Get audio amplitude if analyser is available
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        // Calculate RMS amplitude (focus on speech frequencies: 300Hz-3000Hz)
        // Bins 3-30 roughly correspond to this range at 44.1kHz sample rate
        let sum = 0;
        const startBin = 3;
        const endBin = Math.min(30, dataArrayRef.current.length);
        for (let i = startBin; i < endBin; i++) {
          sum += dataArrayRef.current[i] * dataArrayRef.current[i];
        }
        const rms = Math.sqrt(sum / (endBin - startBin));
        amplitude = Math.min(rms / 255, 1.0); // Normalize to [0, 1]
      }

      // Apply attack/release smoothing
      const targetAmplitude = amplitude;
      const speed = targetAmplitude > smoothedAmplitudeRef.current ? ATTACK_SPEED : RELEASE_SPEED;
      smoothedAmplitudeRef.current += (targetAmplitude - smoothedAmplitudeRef.current) * speed;
      const smoothAmplitude = Math.max(0, Math.min(1, smoothedAmplitudeRef.current));

      // Update body motion phase (subtle oscillation)
      bodyPhaseRef.current += 0.05;
      const bodyOscillation = Math.sin(bodyPhaseRef.current) * 0.5 + 0.5; // [0, 1]

      if (hasMouthCues) {
        // MODE 1: Use mouthCues with amplitude layer for liveliness
        const activeCue = findActiveCue(mouthCues, currentTime);

        if (activeCue) {
          // Scale viseme influence by audio amplitude so quiet speech = small mouth
          const amplitudeScale = 0.25 + smoothAmplitude * 0.75; // range [0.25, 1.0]

          setMorphTargets({
            [activeCue.value]: Math.min(amplitudeScale, 1.0),
          });
        } else {
          // Between cues: use amplitude-driven mouth (quieter)
          setMorphTargets({
            viseme_aa: smoothAmplitude * 0.45,
            viseme_O: smoothAmplitude * 0.2,
          });
        }
      } else {
        // MODE 2: Pure amplitude-driven lip sync (fallback when no mouthCues)
        const jawOpen = smoothAmplitude * 0.55; // Primary jaw movement
        const lipRound = smoothAmplitude * 0.25; // Secondary lip rounding
        const lipWide = smoothAmplitude * 0.15; // Tertiary lip widening

        setMorphTargets({
          viseme_aa: Math.min(jawOpen, 1.0),
          viseme_O: Math.min(lipRound, 1.0),
          viseme_U: Math.min(lipWide * 0.5, 1.0),
        });
      }

      // Update body motion (subtle head and chest bob)
      const headBobAmount = smoothAmplitude * 0.015 * bodyOscillation; // Very subtle
      const chestBobAmount = smoothAmplitude * 0.01 * bodyOscillation; // Even more subtle

      setBodyMotion({
        headBob: Math.min(headBobAmount, 0.02), // Clamp to max 2cm
        chestBob: Math.min(chestBobAmount, 0.015), // Clamp to max 1.5cm
      });

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

  return { morphTargets, bodyMotion };
}

/**
 * Find the active mouth cue at current time
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
  for (const cue of mouthCues) {
    if (currentTime >= cue.start && currentTime < cue.end) {
      return cue;
    }
  }

  return null;
}
