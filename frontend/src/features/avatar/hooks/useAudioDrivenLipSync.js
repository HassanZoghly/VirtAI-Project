/* eslint-disable no-console */
import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

const NOISE_FLOOR = 0.03;
const VISEME_SMOOTHING = 0.25; // Muscle elasticity factor
const COARTICULATION_WINDOW_S = 0.08; // 80ms lookahead for viseme blending
const JAW_COUPLING_FACTOR = 0.12; // How much open vowels drive jawOpen

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
 * useAudioDrivenLipSync — Synchronized lip-sync driven from the R3F useFrame loop.
 *
 * ARCHITECTURAL CHANGE: This hook no longer runs its own requestAnimationFrame loop.
 * Instead, it provides an `updateLipSync(deltaTimeMs)` function that the R3F useFrame
 * callback calls synchronously. This eliminates the dual-loop desync where lip-sync
 * morphs were written on a different cadence than the render loop that reads them.
 *
 * ADDITIONAL OUTPUT: Exposes `speechFeatures` — { energy, isSilentGap } — for driving
 * procedural body motion layers (breathing intensity, gesture energy, etc.)
 *
 * @param {React.RefObject} audioRef - Reference to WebAudioQueue or HTMLAudioElement
 * @param {Array} mouthCues - Array of {start, end, value} for lip sync timeline
 * @param {boolean} isPlaying - Whether audio is currently playing
 * @returns {Object} { morphTargetsRef, speechFeaturesRef, updateLipSync }
 */
export function useAudioDrivenLipSync(audioRef, mouthCues = [], isPlaying = false) {
  const morphTargetsRef = useRef({});
  const smoothedMorphsRef = useRef({}); // Internal state for muscle smoothing

  // Speech features for body motion
  const speechFeaturesRef = useRef({ energy: 0, isSilentGap: false });

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const dataArrayRef = useRef(null);
  const timeDomainDataRef = useRef(null);

  // Smoothing state for amplitude envelope
  const smoothedAmplitudeRef = useRef(0);
  const ATTACK_SPEED = 0.3;
  const RELEASE_SPEED = 0.15;

  // Prosody tracking refs
  const lastAmpRef = useRef(0);
  const derivRef = useRef(0);
  const pacingRef = useRef(0);

  // Binary search index hint for sorted cues
  const lastCueIndexRef = useRef(0);

  // Setup WebAudio analyser when audio starts playing
  useEffect(() => {
    const audio = audioRef.current;
    const isWebAudioQueue = audio && typeof audio.currentTime === 'number' && audio.analyser;

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
      smoothedAmplitudeRef.current = 0;
      morphTargetsRef.current = {};
      smoothedMorphsRef.current = {};
      speechFeaturesRef.current = { energy: 0, isSilentGap: false };
      lastCueIndexRef.current = 0;

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

  /**
   * SYNCHRONOUS lip-sync update — call this from useFrame().
   * No requestAnimationFrame, no competing loops.
   *
   * @param {number} deltaTimeMs — milliseconds since last frame
   */
  const updateLipSync = useCallback((deltaTimeMs = 16.6) => {
    if (!isPlaying || !audioRef.current) {
      // Smoothly fade out morphs when not playing
      const smoothed = smoothedMorphsRef.current;
      let anyActive = false;
      for (const key of Object.keys(smoothed)) {
        smoothed[key] = THREE.MathUtils.lerp(smoothed[key], 0, 0.1);
        if (smoothed[key] < 0.001) {
          delete smoothed[key];
        } else {
          anyActive = true;
        }
      }
      if (anyActive) {
        morphTargetsRef.current = { ...smoothed };
      } else {
        morphTargetsRef.current = {};
      }
      speechFeaturesRef.current = { energy: 0, isSilentGap: false };
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

      // Frequency-based reinforcement
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

    // Attack/release smoothing
    const targetAmplitude = amplitude;
    const speed = targetAmplitude > smoothedAmplitudeRef.current ? ATTACK_SPEED : RELEASE_SPEED;
    smoothedAmplitudeRef.current += (targetAmplitude - smoothedAmplitudeRef.current) * speed;
    const smoothAmplitude = Math.max(0, Math.min(1, smoothedAmplitudeRef.current));

    // --- PROSODY EXTRACTION ---
    const lastAmp = lastAmpRef.current;
    const deltaAmp = smoothAmplitude - lastAmp;
    lastAmpRef.current = smoothAmplitude;

    // Track smoothed derivative for emphasis (rapid increases in volume)
    let deriv = derivRef.current;
    deriv = THREE.MathUtils.lerp(deriv, deltaAmp, 0.3);
    // Protect against NaN
    if (Number.isNaN(deriv)) deriv = 0;
    derivRef.current = deriv;

    // Pacing (moving average of speech activity)
    let pacing = pacingRef.current;
    const isActive = smoothAmplitude > 0.1 ? 1.0 : 0.0;
    pacing = THREE.MathUtils.lerp(pacing, isActive, 0.02); // Slow window (~1s)
    if (Number.isNaN(pacing)) pacing = 0;
    pacingRef.current = pacing;

    const emphasis = Math.max(0, deriv) * 8.0; // Scale up

    // Update speech features for body motion
    speechFeaturesRef.current = {
      energy: smoothAmplitude,
      isSilentGap: smoothAmplitude < 0.05 && isPlaying,
      emphasis: Math.min(1.0, emphasis),
      pacing: pacing,
    };

    const hasMouthCues = mouthCues && mouthCues.length > 0;
    let targetMorphs = {};

    if (hasMouthCues) {
      // MODE 1: Use mouthCues with amplitude layer
      const activeCue = findActiveCueBinary(mouthCues, currentTime, lastCueIndexRef);

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
        // Between cues: amplitude-driven mouth
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

      // COARTICULATION
      if (activeCue) {
        const timeUntilEnd = activeCue.end - currentTime;
        if (timeUntilEnd < COARTICULATION_WINDOW_S && timeUntilEnd > 0) {
          const nextCue = findNextCueBinary(mouthCues, currentTime, lastCueIndexRef);
          if (nextCue) {
            const blendFactor = 1 - (timeUntilEnd / COARTICULATION_WINDOW_S);
            const { name: nextViseme } = resolveViseme(nextCue.value);
            if (nextViseme && activeCue.value !== nextCue.value) {
              const currentVisemeName = resolveViseme(activeCue.value).name;
              if (currentVisemeName && targetMorphs[currentVisemeName]) {
                targetMorphs[currentVisemeName] *= (1 - blendFactor * 0.3);
              }
              targetMorphs[nextViseme] = (targetMorphs[nextViseme] || 0) + 0.3 * blendFactor * 0.5;
            }
          }
        }
      }
    } else {
      // MODE 2: Pure amplitude-driven lip sync
      const jawOpen = smoothAmplitude * 0.7;
      const lipRound = smoothAmplitude * 0.3;
      const lipWide = smoothAmplitude * 0.18;

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

    // JAW COUPLING
    const openVowelKeys = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];
    let maxVowelInfluence = 0;
    for (const vowel of openVowelKeys) {
      if (targetMorphs[vowel]) {
        maxVowelInfluence = Math.max(maxVowelInfluence, targetMorphs[vowel]);
      }
    }
    if (maxVowelInfluence > 0) {
      targetMorphs.jawOpen = Math.min(
        (targetMorphs.jawOpen || 0) + maxVowelInfluence * JAW_COUPLING_FACTOR,
        1.0
      );
    }

    // Muscle smoothing (frame-rate independent)
    const lerpAlpha = Math.min(VISEME_SMOOTHING * (deltaTimeMs / 16.67), 1.0);

    const newSmoothedMorphs = { ...smoothedMorphsRef.current };

    Object.keys(targetMorphs).forEach((key) => {
      const current = newSmoothedMorphs[key] || 0;
      const target = targetMorphs[key];
      newSmoothedMorphs[key] = THREE.MathUtils.lerp(current, target, lerpAlpha);
    });

    Object.keys(newSmoothedMorphs).forEach((key) => {
      if (!(key in targetMorphs)) {
        newSmoothedMorphs[key] = THREE.MathUtils.lerp(newSmoothedMorphs[key], 0, lerpAlpha);
        if (newSmoothedMorphs[key] < 0.001) {
          delete newSmoothedMorphs[key];
        }
      }
    });

    smoothedMorphsRef.current = newSmoothedMorphs;
    morphTargetsRef.current = { ...newSmoothedMorphs };
  }, [audioRef, mouthCues, isPlaying]);

  return {
    morphTargetsRef,
    speechFeaturesRef,
    updateLipSync,
    // Backward-compatible snapshot for any legacy usage.
    morphTargets: morphTargetsRef.current,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUE LOOKUP — Binary search for O(log n) instead of O(n)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find the active mouth cue at current time using binary search with a hint.
 * Cues are assumed sorted by start time.
 *
 * @param {Array} mouthCues - Array of {start, end, value} sorted by start time
 * @param {number} currentTime - Current audio time in seconds
 * @param {React.MutableRefObject<number>} hintRef - Last known index (speeds up sequential access)
 * @returns {Object|null} Active cue or null
 */
function findActiveCueBinary(mouthCues, currentTime, hintRef) {
  if (!mouthCues || mouthCues.length === 0) return null;

  // Check hint first (temporal locality — usually correct or ±1)
  const hint = hintRef.current;
  if (hint >= 0 && hint < mouthCues.length) {
    const cue = mouthCues[hint];
    if (currentTime >= cue.start && currentTime < cue.end) {
      return cue;
    }
    // Check next cue (common case: advancing forward)
    if (hint + 1 < mouthCues.length) {
      const next = mouthCues[hint + 1];
      if (currentTime >= next.start && currentTime < next.end) {
        hintRef.current = hint + 1;
        return next;
      }
    }
  }

  // Binary search fallback
  let lo = 0;
  let hi = mouthCues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cue = mouthCues[mid];
    if (currentTime < cue.start) {
      hi = mid - 1;
    } else if (currentTime >= cue.end) {
      lo = mid + 1;
    } else {
      hintRef.current = mid;
      return cue;
    }
  }

  return null;
}

/**
 * Find the next cue after current time.
 * @param {Array} mouthCues
 * @param {number} currentTime
 * @param {React.MutableRefObject<number>} hintRef
 * @returns {Object|null}
 */
function findNextCueBinary(mouthCues, currentTime, hintRef) {
  if (!mouthCues || mouthCues.length === 0) return null;

  // Start search from hint
  const start = Math.max(0, hintRef.current);
  for (let i = start; i < mouthCues.length; i++) {
    if (mouthCues[i].start > currentTime) {
      return mouthCues[i];
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
