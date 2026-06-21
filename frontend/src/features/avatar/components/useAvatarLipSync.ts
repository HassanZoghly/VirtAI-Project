import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const MORPH_TARGET_DAMPING = 10;
const HEAD_BOB_FREQUENCY = 2;
const HEAD_BOB_AMPLITUDE = 0.05;
const TWO_PI = Math.PI * 2;
const HEAD_BOB_PERIOD = TWO_PI / HEAD_BOB_FREQUENCY;
const FALLBACK_DAMPING = 5;
const ORIGIN_ZERO = 0;
const ACTIVE_VISEME_INFLUENCE = 1;
const INACTIVE_VISEME_INFLUENCE = 0;
const POINTER_RESET_INDEX = 0;
const ARRAY_END_OFFSET = 1;
const FALLBACK_VISEME = 'viseme_sil';

const VISEME_MAP: Record<string, string> = {
  A: 'viseme_PP', // Closed mouth (P, B, M)
  B: 'viseme_kk', // Slightly open (K, S, T)
  C: 'viseme_I',  // Open (E, I)
  D: 'viseme_aa', // Wide open (A)
  E: 'viseme_O',  // O shape
  F: 'viseme_U',  // U shape
  G: 'viseme_FF', // F, V sounds
  H: 'viseme_TH', // Th sounds
  X: 'viseme_sil', // Silence/Idle
};

export interface Viseme {
  start: number;
  end: number;
  value: string;
}

export interface UseAvatarLipSyncProps {
  targetMeshes: THREE.SkinnedMesh[];
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error';
  mouthCuesRef?: React.MutableRefObject<Viseme[]>;
  audioContext?: AudioContext | null;
  playbackStartTimeRef?: React.MutableRefObject<number | null>;
  groupRef: React.RefObject<THREE.Group | null>;
}

export function useAvatarLipSync({
  targetMeshes,
  pipelineState,
  mouthCuesRef,
  audioContext,
  playbackStartTimeRef,
  groupRef,
}: UseAvatarLipSyncProps) {
  const visemeKeysList = useMemo(() => Object.values(VISEME_MAP), []);
  const currentCueIndexRef = useRef(POINTER_RESET_INDEX);
  const blinkStateRef = useRef({ nextBlinkTime: 0, duration: 0.15, isBlinking: false });
  const fallbackTimeRef = useRef(0);

  useFrame((state, delta) => {
    if (targetMeshes.length > 0) {
      // 1. Calculate Target Values
      const t = state.clock.elapsedTime;
      const blinkState = blinkStateRef.current;

      if (!blinkState.isBlinking && t > blinkState.nextBlinkTime) {
        blinkState.isBlinking = true;
      }

      let blinkInfluence = 0;
      if (blinkState.isBlinking) {
        if (t < blinkState.nextBlinkTime + blinkState.duration / 2) {
          blinkInfluence = THREE.MathUtils.lerp(0, 1, (t - blinkState.nextBlinkTime) / (blinkState.duration / 2));
        } else if (t < blinkState.nextBlinkTime + blinkState.duration) {
          blinkInfluence = THREE.MathUtils.lerp(1, 0, (t - (blinkState.nextBlinkTime + blinkState.duration / 2)) / (blinkState.duration / 2));
        } else {
          blinkState.isBlinking = false;
          blinkState.nextBlinkTime = t + 2.5 + Math.random() * 3.5;
        }
      }

      let targetBrow = 0;
      let targetFrown = 0;
      let targetSmile = 0;

      if (pipelineState === 'thinking') {
        targetBrow = 0.6;
        targetFrown = 0.3;
      } else if (pipelineState === 'speaking') {
        targetSmile = 0.2;
      }

      let activeVisemeName: string | null = null;
      if (pipelineState === 'speaking' && mouthCuesRef?.current) {
        const cues = mouthCuesRef.current;
        let currentTime = 0;

        if (audioContext && audioContext.state === 'running' && playbackStartTimeRef?.current !== null) {
          currentTime = audioContext.currentTime - playbackStartTimeRef.current;
          fallbackTimeRef.current = currentTime;
        } else {
          fallbackTimeRef.current += delta;
          currentTime = fallbackTimeRef.current;
        }

        if (currentTime < 0) currentTime = 0;

        let index = currentCueIndexRef.current;

        if (cues.length > ORIGIN_ZERO) {
          const currentTrackedCue = cues[index] || cues[cues.length - ARRAY_END_OFFSET];
          if (currentTime < currentTrackedCue.start) {
            index = POINTER_RESET_INDEX;
          }
        } else {
          index = POINTER_RESET_INDEX;
        }

        while (index < cues.length && currentTime > cues[index].end) {
          index++;
        }

        currentCueIndexRef.current = index;

        if (index < cues.length && currentTime >= cues[index].start) {
          const cueValue = cues[index].value.toUpperCase();
          activeVisemeName = VISEME_MAP[cueValue] || FALLBACK_VISEME;
        }
      }

      // 2. Apply calculated values safely
      targetMeshes.forEach(mesh => {
        const dict = mesh.morphTargetDictionary;
        const influences = mesh.morphTargetInfluences;
        if (!dict || !influences) return;

        const safelySetInfluence = (key: string, targetValue: number, speed: number = 15) => {
          let idx = dict[key];

          // Fallback logic for lip-sync mismatches
          const baseKey = key.replace('viseme_', '');
          if (idx === undefined && dict[baseKey] !== undefined) {
            idx = dict[baseKey];
          }
          if (idx === undefined && dict[`viseme_${baseKey}`] !== undefined) {
            idx = dict[`viseme_${baseKey}`];
          }
          if (idx === undefined && dict[`mouth${baseKey}`] !== undefined) {
            idx = dict[`mouth${baseKey}`];
          }

          if (idx !== undefined && idx < influences.length) {
            const currentValue = influences[idx] || 0;
            // If speed is 0, set immediately (like blink), else lerp
            influences[idx] = speed === 0
              ? targetValue
              : THREE.MathUtils.lerp(currentValue, targetValue, delta * speed);
          }
        };

        // Blinking
        safelySetInfluence('eyeBlinkLeft', blinkInfluence, 0);
        safelySetInfluence('eyeBlinkRight', blinkInfluence, 0);

        // Expressions
        safelySetInfluence('browInnerUp', targetBrow);
        safelySetInfluence('mouthFrownLeft', targetFrown);
        safelySetInfluence('mouthFrownRight', targetFrown);
        safelySetInfluence('mouthSmileLeft', targetSmile);
        safelySetInfluence('mouthSmileRight', targetSmile);

        // Visemes
        for (let i = ORIGIN_ZERO; i < visemeKeysList.length; i++) {
          const vKey = visemeKeysList[i];
          const target = vKey === activeVisemeName ? ACTIVE_VISEME_INFLUENCE : INACTIVE_VISEME_INFLUENCE;
          safelySetInfluence(vKey, target, 15);
        }
      });
    } else if (targetMeshes.length === 0 && groupRef.current) {
      if (pipelineState === 'speaking') {
        fallbackTimeRef.current = (fallbackTimeRef.current + delta) % HEAD_BOB_PERIOD;
        groupRef.current.position.y = Math.sin(fallbackTimeRef.current * HEAD_BOB_FREQUENCY) * HEAD_BOB_AMPLITUDE;
      } else {
        groupRef.current.position.y = THREE.MathUtils.damp(
          groupRef.current.position.y,
          ORIGIN_ZERO,
          FALLBACK_DAMPING,
          delta
        );
      }
    }
  });
}
