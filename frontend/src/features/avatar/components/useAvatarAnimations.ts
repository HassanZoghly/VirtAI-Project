import { useAnimations, useFBX } from '@react-three/drei';
import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Viseme } from './useAvatarLipSync';

const IDLE_URL = '/models/animations/Idle/Idle.fbx';
const TALK_MANIFEST = [
  '/models/animations/Talk/Talk_1.fbx',
  '/models/animations/Talk/Talk_2.fbx'
];

const FADE_DURATION = 0.5;
const IDLE_BREAK_MULTIPLIER = 2;
const IDLE_BREAK_OFFSET = 2;

const ANIMATION_LOOP_ONCE_COUNT = 1;
const NORMAL_TIME_SCALE = 1;
const FULL_WEIGHT = 1;
const MS_PER_SECOND = 1000;
const SINGLE_ANIMATION_COUNT = 1;
const FIRST_INDEX = 0;
const INITIAL_TIME = 0;
const NO_INDEX = -1;
const ARRAY_EMPTY_LENGTH = 0;

interface TimelineState {
  phase: 'idle' | 'thinking' | 'speaking' | 'talking' | 'idle_break';
  timeInPhase: number;
  targetBreakDuration: number;
  lastTalkIndex: number;
}

export function useAvatarAnimations(
  scene: THREE.Group,
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error',
  movementEnabled: boolean,
  audioContext?: AudioContext | null,
  playbackStartTimeRef?: React.MutableRefObject<number | null>,
  mouthCuesRef?: React.MutableRefObject<Viseme[]>
) {
  const idleFbx = useFBX(IDLE_URL);
  const talkFbx1 = useFBX(TALK_MANIFEST[0]);
  const talkFbx2 = useFBX(TALK_MANIFEST[1]);
  const talkFbxs = useMemo(() => [talkFbx1, talkFbx2], [talkFbx1, talkFbx2]);

  const animations = useMemo(() => {
    const clips: THREE.AnimationClip[] = [];

    const renameTracks = (clip: THREE.AnimationClip) => {
      const clonedClip = clip.clone();
      clonedClip.tracks = clonedClip.tracks.map(track => {
        const clonedTrack = track.clone();
        // ASSET_MANIFEST dictates using /mixamorig:|Armature\|/gi strictly to mirror the ground truth GLB naming
        const cleanName = clonedTrack.name.replace(/mixamorig:|Armature\|/gi, '');
        clonedTrack.name = cleanName;
        return clonedTrack;
      });
      return clonedClip;
    };

    if (idleFbx.animations.length > ARRAY_EMPTY_LENGTH) {
      const idleClip = idleFbx.animations[FIRST_INDEX].clone();
      idleClip.name = 'Idle';
      clips.push(renameTracks(idleClip));
    }

    talkFbxs.forEach((fbx, index) => {
      if (fbx.animations.length > ARRAY_EMPTY_LENGTH) {
        const talkClip = fbx.animations[FIRST_INDEX].clone();
        talkClip.name = `Talk_${index}`;
        clips.push(renameTracks(talkClip));
      }
    });
    return clips;
  }, [idleFbx, talkFbxs]);

  const { actions, mixer } = useAnimations(animations, scene);
  const currentActionNameRef = useRef<string | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const talkActionNames = useMemo(() => Object.keys(actions).filter(k => k.startsWith('Talk_')), [actions]);

  const timelineStateRef = useRef<TimelineState>({
    phase: 'idle',
    timeInPhase: INITIAL_TIME,
    targetBreakDuration: INITIAL_TIME,
    lastTalkIndex: NO_INDEX,
  });

  useEffect(() => {
    if (actions['Idle']) {
      actions['Idle'].setLoop(THREE.LoopRepeat, Infinity);
    }

    Object.keys(actions).forEach(key => {
      const action = actions[key];
      if (key.startsWith('Talk_') && action) {
        action.setLoop(THREE.LoopOnce, ANIMATION_LOOP_ONCE_COUNT);
        action.clampWhenFinished = true;
      }
    });
  }, [actions]);

  const playAnimation = useCallback(
    (name: string, fadeTime = FADE_DURATION) => {
      let targetName = name;

      // CRITICAL FIX: The 'Idle' animation is immune to movementEnabled.
      // If movement is disabled, we MUST fallback to 'Idle' to prevent bind-pose mesh collapse.
      if (!movementEnabled && targetName !== 'Idle') {
        targetName = 'Idle';
      }

      const nextAction = actions[targetName];
      if (!nextAction) return;

      if (currentActionNameRef.current === targetName) {
        if (!nextAction.isRunning()) nextAction.reset().fadeIn(fadeTime).play();
        return;
      }

      const prevAction = currentActionNameRef.current ? actions[currentActionNameRef.current] : null;

      nextAction.reset();
      nextAction.setEffectiveTimeScale(NORMAL_TIME_SCALE);
      nextAction.setEffectiveWeight(FULL_WEIGHT);

      if (prevAction) {
        // DEFENSIVE: Animation Memory Leak Fix
        // Crossfade strictly manages weight transition.
        // Schedule a hard .stop() to prevent the Three.js mixer from evaluating invisible, zero-weight actions indefinitely.
        prevAction.crossFadeTo(nextAction, fadeTime, true);

        // DEFENSIVE: Use clearable timeout for React hook safety
        if (stopTimeoutRef.current !== null) {
          window.clearTimeout(stopTimeoutRef.current);
        }
        stopTimeoutRef.current = window.setTimeout(() => {
          if (currentActionNameRef.current !== prevAction.getClip().name) {
            prevAction.stop();
          }
        }, fadeTime * MS_PER_SECOND);

        // Note: Timeout is cleared on unmount.
      } else {
        nextAction.fadeIn(fadeTime);
      }

      nextAction.play();

      currentActionNameRef.current = targetName;
    },
    [actions, movementEnabled]
  );

  const startRandomTalk = useCallback(() => {
    const { lastTalkIndex } = timelineStateRef.current;
    let nextIndex: number;

    if (talkActionNames.length > SINGLE_ANIMATION_COUNT) {
      do {
        nextIndex = Math.floor(Math.random() * talkActionNames.length);
      } while (nextIndex === lastTalkIndex);
    } else {
      nextIndex = FIRST_INDEX;
    }

    timelineStateRef.current = {
      phase: 'talking',
      timeInPhase: INITIAL_TIME,
      targetBreakDuration: INITIAL_TIME,
      lastTalkIndex: nextIndex,
    };

    playAnimation(talkActionNames[nextIndex]);
  }, [talkActionNames, playAnimation]);

  const pipelineStateRef = useRef(pipelineState);
  useEffect(() => {
    pipelineStateRef.current = pipelineState;
  }, [pipelineState]);

  useEffect(() => {
    if (!mixer) return;

    const onFinished = (e: THREE.Event) => {
      // @ts-expect-error Three.js AnimationAction event typing is loose
      const finishedName = e.action?.getClip()?.name;

      if (finishedName && typeof finishedName === 'string' && finishedName.startsWith('Talk_') && pipelineStateRef.current === 'speaking') {
        let remainingAudio = 0;
        if (mouthCuesRef?.current && mouthCuesRef.current.length > 0 && playbackStartTimeRef?.current != null && audioContext) {
          const lastCue = mouthCuesRef.current[mouthCuesRef.current.length - 1];
          
          // Defend against corrupted viseme data
          const validEnd = Number.isFinite(lastCue?.end) ? Number(lastCue.end) : 0;
          const audioEndTime = playbackStartTimeRef.current + validEnd;
          
          if (Number.isFinite(audioEndTime)) {
            remainingAudio = Math.max(0, audioEndTime - audioContext.currentTime);
          }
        }

        // Validate finite, non-negative, and strictly clamp [0.3, 2.0]
        let breakDuration = Number.isFinite(remainingAudio) && remainingAudio > 0 ? remainingAudio * 0.2 : 0;
        breakDuration = Math.min(2, Math.max(0.3, breakDuration));

        timelineStateRef.current = {
          ...timelineStateRef.current,
          phase: 'idle_break',
          timeInPhase: INITIAL_TIME,
          targetBreakDuration: breakDuration,
        };
        playAnimation('Idle');
      }
    };

    mixer.addEventListener('finished', onFinished);
    return () => {
      mixer.removeEventListener('finished', onFinished);
    };
  }, [mixer, playAnimation, audioContext, playbackStartTimeRef, mouthCuesRef]);

  useEffect(() => {
    return () => {
      if (mixer) mixer.stopAllAction();
      if (stopTimeoutRef.current !== null) {
        window.clearTimeout(stopTimeoutRef.current);
      }
    };
  }, [mixer]);

  useEffect(() => {
    if (!movementEnabled) {
      if (timelineStateRef.current.phase === 'talking') {
        timelineStateRef.current.phase = 'idle';
      }
      playAnimation('Idle');
      return;
    }

    if (pipelineState === 'speaking') {
      // Defer starting talk until audio is actually playing (handled in useFrame)
    } else {
      timelineStateRef.current = {
        phase: 'idle',
        timeInPhase: INITIAL_TIME,
        targetBreakDuration: INITIAL_TIME,
        lastTalkIndex: NO_INDEX,
      };
      playAnimation('Idle');
    }
  }, [pipelineState, movementEnabled, playAnimation]);

  useFrame((state, delta) => {
    const timeline = timelineStateRef.current;
    const currentState = pipelineStateRef.current;

    const isAudioPlaying = playbackStartTimeRef?.current != null
      && audioContext?.state === 'running'
      && audioContext.currentTime >= playbackStartTimeRef.current;

    if (currentState === 'speaking' && isAudioPlaying) {
      if (timeline.phase === 'idle') {
        startRandomTalk();
      } else if (timeline.phase === 'idle_break') {
        timeline.timeInPhase += delta;
        if (timeline.timeInPhase >= timeline.targetBreakDuration) {
          startRandomTalk();
        }
      }
    }
  });

  return { actions, mixer };
}
