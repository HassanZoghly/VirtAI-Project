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
  getAudioContext?: () => AudioContext,
  playbackStartTimeRef?: React.MutableRefObject<number | null>,
  mouthCuesRef?: React.MutableRefObject<Viseme[]>,
  getIsAudioPlaying?: () => boolean,
  getNextPlaybackTime?: () => number
) {
  const idleFbx = useFBX(IDLE_URL);
  const talkFbx1 = useFBX(TALK_MANIFEST[0]);
  const talkFbx2 = useFBX(TALK_MANIFEST[1]);
  const talkFbxs = useMemo(() => [talkFbx1, talkFbx2], [talkFbx1, talkFbx2]);

  const animations = useMemo(() => {
    const clips: THREE.AnimationClip[] = [];

    const renameTracks = (clip: THREE.AnimationClip) => {
      const clonedClip = clip.clone();
      
      const beforeCount = clonedClip.tracks.length;
      
      // DEFENSIVE FIX: Strip root motion tracks to prevent the "Explosion / Collapse" bug.
      // Mixamo FBX animations often contain Armature rotation/scale tracks that conflict with GLB root transforms.
      clonedClip.tracks = clonedClip.tracks.filter(track => {
        const cleanName = track.name.replace(/mixamorig:|Armature\|/gi, '');
        if (cleanName.startsWith('Armature.')) return false;
        // DEFENSIVE: Prevent Mixamo Z-up / Y-up offset bugs forcing the avatar hips to the floor (Y=-0.21)
        if (cleanName === 'Hips.position') return false;
        // DEFENSIVE: Prevent Mixamo Z-up rotation offset forcing the avatar to bend 90 degrees forward
        if (cleanName === 'Hips.quaternion') return false;
        return true;
      });

      const afterCount = clonedClip.tracks.length;
      console.log(`[Runtime Evidence] Animation Clip "${clip.name}" filtering: Kept ${afterCount}/${beforeCount} tracks. Removed Armature root tracks. First 5 retained:`, clonedClip.tracks.slice(0, 5).map(t => t.name));

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
  const stopTimeoutsRef = useRef<Set<number>>(new Set());
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

        // DEFENSIVE: Use multiple clearable timeouts for React hook safety during rapid crossfades
        const timeoutId = window.setTimeout(() => {
          stopTimeoutsRef.current.delete(timeoutId);
          if (currentActionNameRef.current !== prevAction.getClip().name) {
            prevAction.stop();
          }
        }, fadeTime * MS_PER_SECOND);
        stopTimeoutsRef.current.add(timeoutId);

        // Note: Timeouts are cleared on unmount.
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

      // DEFENSIVE: Stale callback prevention
      // Ignore 'finished' events from previous animations that were stopped during a crossfade.
      if (currentActionNameRef.current !== finishedName) return;

      let isAudioPlaying = false;
      const audioContext = getAudioContext?.();
      
      if (getIsAudioPlaying) {
        isAudioPlaying = getIsAudioPlaying();
      } else if (playbackStartTimeRef?.current != null && audioContext) {
        if (audioContext.state === 'running' && audioContext.currentTime >= playbackStartTimeRef.current) {
          isAudioPlaying = true;
          if (pipelineStateRef.current !== 'speaking') {
            if (mouthCuesRef?.current && mouthCuesRef.current.length > 0) {
              const lastCue = mouthCuesRef.current[mouthCuesRef.current.length - 1];
              const validEnd = Number.isFinite(lastCue?.end) ? Number(lastCue.end) : 0;
              if (audioContext.currentTime > playbackStartTimeRef.current + validEnd) {
                isAudioPlaying = false;
              }
            } else {
              isAudioPlaying = false;
            }
          }
        }
      }
        
      const isEffectivelySpeaking = pipelineStateRef.current === 'speaking' || isAudioPlaying;

      if (finishedName && typeof finishedName === 'string' && finishedName.startsWith('Talk_') && isEffectivelySpeaking) {
        let remainingAudio = 0;
        if (getNextPlaybackTime && audioContext) {
          const audioEndTime = getNextPlaybackTime();
          if (Number.isFinite(audioEndTime)) {
            remainingAudio = Math.max(0, audioEndTime - audioContext.currentTime);
          }
        } else if (mouthCuesRef?.current && mouthCuesRef.current.length > 0 && playbackStartTimeRef?.current != null && audioContext) {
          const lastCue = mouthCuesRef.current[mouthCuesRef.current.length - 1];
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
  }, [mixer, playAnimation, getAudioContext, playbackStartTimeRef, mouthCuesRef]);

  useEffect(() => {
    return () => {
      if (mixer) mixer.stopAllAction();
      stopTimeoutsRef.current.forEach(id => window.clearTimeout(id));
      stopTimeoutsRef.current.clear();
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

    if (pipelineState === 'thinking' || pipelineState === 'error') {
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
    
    let isAudioPlaying = false;
    if (getIsAudioPlaying) {
      isAudioPlaying = getIsAudioPlaying();
    } else if (playbackStartTimeRef?.current != null) {
      const audioContext = getAudioContext?.();
      if (audioContext?.state === 'running' && audioContext.currentTime >= playbackStartTimeRef.current) {
        isAudioPlaying = true;
        if (currentState !== 'speaking') {
          if (mouthCuesRef?.current && mouthCuesRef.current.length > 0) {
            const lastCue = mouthCuesRef.current[mouthCuesRef.current.length - 1];
            const validEnd = Number.isFinite(lastCue?.end) ? Number(lastCue.end) : 0;
            if (audioContext.currentTime > playbackStartTimeRef.current + validEnd) {
              isAudioPlaying = false;
            }
          } else {
            isAudioPlaying = false;
          }
        }
      }
    }

    const isEffectivelySpeaking = currentState === 'speaking' || isAudioPlaying;

    if (isEffectivelySpeaking && isAudioPlaying) {
      if (timeline.phase === 'idle') {
        startRandomTalk();
      } else if (timeline.phase === 'idle_break') {
        timeline.timeInPhase += delta;
        if (timeline.timeInPhase >= timeline.targetBreakDuration) {
          startRandomTalk();
        }
      }
    } else if (!isEffectivelySpeaking && timeline.phase !== 'idle') {
      timeline.phase = 'idle';
      playAnimation('Idle');
    }
  });

  return { actions, mixer };
}
