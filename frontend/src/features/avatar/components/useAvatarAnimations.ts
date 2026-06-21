import { useAnimations, useFBX } from '@react-three/drei';
import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const IDLE_URL = '/models/animations/Idle/Idle.fbx';
const TALK_MANIFEST = [
  '/models/animations/Talk/Talk_1.fbx',
  '/models/animations/Talk/Talk_2.fbx'
];

const FADE_DURATION = 0.5;
const IDLE_BREAK_MULTIPLIER = 2;
const IDLE_BREAK_OFFSET = 2;

interface TimelineState {
  phase: 'idle' | 'thinking' | 'speaking' | 'talking' | 'idle_break';
  timeInPhase: number;
  targetBreakDuration: number;
  lastTalkIndex: number;
}

export function useAvatarAnimations(
  scene: THREE.Group, 
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error',
  movementEnabled: boolean
) {
  const idleFbx = useFBX(IDLE_URL);
  const talkFbxs = useFBX(TALK_MANIFEST);

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

    if (idleFbx.animations.length > 0) {
      const idleClip = idleFbx.animations[0].clone();
      idleClip.name = 'Idle';
      clips.push(renameTracks(idleClip));
    }
    
    talkFbxs.forEach((fbx, index) => {
      if (fbx.animations.length > 0) {
        const talkClip = fbx.animations[0].clone();
        talkClip.name = `Talk_${index}`;
        clips.push(renameTracks(talkClip));
      }
    });
    return clips;
  }, [idleFbx, talkFbxs]);

  const { actions, mixer } = useAnimations(animations, scene);
  const currentActionNameRef = useRef<string | null>(null);
  const talkActionNames = useMemo(() => Object.keys(actions).filter(k => k.startsWith('Talk_')), [actions]);

  const timelineStateRef = useRef<TimelineState>({
    phase: 'idle',
    timeInPhase: 0,
    targetBreakDuration: 0,
    lastTalkIndex: -1,
  });

  useEffect(() => {
    if (actions['Idle']) {
      actions['Idle'].setLoop(THREE.LoopRepeat, Infinity);
    }
    
    Object.keys(actions).forEach(key => {
      const action = actions[key];
      if (key.startsWith('Talk_') && action) {
        action.setLoop(THREE.LoopOnce, 1);
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
        if (!nextAction.isRunning()) nextAction.reset().play();
        return;
      }

      const prevAction = currentActionNameRef.current ? actions[currentActionNameRef.current] : null;

      nextAction.reset();
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);
      nextAction.play();

      if (prevAction && prevAction.isRunning()) {
        prevAction.crossFadeTo(nextAction, fadeTime, true); // true = warp, syncing timescales
      }

      currentActionNameRef.current = targetName;
    },
    [actions, movementEnabled]
  );

  const startRandomTalk = useCallback(() => {
    const { lastTalkIndex } = timelineStateRef.current;
    let nextIndex: number;

    if (talkActionNames.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * talkActionNames.length);
      } while (nextIndex === lastTalkIndex);
    } else {
      nextIndex = 0;
    }

    timelineStateRef.current = {
      phase: 'talking',
      timeInPhase: 0,
      targetBreakDuration: 0,
      lastTalkIndex: nextIndex,
    };

    playAnimation(talkActionNames[nextIndex]);
  }, [talkActionNames, playAnimation]);

  useEffect(() => {
    if (!mixer) return;

    const onFinished = (e: THREE.Event) => {
      // @ts-expect-error Three.js AnimationAction event typing is loose
      const finishedName = e.action?.getClip()?.name;

      if (finishedName && typeof finishedName === 'string' && finishedName.startsWith('Talk_') && pipelineState === 'speaking') {
        timelineStateRef.current = {
          ...timelineStateRef.current,
          phase: 'idle_break',
          timeInPhase: 0,
          targetBreakDuration: Math.random() * IDLE_BREAK_MULTIPLIER + IDLE_BREAK_OFFSET,
        };
        playAnimation('Idle');
      }
    };

    mixer.addEventListener('finished', onFinished);
    return () => {
      mixer.removeEventListener('finished', onFinished);
      // Cleanly stop all animations on unmount/re-render to prevent memory leaks and zombie weights
      mixer.stopAllAction();
    };
  }, [mixer, pipelineState, playAnimation]);

  useEffect(() => {
    if (!movementEnabled) {
      playAnimation('Idle');
      return;
    }

    if (pipelineState === 'speaking') {
      if (timelineStateRef.current.phase === 'idle') {
        startRandomTalk();
      }
    } else {
      timelineStateRef.current = {
        phase: 'idle',
        timeInPhase: 0,
        targetBreakDuration: 0,
        lastTalkIndex: -1,
      };
      playAnimation('Idle');
    }
  }, [pipelineState, movementEnabled, playAnimation, startRandomTalk]);

  useFrame((state, delta) => {
    const timeline = timelineStateRef.current;
    if (pipelineState === 'speaking' && timeline.phase === 'idle_break') {
      timeline.timeInPhase += delta;
      if (timeline.timeInPhase >= timeline.targetBreakDuration) {
        startRandomTalk();
      }
    }
  });

  return { actions, mixer };
}
