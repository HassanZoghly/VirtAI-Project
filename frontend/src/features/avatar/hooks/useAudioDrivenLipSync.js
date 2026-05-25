/* eslint-disable no-console */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TARGET_UPDATE_INTERVAL_MS = 1000 / 60; // Increased to 60fps for smoother muscle movement
const NOISE_FLOOR = 0.03;
const VISEME_SMOOTHING = 0.25; // Muscle elasticity factor

const VISEME_ID_TO_MORPH = {
  0: 'viseme_sil',
  1: 'viseme_PP',
  2: 'viseme_FF',
  3: 'viseme_TH',
  4: 'viseme_DD',
  5: 'viseme_kk',
  6: 'viseme_CH',
  7: 'viseme_SS',
  8: 'viseme_nn',
  9: 'viseme_RR',
  10: 'viseme_aa',
  11: 'viseme_E',
  12: 'viseme_ih',
  13: 'viseme_oh',
  14: 'viseme_ou',
  15: 'viseme_O',
  16: 'viseme_aa',
  17: 'viseme_E',
  18: 'viseme_ih',
  19: 'viseme_ou',
  20: 'viseme_PP',
  21: 'viseme_kk',
};

const VISEME_INTENSITY_BY_ID = {
  0: 0.0,
  1: 0.6,
  2: 0.5,
  3: 0.4,
  4: 0.5,
  5: 0.4,
  6: 0.6,
  7: 0.5,
  8: 0.5,
  9: 0.4,
  10: 1.0,
  11: 0.7,
  12: 0.5,
  13: 0.8,
  14: 0.6,
  15: 0.7,
  16: 1.0,
  17: 0.6,
  18: 0.5,
  19: 0.6,
  20: 0.6,
  21: 0.4,
};

const VISEME_INTENSITY_BY_NAME = {
  viseme_sil: 0.0,
  viseme_PP: 0.6,
  viseme_FF: 0.5,
  viseme_TH: 0.4,
  viseme_DD: 0.5,
  viseme_kk: 0.4,
  viseme_CH: 0.6,
  viseme_SS: 0.5,
  viseme_nn: 0.5,
  viseme_RR: 0.4,
  viseme_aa: 1.0,
  viseme_E: 0.7,
  viseme_ih: 0.5,
  viseme_oh: 0.8,
  viseme_ou: 0.6,
  viseme_O: 0.7,
  viseme_I: 0.5,
  viseme_U: 0.6,
};

const VISEME_ALIASES = {
  viseme_ih: ['viseme_I'],
  viseme_oh: ['viseme_O'],
  viseme_ou: ['viseme_U'],
};

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
 * @returns {Object} Live refs and snapshots for morph targets/body motion
 */
export function useAudioDrivenLipSync(audioRef, mouthCues = [], isPlaying = false) {
  const morphTargetsRef = useRef({});
  const smoothedMorphsRef = useRef({}); // Internal state for muscle smoothing
  const bodyMotionRef = useRef({ headBob: 0, chestBob: 0 });

  const rafRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const dataArrayRef = useRef(null);
  const timeDomainDataRef = useRef(null);

  // Smoothing state for amplitude envelope
  const smoothedAmplitudeRef = useRef(0);
  const ATTACK_SPEED = 0.3; // How fast mouth opens
  const RELEASE_SPEED = 0.15; // How fast mouth closes (slower for natural look)

  // Body motion phase for subtle animation
  const bodyPhaseRef = useRef(0);

  // Setup WebAudio analyser when audio starts playing
  useEffect(() => {
    const audio = audioRef.current;

    const isWebAudioQueue = audio && typeof audio.currentTime === 'number' && audio.analyser;

    // Create audio context and analyser if we are dealing with HTMLMediaElement
    // If it's a WebAudioQueue, we use its built-in analyser.
    if (!audioContextRef.current && !isWebAudioQueue) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioContext();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.3;

        const bufferLength = analyserRef.current.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);
        timeDomainDataRef.current = new Uint8Array(analyserRef.current.fftSize);
      } catch (err) {
        console.error('[AudioDrivenLipSync] Failed to create AudioContext:', err);
        return;
      }
    } else if (isWebAudioQueue) {
       analyserRef.current = audio.analyser;
       const bufferLength = analyserRef.current.frequencyBinCount;
       dataArrayRef.current = new Uint8Array(bufferLength);
       timeDomainDataRef.current = new Uint8Array(analyserRef.current.fftSize);
    }

    if (!isPlaying || !audio) {
      // Reset when not playing
      smoothedAmplitudeRef.current = 0;
      bodyPhaseRef.current = 0;
      morphTargetsRef.current = {};
      smoothedMorphsRef.current = {};
      bodyMotionRef.current = { headBob: 0, chestBob: 0 };

      // Cleanup: disconnect source if we stopped playing
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect();
        } catch (err) {
          // Ignore
        }
        sourceRef.current = null;
      }
      return;
    }

    // Connect audio element to analyser ONLY if it's an HTMLMediaElement.
    // If audioRef.current is a WebAudioQueue, it already has its own analyser hooked up!
    if (audio instanceof HTMLMediaElement && audioContextRef.current) {
      try {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      } catch (err) {
        // Source might already be connected
      }
    }

    return () => {
      // Cleanup: disconnect source when effect re-runs or unmounts
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
      morphTargetsRef.current = {};
      smoothedMorphsRef.current = {};
      bodyMotionRef.current = { headBob: 0, chestBob: 0 };
      return;
    }

    const hasMouthCues = mouthCues && mouthCues.length > 0;

    const updateLipSync = (deltaTime = 16.6) => {
      if (!audioRef.current) {
        return;
      }

      const currentTime = audioRef.current.currentTime;
      let amplitude = 0;

      // Get audio amplitude if analyser is available
      if (analyserRef.current && dataArrayRef.current && timeDomainDataRef.current) {
        analyserRef.current.getByteTimeDomainData(timeDomainDataRef.current);

        let sumSquares = 0;
        for (let i = 0; i < timeDomainDataRef.current.length; i++) {
          const centered = (timeDomainDataRef.current[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / timeDomainDataRef.current.length);
        const timeAmplitude = Math.min(Math.max(rms, 0), 1);

        // Optional frequency-based reinforcement to reduce sensitivity to noise
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        let sum = 0;
        const startBin = 3;
        const endBin = Math.min(30, dataArrayRef.current.length);
        for (let i = startBin; i < endBin; i++) {
          sum += dataArrayRef.current[i] * dataArrayRef.current[i];
        }
        const freqRms = Math.sqrt(sum / (endBin - startBin));
        const freqAmplitude = Math.min(freqRms / 255, 1.0);

        const blended = Math.max(timeAmplitude, freqAmplitude * 0.85);
        amplitude = blended < NOISE_FLOOR ? 0 : (blended - NOISE_FLOOR) / (1 - NOISE_FLOOR);
      }

      // Apply attack/release smoothing
      const targetAmplitude = amplitude;
      const speed = targetAmplitude > smoothedAmplitudeRef.current ? ATTACK_SPEED : RELEASE_SPEED;
      smoothedAmplitudeRef.current += (targetAmplitude - smoothedAmplitudeRef.current) * speed;
      const smoothAmplitude = Math.max(0, Math.min(1, smoothedAmplitudeRef.current));

      // Update body motion phase (subtle oscillation)
      bodyPhaseRef.current += 0.05;
      const bodyOscillation = Math.sin(bodyPhaseRef.current) * 0.5 + 0.5; // [0, 1]

      let targetMorphs = {};

      if (hasMouthCues) {
        // MODE 1: Use mouthCues with amplitude layer for liveliness
        const activeCue = findActiveCue(mouthCues, currentTime);

        if (activeCue) {
          const { name: visemeName, intensity: visemeIntensity } = resolveViseme(activeCue.value);
          const amplitudeScale = Math.min(Math.max(smoothAmplitude, 0), 1);
          const strength = Math.min(amplitudeScale * Math.max(0.15, visemeIntensity), 1.0);
          const jawOpen = Math.min(amplitudeScale * Math.max(0.25, visemeIntensity), 1.0);

          targetMorphs = {
            jawOpen,
            mouthOpen: jawOpen,
          };

          if (visemeName) {
            targetMorphs[visemeName] = strength;
            const aliases = VISEME_ALIASES[visemeName];
            if (aliases) {
              for (const alias of aliases) {
                targetMorphs[alias] = strength;
              }
            }
          }
        } else {
          // Between cues: use amplitude-driven mouth (quieter)
          targetMorphs = {
            jawOpen: smoothAmplitude * 0.35,
            mouthOpen: smoothAmplitude * 0.35,
            viseme_aa: smoothAmplitude * 0.45,
            viseme_oh: smoothAmplitude * 0.25,
            viseme_ou: smoothAmplitude * 0.2,
            viseme_O: smoothAmplitude * 0.2,
            viseme_U: smoothAmplitude * 0.2,
          };
        }
      } else {
        // MODE 2: Pure amplitude-driven lip sync (fallback when no mouthCues)
        const jawOpen = smoothAmplitude * 0.7; // Primary jaw movement
        const lipRound = smoothAmplitude * 0.3; // Secondary lip rounding
        const lipWide = smoothAmplitude * 0.18; // Tertiary lip widening

        targetMorphs = {
          jawOpen: Math.min(jawOpen, 1.0),
          mouthOpen: Math.min(jawOpen, 1.0),
          viseme_aa: Math.min(jawOpen, 1.0),
          viseme_oh: Math.min(lipRound, 1.0),
          viseme_ou: Math.min(lipRound * 0.8, 1.0),
          viseme_O: Math.min(lipRound * 0.8, 1.0),
          viseme_U: Math.min(lipWide * 0.6, 1.0),
        };
      }

      // Apply muscle smoothing (lerp)
      // We calculate lerp alpha based on deltaTime to be frame-rate independent
      const lerpAlpha = Math.min(VISEME_SMOOTHING * (deltaTime / 16.67), 1.0);

      const newSmoothedMorphs = { ...smoothedMorphsRef.current };

      // Update existing smoothed morphs towards targets
      Object.keys(targetMorphs).forEach((key) => {
        const current = newSmoothedMorphs[key] || 0;
        const target = targetMorphs[key];
        newSmoothedMorphs[key] = THREE.MathUtils.lerp(current, target, lerpAlpha);
      });

      // Lerp morphs back to 0 if they are not in the current targetMorphs
      Object.keys(newSmoothedMorphs).forEach((key) => {
        if (!(key in targetMorphs)) {
          newSmoothedMorphs[key] = THREE.MathUtils.lerp(newSmoothedMorphs[key], 0, lerpAlpha);
          // Cleanup very small values to keep state clean
          if (newSmoothedMorphs[key] < 0.001) {
            delete newSmoothedMorphs[key];
          }
        }
      });

      smoothedMorphsRef.current = newSmoothedMorphs;
      morphTargetsRef.current = { ...newSmoothedMorphs };

      // Update body motion (subtle head and chest bob)
      const headBobAmount = smoothAmplitude * 0.015 * bodyOscillation; // Very subtle
      const chestBobAmount = smoothAmplitude * 0.01 * bodyOscillation; // Even more subtle

      bodyMotionRef.current = {
        headBob: Math.min(headBobAmount, 0.02), // Clamp to max 2cm
        chestBob: Math.min(chestBobAmount, 0.015), // Clamp to max 1.5cm
      };
    };

    const runLoop = (timestamp) => {
      if (!audioRef.current || !isPlaying) {
        rafRef.current = null;
        return;
      }

      const deltaTime = lastUpdateTimeRef.current ? timestamp - lastUpdateTimeRef.current : 16.6;

      if (
        !lastUpdateTimeRef.current ||
        timestamp - lastUpdateTimeRef.current >= TARGET_UPDATE_INTERVAL_MS
      ) {
        updateLipSync(deltaTime);
        lastUpdateTimeRef.current = timestamp;
      }

      rafRef.current = window.requestAnimationFrame(runLoop);
    };

    updateLipSync(0);
    lastUpdateTimeRef.current = performance.now();
    rafRef.current = window.requestAnimationFrame(runLoop);

    // Cleanup
    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastUpdateTimeRef.current = 0;
    };
  }, [audioRef, mouthCues, isPlaying]);

  return {
    morphTargetsRef,
    bodyMotionRef,
    // Backward-compatible snapshots for any legacy usage.
    morphTargets: morphTargetsRef.current,
    bodyMotion: bodyMotionRef.current,
  };
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

function resolveViseme(value) {
  if (value === null || value === undefined) {
    return { name: null, intensity: 0 };
  }

  if (typeof value === 'number') {
    const id = Number.isFinite(value) ? Math.round(value) : 0;
    return {
      name: VISEME_ID_TO_MORPH[id] ?? null,
      intensity: VISEME_INTENSITY_BY_ID[id] ?? 0,
    };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { name: null, intensity: 0 };
    }

    if (trimmed.startsWith('viseme_')) {
      return {
        name: trimmed,
        intensity: VISEME_INTENSITY_BY_NAME[trimmed] ?? 0.6,
      };
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const id = Math.round(parsed);
      return {
        name: VISEME_ID_TO_MORPH[id] ?? null,
        intensity: VISEME_INTENSITY_BY_ID[id] ?? 0,
      };
    }
  }

  return { name: null, intensity: 0 };
}
