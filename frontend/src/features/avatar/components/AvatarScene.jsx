/* eslint-disable no-console */
import { logger } from '@/shared/utils/logger';
import { ContactShadows, Environment, OrbitControls, useFBX, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import React, {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AvatarFaceController } from '../AvatarFaceController';
import { AnimationStateMachine } from '../utils/animationStateMachine';
import { getAnimationMeta } from '../data/animationRegistry';
import { animationSelector } from '../utils/animationSelector';
import { ProceduralController } from '../utils/ProceduralLayers';

THREE.Cache.enabled = true;

const CAMERA_CONFIG = { position: [0, 0.2, 3.6], fov: 45, near: 0.01, far: 100 };
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: false };
const TIMELINE_FPS = 30;
const AVATAR_BASE_POSITION = [0, -1.25, 0];
const AVATAR_BASE_SCALE = 1.25;
const SAFE_MIN_DELTA = 1 / 120;
const SAFE_MAX_DELTA = 1 / 15; // tolerate up to ~66 ms spikes without huge motion jumps

const TALK_VARIANT_PATTERN = /^talk(?:_|-)?\d+$/i;
const ROOT_TRANSLATION_NODE_PATTERN = /(hips|pelvis|root|armature)/i;
const ROOT_TRANSLATION_PROPERTY_PATTERN = /\.position$/i;
const ROOT_ROTATION_PROPERTY_PATTERN = /\.quaternion$/i;

function parseTrackName(trackName) {
  const parts = `${trackName}`.split('.');
  if (parts.length === 1) {
    return { nodeName: '', property: parts[0].toLowerCase() };
  }
  return {
    nodeName: parts.slice(0, -1).join('.').toLowerCase(),
    property: parts[parts.length - 1].toLowerCase(),
  };
}

function isRootMotionTrack(trackName) {
  const normalized = `${trackName}`.toLowerCase();

  // Strip root translation (position) tracks
  if (ROOT_TRANSLATION_PROPERTY_PATTERN.test(normalized)) {
    if (normalized === '.position') {
      return true;
    }
    const { nodeName, property } = parseTrackName(trackName);
    if (!nodeName) {
      return false;
    }
    if (property === 'position' && ROOT_TRANSLATION_NODE_PATTERN.test(nodeName)) {
      return true;
    }
  }

  // Strip root rotation (quaternion) tracks — prevents avatar flip during FBX talk animations
  if (ROOT_ROTATION_PROPERTY_PATTERN.test(normalized)) {
    const { nodeName, property } = parseTrackName(trackName);
    if (nodeName && property === 'quaternion' && ROOT_TRANSLATION_NODE_PATTERN.test(nodeName)) {
      return true;
    }
  }

  return false;
}

function sanitizeClipRootMotion(clip) {
  const cleanClip = clip.clone();
  
  cleanClip.tracks = cleanClip.tracks.filter(track => {
    const trackName = track.name;
    
    // 1. Prevent crash from missing leaf bones
    if (trackName.includes('_end') || trackName.includes('End_end')) return false;
    
    // 2. Prevent procedural fighting
    if (trackName.includes('Neck') || trackName.includes('Head') || trackName.includes('LeftEye') || trackName.includes('RightEye')) return false;

    // 3. LOCK AVATAR IN PLACE (Remove Root Motion Translation)
    // Only remove position, keep quaternion (rotation)
    if (trackName.includes('Hips.position') || trackName.includes('Armature.position')) return false;

    return true;
  });

  return cleanClip;
}

function isAnimationDirective(value) {
  return !!value && typeof value === 'object' && typeof value.animation === 'string';
}

/**
 * Error boundary for the 3D avatar canvas. Shows fallback on render error.
 */
class AvatarErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.warn('[AvatarScene] Caught error, showing fallback:', err.message);
    if (this.props.onError) {
      this.props.onError(err);
    }
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return (
          <div style={{ color: 'red', background: '#222', padding: '20px', position: 'absolute', zIndex: 100, top: 0, left: 0, width: '100%', height: '100%', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '20px', fontWeight: 'bold' }}>Avatar Rendering Error</h3>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '12px', background: '#111', padding: '10px' }}>
              {this.state.error?.toString()}
              {'\n\n'}
              {this.state.error?.stack}
            </pre>
            <p style={{ marginTop: '10px' }}>Component Stack:</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '12px', background: '#111', padding: '10px' }}>
              {this.state.errorInfo?.componentStack}
            </pre>
          </div>
        );
      }
      return null;
    }
    return this.props.children;
  }
}

const CACHE_BUST = import.meta.env.DEV ? `?v=${Date.now()}` : '';

const ANIM = {
  idle: [{ fbx: `/models/animations/Idle/Idle.fbx${CACHE_BUST}` }],
  talk0: [{ fbx: `/models/animations/Talk/Talk_0.fbx${CACHE_BUST}` }],
  talk1: [{ fbx: `/models/animations/Talk/Talk_1.fbx${CACHE_BUST}` }],
  talk2: [{ fbx: `/models/animations/Talk/Talk_2.fbx${CACHE_BUST}` }],
  talk3: [{ fbx: `/models/animations/Talk/Talk_3.fbx${CACHE_BUST}` }],
  talk4: [{ fbx: `/models/animations/Talk/Talk_4.fbx${CACHE_BUST}` }],
  talk5: [{ fbx: `/models/animations/Talk/Talk_5.fbx${CACHE_BUST}` }],
  talk6: [{ fbx: `/models/animations/Talk/Talk_6.fbx${CACHE_BUST}` }],
};

const TALK_ANIMATIONS = [
  { name: 'Talk_0', fbx: ANIM.talk0[0].fbx },
  { name: 'Talk_1', fbx: ANIM.talk1[0].fbx },
  { name: 'Talk_2', fbx: ANIM.talk2[0].fbx },
  { name: 'Talk_3', fbx: ANIM.talk3[0].fbx },
  { name: 'Talk_4', fbx: ANIM.talk4[0].fbx },
  { name: 'Talk_5', fbx: ANIM.talk5[0].fbx },
  { name: 'Talk_6', fbx: ANIM.talk6[0].fbx },
];

const ANIMATION_FALLBACK = {
  sad: 'idle',
  happy: 'talk0',
  angry: 'talk1',
  surprised: 'talk2',
  fearful: 'idle',
  disgusted: 'talk3',
  thinking: 'idle',
};

const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  currentAnimation,
  conversationState,
  stateMachineRef: controllerStateMachineRef,
  morphTargetsRef,
  speechFeaturesRef,
  updateLipSync,
  onModelLoaded,
  audioRef,
  mouthCues,
  isPlaying,
  isMovementEnabled = true,
  emotionData,
  audioGeneration = 0,
  currentIntents = [],
}) {
  const { scene } = useGLTF(modelPath);

  // Core References
  const group = useRef();
  const mixerRef = useRef(null);
  const stateMachineRef = useRef(null);
  const actionsRef = useRef({});
  const currentActionNameRef = useRef(null);
  const lastPlayedTalkRef = useRef(null);

  // Loading State
  const idleFBX = useFBX(ANIM.idle[0].fbx);
  const loadedTalkAnimationsRef = useRef(new Map());
  const [talkAnimationRevision, setTalkAnimationRevision] = useState(0);
  const talkPreloadStartedRef = useRef(false);

  // Avatar Component References
  const headMeshRef = useRef(null);
  const teethMeshRef = useRef(null);
  const allMorphMeshesRef = useRef([]);
  const faceControllerRef = useRef(null);

  const bonesRef = useRef({});

  // Animation and Motion State
  const isFirstFrame = useRef(true);
  const stableSceneTransformRef = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    initialized: false,
  });

  const prefersReducedMotionRef = useRef(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  // Procedural controller instance
  const proceduralControllerRef = useRef(null);
  if (!proceduralControllerRef.current) {
    proceduralControllerRef.current = new ProceduralController();
  }

  // Viseme caching
  const visemeIndexCacheRef = useRef(new WeakMap());

  // Set up model hierarchy, meshes, and bones
  useEffect(() => {
    if (!scene) return;

    if (import.meta.env.DEV) {
      console.debug('[AvatarScene] Initializing model meshes and bones');
    }

    const mouthMeshes = [];
    const collectedBones = {};

    scene.traverse((o) => {
      // Collect specific morph target meshes
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false; // Prevent clipping
        if (o.morphTargetDictionary) {
          const dict = o.morphTargetDictionary;
          const hasVisemes = Object.keys(dict).some((key) => key.startsWith('viseme_'));

          if (hasVisemes) {
            mouthMeshes.push(o);
            const name = o.name.toLowerCase();
            if (name.includes('head') || name.includes('face') || name.includes('wolf3d_head')) {
              headMeshRef.current = o;
              if (import.meta.env.DEV) {
                console.debug('[AvatarScene] Found head mesh:', o.name);
              }
            } else if (name.includes('teeth')) {
              teethMeshRef.current = o;
              if (import.meta.env.DEV) {
                console.debug('[AvatarScene] Found teeth mesh:', o.name);
              }
            }
          }
        }
      }

      // Collect bones for procedural layers
      if (o.isBone) {
        const boneName = o.name.toLowerCase();
        if (boneName.includes('head')) {
          collectedBones.head = o;
        } else if ((boneName.includes('lefteye') || boneName.includes('eye_l')) && !collectedBones.leftEye) {
          collectedBones.leftEye = o;
        } else if ((boneName.includes('righteye') || boneName.includes('eye_r')) && !collectedBones.rightEye) {
          collectedBones.rightEye = o;
        } else if (boneName === 'spine' || boneName.endsWith('spine')) {
          collectedBones.spine = o;
        } else if (boneName === 'spine1' || boneName.endsWith('spine1')) {
          collectedBones.spine1 = o;
        } else if (boneName === 'spine2' || boneName.endsWith('spine2')) {
          collectedBones.spine2 = o;
        } else if ((boneName.includes('leftshoulder') || boneName.includes('shoulder_l')) && !collectedBones.leftShoulder) {
          collectedBones.leftShoulder = o;
        } else if ((boneName.includes('rightshoulder') || boneName.includes('shoulder_r')) && !collectedBones.rightShoulder) {
          collectedBones.rightShoulder = o;
        }
      }
    });

    bonesRef.current = collectedBones;

    if (mouthMeshes.length === 0 && import.meta.env.DEV) {
      console.warn('[AvatarScene] ⚠️ No mouth meshes found with viseme morph targets!');
    }

    const allMorphMeshes = [];
    scene.traverse((child) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.morphTargetDictionary) {
        allMorphMeshes.push(child);
      }
    });
    allMorphMeshesRef.current = allMorphMeshes;

    if (!faceControllerRef.current) {
      faceControllerRef.current = new AvatarFaceController();
    }
    faceControllerRef.current.initializeMeshes(allMorphMeshes);

    // Couple saccades to blinking (blink on large eye movements)
    proceduralControllerRef.current.getSaccadeSystem().onSaccadeBlink = () => {
      if (faceControllerRef.current) {
        faceControllerRef.current.triggerBlink();
      }
    };

    onModelLoaded?.();
  }, [scene, onModelLoaded]);

  // Setup critical animation clips
  const criticalClips = useMemo(() => {
    const result = [];
    const normalizeClip = (clip, name) => {
      const c = clip.clone();
      c.name = name;
      return sanitizeClipRootMotion(c, name);
    };

    const idleClip = idleFBX?.animations?.[0];

    if (idleClip) {
      result.push(normalizeClip(idleClip, 'idle'));
    }

    return result;
  }, [idleFBX]);

  const forceIdleLoop = useCallback(() => {
    stateMachineRef.current?.play('idle');
    currentActionNameRef.current = 'idle';
  }, []);

  useEffect(() => {
    if (!scene || stableSceneTransformRef.current.initialized) {
      return;
    }

    stableSceneTransformRef.current.position.copy(scene.position);
    stableSceneTransformRef.current.quaternion.copy(scene.quaternion);
    stableSceneTransformRef.current.initialized = true;
  }, [scene]);

  // Setup animation mixer
  useEffect(() => {
    if (!scene || criticalClips.length === 0) {
      return;
    }

    mixerRef.current = new THREE.AnimationMixer(scene);
    const mixer = mixerRef.current;

    stateMachineRef.current = new AnimationStateMachine(mixer);

    const actions = {};
    for (const clip of criticalClips) {
      const action = mixer.clipAction(clip);
      actions[clip.name] = action;
    }
    actionsRef.current = actions;
    stateMachineRef.current.registerActions(actions);

    return () => {
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionNameRef.current = null;
    };
  }, [scene, criticalClips]);

  useEffect(() => {
    if (talkPreloadStartedRef.current || criticalClips.length === 0) {
      return;
    }

    talkPreloadStartedRef.current = true;
    let cancelled = false;
    const loader = new FBXLoader();

    const loadTalkAnimations = async () => {
      for (const { name, fbx } of TALK_ANIMATIONS) {
        if (cancelled || loadedTalkAnimationsRef.current.has(name)) {
          continue;
        }

        try {
          const loaded = await loader.loadAsync(fbx);
          if (cancelled) {
            return;
          }

          loadedTalkAnimationsRef.current.set(name, loaded);
          setTalkAnimationRevision((revision) => revision + 1);

        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn(`[AvatarScene] Failed to lazy-load '${name}':`, err);
          }
        }
      }
    };

    const scheduleLoad =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(
          () => {
            void loadTalkAnimations();
          },
          { timeout: 1500 }
        )
        : window.setTimeout(() => {
          void loadTalkAnimations();
        }, 0);

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(scheduleLoad);
      } else {
        clearTimeout(scheduleLoad);
      }
    };
  }, [criticalClips.length]);

  useEffect(() => {
    if (!mixerRef.current || loadedTalkAnimationsRef.current.size === 0) {
      return;
    }

    for (const [name, fbx] of loadedTalkAnimationsRef.current.entries()) {
      if (actionsRef.current[name]) {
        continue;
      }

      const clip = fbx?.animations?.[0];
      if (!clip) {
        continue;
      }

      const normalizedClip = sanitizeClipRootMotion(clip.clone(), name);
      normalizedClip.name = name;

      const action = mixerRef.current.clipAction(normalizedClip);
      actionsRef.current[name] = action;
      stateMachineRef.current?.registerActions(actionsRef.current);
    }
  }, [scene, criticalClips, talkAnimationRevision]);

  const playAction = useCallback(
    (request) => {
      if (!isMovementEnabled || !stateMachineRef.current) {
        forceIdleLoop();
        return;
      }

      const directive = isAnimationDirective(request) ? request : { animation: request };
      const requestedNameRaw = `${directive.animation || 'idle'}`;
      let requestedName = requestedNameRaw.toLowerCase();
      let intents = directive.intent || currentIntents || [];
      if (typeof intents === 'string') {
        intents = [intents];
      }

      const availableClips = Object.keys(actionsRef.current);
      const isTalkRequest = requestedName === 'speaking' || requestedName === 'talk' || /^talk\d$/.test(requestedName);

      if (isTalkRequest) {
        if (/^talk\d$/.test(requestedName)) {
          const expectedName = requestedName.replace('talk', 'talk_');
          const match = availableClips.find(c => c.toLowerCase() === expectedName);
          if (match) {
            requestedName = match;
          }
        } else {
          const selected = animationSelector.selectAnimation('talk', intents);
          if (selected) {
            const expectedName = selected.replace('talk', 'talk_');
            const match = availableClips.find(c => c.toLowerCase() === expectedName);
            if (match) {
              requestedName = match;
            }
          } else {
            requestedName = 'talk0';
          }
        }
      } else {
        if (!availableClips.includes(requestedName)) {
          if (ANIMATION_FALLBACK[requestedName]) {
            requestedName = ANIMATION_FALLBACK[requestedName];
          } else {
            const match = availableClips.find(c => c.toLowerCase() === requestedName);
            if (match) {
              requestedName = match;
            }
          }
        }
      }

      stateMachineRef.current.play(requestedName);
      currentActionNameRef.current = requestedName;
    },
    [forceIdleLoop, isMovementEnabled, currentIntents]
  );

  useEffect(() => {
    if (!audioGeneration) {
      return;
    }
    if (currentActionNameRef.current && TALK_VARIANT_PATTERN.test(currentActionNameRef.current)) {
      currentActionNameRef.current = null;
    }
    lastPlayedTalkRef.current = currentActionNameRef.current;
  }, [audioGeneration]);

  useEffect(() => {
    if (!scene || Object.keys(actionsRef.current).length === 0) {
      return;
    }

    if (!isMovementEnabled) {
      forceIdleLoop();
      return;
    }

    for (const action of Object.values(actionsRef.current)) {
      action.paused = false;
      action.setEffectiveTimeScale(1);
    }

    playAction(currentAnimation);
  }, [
    currentAnimation,
    scene,
    criticalClips,
    isMovementEnabled,
    playAction,
    forceIdleLoop,
  ]);

  useEffect(() => {
    if (faceControllerRef.current && emotionData) {
      faceControllerRef.current.applyAIResponse(emotionData);
    }
  }, [emotionData]);

  useEffect(() => {
    if (faceControllerRef.current) {
      faceControllerRef.current.setSpeaking(!!isPlaying);
    }
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (faceControllerRef.current) {
        faceControllerRef.current.dispose();
      }
    };
  }, []);

  const lastAudioTimeRef = useRef(0);
  const wasPlayingAudioRef = useRef(false);

  useFrame((state, dt) => {
    let safeDt = THREE.MathUtils.clamp(dt || 0, SAFE_MIN_DELTA, SAFE_MAX_DELTA);

    if (isPlaying && audioRef?.current && typeof audioRef.current.currentTime === 'number') {
      const audioTime = audioRef.current.currentTime;
      if (wasPlayingAudioRef.current) {
        const audioDt = audioTime - lastAudioTimeRef.current;
        if (audioDt > 0 && audioDt < 0.15) {
          safeDt = audioDt;
        } else if (audioDt <= 0) {
          safeDt = 0;
        }
      }
      lastAudioTimeRef.current = audioTime;
      wasPlayingAudioRef.current = true;
    } else {
      wasPlayingAudioRef.current = false;
    }

    // --- SYNCHRONOUS LIP SYNC UPDATE ---
    if (updateLipSync) {
      updateLipSync(safeDt * 1000);
    }

    if (audioRef?.current?.updateDiagnostics) {
      audioRef.current.updateDiagnostics();
    }

    if (controllerStateMachineRef?.current) {
      const playbackState = audioRef?.current?.getPlaybackState ? audioRef.current.getPlaybackState() : null;
      controllerStateMachineRef.current.update(safeDt, playbackState);
    }

    const enhancedMorphTargets = morphTargetsRef?.current || {};
    const speechFeatures = speechFeaturesRef?.current || {};

    // 1. UNDO PROCEDURAL OFFSETS FROM LAST FRAME
    if (proceduralControllerRef.current) {
      proceduralControllerRef.current.undoAll(bonesRef.current);
    }

    // 2. RUN ANIMATION MIXER
    if (mixerRef.current && safeDt > 0) {
      mixerRef.current.update(safeDt);
    }

    // 3. APPLY PROCEDURAL LAYERS (ADDITIVE)
    if (proceduralControllerRef.current && !prefersReducedMotionRef.current && isMovementEnabled) {
      const isPaused = conversationState === 'MICRO_PAUSE' || conversationState === 'POST_SPEECH_DECAY' || conversationState === 'SETTLING';
      const proceduralContext = {
        stateMachine: controllerStateMachineRef.current,
        speechFeatures: speechFeatures,
        conversationState: conversationState,
      };

      proceduralControllerRef.current.update(
        safeDt,
        proceduralContext,
        bonesRef.current.head,
        state.camera
      );
      proceduralControllerRef.current.applyAll(bonesRef.current);

      // Verify no NaNs generated
      if (bonesRef.current.head && Number.isNaN(bonesRef.current.head.quaternion.x)) {
          console.error('[AvatarScene] NaN quaternion detected in Head! Resetting.');
          bonesRef.current.head.quaternion.identity();
      }
      if (bonesRef.current.spine && Number.isNaN(bonesRef.current.spine.quaternion.x)) {
          console.error('[AvatarScene] NaN quaternion detected in Spine! Resetting.');
          bonesRef.current.spine.quaternion.identity();
      }
    }

    // 4. APPLY FACE AND LIP SYNC MORPHS
    let faceMorphs = {};
    if (faceControllerRef.current) {
      faceMorphs = faceControllerRef.current.update(safeDt);
    }

    for (const mesh of allMorphMeshesRef.current) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      for (const [name, value] of Object.entries(faceMorphs)) {
        if (name in dict) {
          const idx = dict[name];
          const clamped = Math.max(0, Math.min(1, value));
          const isBlink = name === 'eyeBlinkLeft' || name === 'eyeBlinkRight';
          const isVisemeRelated = name.toLowerCase().startsWith('viseme_') || name.toLowerCase().includes('jaw') || name.toLowerCase().includes('mouth');

          if (isBlink) {
            infl[idx] = clamped;
          } else if (isVisemeRelated) {
            continue;
          } else {
            infl[idx] = THREE.MathUtils.lerp(infl[idx], clamped, Math.min(safeDt * 6, 1));
          }
        }
      }
    }

    if (headMeshRef.current && headMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(
        headMeshRef.current,
        enhancedMorphTargets,
        visemeIndexCacheRef.current
      );
    }
    if (teethMeshRef.current && teethMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(
        teethMeshRef.current,
        enhancedMorphTargets,
        visemeIndexCacheRef.current
      );
    }

    // 5. CAMERA & STABILIZATION
    const aspect = state.camera.aspect;
    const isMobile = aspect < 1;
    const safeAnimation = typeof currentAnimation === 'string' ? currentAnimation : '';
    const isPlayingAction = isMovementEnabled && !['idle', 'thinking', 'speaking'].includes(safeAnimation) && !safeAnimation.startsWith('talk');

    // DISABLE Dynamic Camera: Hardcode targetZ to 2.8
    let targetY = 1.5;
    let targetZ = 3.5;

    if (isFirstFrame.current) {
      state.camera.position.y = targetY;
      state.camera.position.z = targetZ;
      isFirstFrame.current = false;
    } else {
      state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, 0.05);
      state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, targetZ, 0.05);
    }

    if (stableSceneTransformRef.current.initialized) {
      scene.position.x = THREE.MathUtils.lerp(scene.position.x, stableSceneTransformRef.current.position.x, 0.1);
      scene.position.z = THREE.MathUtils.lerp(scene.position.z, stableSceneTransformRef.current.position.z, 0.1);
      scene.quaternion.copy(stableSceneTransformRef.current.quaternion);
    }

    if (group.current) {
      group.current.position.y = AVATAR_BASE_POSITION[1];
    }
  });

  return (
    <group ref={group} position={AVATAR_BASE_POSITION} scale={AVATAR_BASE_SCALE}>
      <primitive object={scene} />
    </group>
  );
});

function applyMorphTargetsSmooth(mesh, morphTargets, visemeIndexCache) {
  if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
    return;
  }

  const resetSpeed = 0.15;

  let visemeIndices = visemeIndexCache?.get(mesh);
  if (!visemeIndices) {
    visemeIndices = [];
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const nameLower = name.toLowerCase();
      if (
        nameLower.startsWith('viseme_') ||
        nameLower.includes('jaw') ||
        nameLower.includes('mouth')
      ) {
        visemeIndices.push(index);
      }
    }
    visemeIndexCache?.set(mesh, visemeIndices);
  }

  for (const index of visemeIndices) {
    if (index < 0 || index >= mesh.morphTargetInfluences.length) {
      continue;
    }
    const current = mesh.morphTargetInfluences[index];
    const newValue = THREE.MathUtils.lerp(current, 0, resetSpeed);
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, newValue));
  }

  for (const [visemeName, targetValue] of Object.entries(morphTargets)) {
    const index = mesh.morphTargetDictionary[visemeName];
    if (index === undefined) continue;
    if (index < 0 || index >= mesh.morphTargetInfluences.length) continue;

    const clampedTarget = Math.max(0, Math.min(1, targetValue)) * 0.75;
    const current = mesh.morphTargetInfluences[index];
    const newValue = THREE.MathUtils.lerp(current, clampedTarget, 0.15);
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, newValue));
  }
}

const AvatarSceneWrapper = React.memo(function AvatarSceneWrapper(props) {
  return (
    <AvatarErrorBoundary
      fallback={
        <div style={{ width: '100%', height: '100%', background: 'rgb(22 22 22)' }} />
      }
      onError={props.onError}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <Canvas shadows dpr={[1, 1.5]} camera={CAMERA_CONFIG} gl={GL_CONFIG}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[4, 6, 4]} intensity={1.0} castShadow />
          <directionalLight position={[-4, 5, -3]} intensity={0.35} />
          <pointLight position={[0, 2, 2]} intensity={0.35} />
          <Environment preset="studio" />

          <Suspense fallback={null}>
            <AvatarErrorBoundary onError={props.onError}>
              <AvatarRig {...props} />
            </AvatarErrorBoundary>
          </Suspense>

          <ContactShadows position={[0, -1.25, 0]} opacity={0.35} scale={10} blur={2} far={4} />
          <OrbitControls enablePan={false} enableZoom minDistance={1.5} maxDistance={6.5} minPolarAngle={Math.PI / 5} maxPolarAngle={Math.PI / 2.15} minAzimuthAngle={-Math.PI / 2.5} maxAzimuthAngle={Math.PI / 2.5} />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
});

export default AvatarSceneWrapper;

useGLTF.preload('/models/avatar1.glb');

if (typeof window !== 'undefined') {
  ['/models/animations/Idle/Idle.fbx'].forEach((url) => {
    fetch(url, { priority: 'low' }).catch(() => { });
  });
}
