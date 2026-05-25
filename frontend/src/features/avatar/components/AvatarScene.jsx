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
import { useRealismEnhancements } from '../hooks/useRealismEnhancements';

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

function sanitizeClipRootMotion(clip, clipName) {
  const sanitized = clip.clone();
  const removedTrackNames = [];
  const meta = getAnimationMeta(clipName);
  const isGesture = meta && meta.category === 'gesture';

  sanitized.tracks = sanitized.tracks.filter((track) => {
    if (track.name.toLowerCase().endsWith('.scale')) {
      removedTrackNames.push(track.name);
      return false;
    }

    const shouldStrip = isRootMotionTrack(track.name);
    if (shouldStrip) {
      removedTrackNames.push(track.name);
      return false;
    }

    if (isGesture) {
      const lowerBodyPattern = /(hips|pelvis|leg|foot|toe|spine$|spine1)/i;
      const { nodeName } = parseTrackName(track.name);
      if (lowerBodyPattern.test(nodeName)) {
        removedTrackNames.push(track.name);
        return false;
      }
    }
    return true;
  });

  sanitized.resetDuration();

  if (removedTrackNames.length > 0 && import.meta.env.DEV) {
    console.debug(
      `[AvatarScene] Root motion disabled for '${clipName}': ${removedTrackNames.join(', ')}`
    );
  }

  if (isGesture) {
     try {
       THREE.AnimationUtils.makeClipAdditive(sanitized);
     } catch(e) {
       console.warn(`[AvatarScene] Failed to convert additive clip ${clipName}:`, e);
     }
  }

  return sanitized;
}

function isAnimationDirective(value) {
  return !!value && typeof value === 'object' && typeof value.animation === 'string';
}

function frameToSeconds(frame) {
  return Math.max(0, Number(frame || 0) / TIMELINE_FPS);
}

/**
 * Error boundary for the 3D avatar canvas. Shows fallback on render error.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.fallback] - Fallback UI on error
 * @param {(error: Error) => void} [props.onError] - Error callback
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
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

// Animation paths - only include animations that exist
// Add cache-busting in dev to ensure fresh loads after FBX updates
// Create stable cache-busting timestamp at module load (not on every render)
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

// Animation fallback map for missing animations
const ANIMATION_FALLBACK = {
  thinking: 'idle',
};

// Fuzzy animation name matching
export const ANIMATION_ALIASES = {
  talk: [
    'talk0',
    'talk1',
    'talk2',
    'talk3',
    'talk4',
    'talk5',
    'talk6',
    'talk_0',
    'talk_1',
    'talk_2',
    'talk_3',
    'talk_4',
    'talk_5',
    'talk_6',
  ],
  talk0: ['talk0', 'talk_0'],
  talk1: ['talk1', 'talk_1'],
  talk2: ['talk2', 'talk_2'],
  talk3: ['talk3', 'talk_3'],
  talk4: ['talk4', 'talk_4'],
  talk5: ['talk5', 'talk_5'],
  talk6: ['talk6', 'talk_6'],
  idle: ['idle', 'standing', 'neutral'],
};



/**
 * AvatarRig - Pure 3D rendering component.
 * Handles model loading, animation playback, and morph target application.
 * @param {object} props
 * @param {string} props.modelPath - Path to GLB model file
 * @param {string|object} [props.currentAnimation] - Animation name or timeline directive
 * @param {React.MutableRefObject<Record<string, number>>} [props.morphTargetsRef] - Live viseme ref
 * @param {{ headBob: number, chestBob: number }} [props.bodyMotion] - Subtle body animation
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {React.RefObject<HTMLAudioElement>} [props.audioRef] - Ref to audio element
 * @param {Array<{ start: number, end: number, value: string }>} [props.mouthCues] - Lip-sync timeline
 * @param {boolean} [props.isPlaying] - Whether audio is currently playing
 * @param {boolean} [props.isMovementEnabled] - Whether full body motion is enabled
 * @param {string|string[]} [props.currentIntents] - Current response intent labels
 */
const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  currentAnimation,
  morphTargetsRef,
  onModelLoaded,
  audioRef,
  mouthCues,
  isPlaying,
  isMovementEnabled = true,
  emotionData,
  audioGeneration,
  currentIntents = [],
}) {
  const group = useRef();
  const isFirstFrame = useRef(true);
  const prefersReducedMotionRef = useRef(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const { scene } = useGLTF(modelPath);

  // Load only the critical animations during the initial render pass.
  const idleFBX = useFBX(ANIM.idle[0].fbx);
  const loadedTalkAnimationsRef = useRef(new Map());
  const talkPreloadStartedRef = useRef(false);
  const [talkAnimationRevision, setTalkAnimationRevision] = useState(0);

  const mixerRef = useRef(null);
  const stateMachineRef = useRef(null);
  const actionsRef = useRef({});
  const currentActionNameRef = useRef(null); // Track current action name to prevent re-triggers
  const lastPlayedTalkRef = useRef(null);
  const clipNameCacheRef = useRef({}); // Cache resolved names
  const stableSceneTransformRef = useRef({
    initialized: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });
  const visemeIndexCacheRef = useRef(new WeakMap());

  // Refs for morph target meshes
  const headMeshRef = useRef(null);
  const teethMeshRef = useRef(null);

  // Refs for skeleton bones (for subtle head motion only - NO spine to prevent deformation)
  const headBoneRef = useRef(null);

  // Track if scene has been inspected (prevent duplicate logs)
  const sceneInspectedRef = useRef(false);

  // Head motion state (for smooth continuous motion without cuts)
  const headMotionStateRef = useRef({
    time: 0,
    currentPitch: 0,
    currentYaw: 0,
    currentRoll: 0,
  });

  // Face controller for blink, idle, emotion, speaking
  const faceControllerRef = useRef(null);
  const allMorphMeshesRef = useRef([]);

  // Use realism enhancements
  const enhancedMorphTargetsRef = useRealismEnhancements(
    scene,
    morphTargetsRef,
    isPlaying,
    audioRef,
    mouthCues,
    currentAnimation
  );

  // Setup scene materials and shadows + inspect morph targets
  useEffect(() => {
    if (!scene || sceneInspectedRef.current) {
      return;
    }

    // Mark as inspected to prevent duplicate logs
    sceneInspectedRef.current = true;

    // CRITICAL: Inspect scene graph and identify mouth meshes
    const mouthMeshes = [];
    const excludedMeshNames = ['body', 'outfit', 'hair', 'eye'];

    scene.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.isSkinnedMesh) {
          o.frustumCulled = false;
        }

        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
          });
        }

        // Inspect morph targets for debugging
        if (o.morphTargetDictionary && o.morphTargetInfluences) {
          const meshName = o.name.toLowerCase();
          const morphKeys = Object.keys(o.morphTargetDictionary);

          if (import.meta.env.DEV) {
            console.debug(
              `[AvatarScene] Mesh "${o.name}" has ${morphKeys.length} morph targets:`,
              morphKeys
            );
          }

          // Check if this mesh should be excluded (body/outfit/hair/eyes)
          const isExcluded = excludedMeshNames.some((excluded) => meshName.includes(excluded));

          // Check if this mesh has viseme morph targets
          const hasVisemes = morphKeys.some(
            (key) =>
              key.toLowerCase().startsWith('viseme_') ||
              key.toLowerCase().includes('jaw') ||
              key.toLowerCase().includes('mouth')
          );

          if (hasVisemes && !isExcluded) {
            // This is a mouth mesh (Head or Teeth)
            mouthMeshes.push(o);

            if (o.name === 'Wolf3D_Head' || meshName.includes('head')) {
              headMeshRef.current = o;
              if (import.meta.env.DEV) {
                console.debug('[AvatarScene] ✓ Identified HEAD mesh for lip sync:', o.name);
              }
            } else if (o.name === 'Wolf3D_Teeth' || meshName.includes('teeth')) {
              teethMeshRef.current = o;
              if (import.meta.env.DEV) {
                console.debug('[AvatarScene] ✓ Identified TEETH mesh for lip sync:', o.name);
              }
            }
          } else if (isExcluded && import.meta.env.DEV) {
            console.debug(
              `[AvatarScene] ✗ EXCLUDED mesh from lip sync: "${o.name}" (body/outfit/hair/eyes)`
            );
          }
        }
      }

      // Find skeleton bones for subtle head motion only (NO spine to prevent deformation)
      if (o.isBone) {
        // Common bone names for head: Head, head, mixamorigHead
        if (o.name.toLowerCase().includes('head') && !headBoneRef.current) {
          headBoneRef.current = o;
          if (import.meta.env.DEV) {
            console.debug('[AvatarScene] Found head bone:', o.name);
          }
        }
        // NOTE: Spine bone manipulation DISABLED to prevent body deformation
        // Previously caused chest/shoulder warping
      }
    });

    // Safety check: warn if no mouth meshes found
    if (mouthMeshes.length === 0 && import.meta.env.DEV) {
      console.warn('[AvatarScene] ⚠️ No mouth meshes found with viseme morph targets!');
    }

    // Collect ALL meshes with morph targets for face controller
    const allMorphMeshes = [];
    scene.traverse((child) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.morphTargetDictionary) {
        allMorphMeshes.push(child);
      }
    });
    allMorphMeshesRef.current = allMorphMeshes;

    // Initialize face controller
    if (!faceControllerRef.current) {
      faceControllerRef.current = new AvatarFaceController();
    }
    faceControllerRef.current.initializeMeshes(allMorphMeshes);

    onModelLoaded?.();
  }, [scene, onModelLoaded]);

  // Setup critical animation clips - only include animations that loaded successfully.
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

    if (import.meta.env.DEV) {
      console.debug('[AvatarScene] Loaded critical clips:', result.map((c) => c.name).join(', '));
    }

    return result;
  }, [idleFBX]);

  const forceIdleLoop = useCallback(() => {
    stateMachineRef.current?.play('idle');
    currentActionNameRef.current = 'idle';
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug('[AvatarScene] FBX Load Status:');
      console.debug('  - Idle:', idleFBX?.animations?.length || 0, 'clips');
      console.debug(
        '  - Talk:',
        loadedTalkAnimationsRef.current.size,
        'clips loaded in background'
      );
    }
  }, [idleFBX, talkAnimationRevision]);

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

    // Log available clips for debugging
    if (import.meta.env.DEV) {
      console.debug(
        '[AvatarScene] Available animation clips:',
        criticalClips.map((c) => `${c.name} (${c.duration.toFixed(2)}s)`).join(', ')
      );
    }

    return () => {
      stateMachineRef.current?.dispose();
      stateMachineRef.current = null;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionNameRef.current = null; // Reset name tracking
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

          if (import.meta.env.DEV) {
            console.debug(`[AvatarScene] Background-loaded animation '${name}'`);
          }
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
           // Explicit talk variant requested (e.g. talk1)
           const expectedName = requestedName.replace('talk', 'talk_');
           const match = availableClips.find(c => c.toLowerCase() === expectedName);
           if (match) {
             requestedName = match;
           }
        } else {
           // Semantic selection!
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
        // Fallback checks for explicit animations
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

      if (import.meta.env.DEV) {
        console.debug(`[AvatarScene] Playing via StateMachine: '${requestedName}'`);
      }

      stateMachineRef.current.play(requestedName);
      currentActionNameRef.current = requestedName;
    },
    [forceIdleLoop, isMovementEnabled, currentIntents]
  );

  // When a new audio response starts, unlock the talk variant so a fresh one is selected.
  // This allows variety between responses while preventing mid-response churn.
  useEffect(() => {
    if (!audioGeneration) {
      return;
    }
    // Only clear if a talk variant is currently locked — idle doesn't need resetting
    if (currentActionNameRef.current && TALK_VARIANT_PATTERN.test(currentActionNameRef.current)) {
      currentActionNameRef.current = null;
    }
    lastPlayedTalkRef.current = currentActionNameRef.current; // keep anti-repeat hint
  }, [audioGeneration]);

  // Handle animation changes
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

  // Apply emotion data from AI response to face controller
  useEffect(() => {
    if (faceControllerRef.current && emotionData) {
      faceControllerRef.current.applyAIResponse(emotionData);
    }
  }, [emotionData]);

  // Sync speaking state with face controller
  useEffect(() => {
    if (faceControllerRef.current) {
      faceControllerRef.current.setSpeaking(!!isPlaying);
    }
  }, [isPlaying]);

  // Cleanup face controller timers on unmount
  useEffect(() => {
    return () => {
      if (faceControllerRef.current) {
        faceControllerRef.current.dispose();
      }
    };
  }, []);

  const lastAudioTimeRef = useRef(0);
  const wasPlayingAudioRef = useRef(false);

  // Update animation mixer and apply enhanced morph targets with realism
  useFrame((state, dt) => {
    let safeDt = THREE.MathUtils.clamp(dt || 0, SAFE_MIN_DELTA, SAFE_MAX_DELTA);

    // Context-Aware Audio Synchronization
    // When audio is playing, derive the delta time from the high-precision Web Audio clock
    // to prevent animation playback from drifting over long TTS sentences.
    if (isPlaying && audioRef?.current && typeof audioRef.current.currentTime === 'number') {
      const audioTime = audioRef.current.currentTime;
      if (wasPlayingAudioRef.current) {
        const audioDt = audioTime - lastAudioTimeRef.current;
        // Apply reasonable bounds to prevent massive jumps if audio stalls or seeks
        if (audioDt > 0 && audioDt < 0.15) {
          safeDt = audioDt;
        } else if (audioDt <= 0) {
          safeDt = 0; // Wait for audio time to advance
        }
      }
      lastAudioTimeRef.current = audioTime;
      wasPlayingAudioRef.current = true;
    } else {
      wasPlayingAudioRef.current = false;
    }

    const enhancedMorphTargets = enhancedMorphTargetsRef.current || {};
    const currentAnimationName =
      typeof currentAnimation === 'string' ? currentAnimation : currentAnimation?.animation;

    // Update animation mixer
    if (mixerRef.current && safeDt > 0) {
      mixerRef.current.update(safeDt);
    }

    // Compute face animation targets (blink, idle, emotion, speaking)
    let faceMorphs = {};
    if (faceControllerRef.current) {
      faceMorphs = faceControllerRef.current.update(safeDt);
    }

    // Apply face morphs directly to ALL morph meshes
    for (const mesh of allMorphMeshesRef.current) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
        continue;
      }
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
            // Visemes are exclusively owned by the lip-sync engine now. Emotion controller must not write to them.
            continue;
          } else {
            infl[idx] = THREE.MathUtils.lerp(infl[idx], clamped, Math.min(safeDt * 6, 1));
          }
        }
      }
    }

    // Apply ENHANCED morph targets — lip-sync (with coarticulation, jaw coupling, etc.)
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

    // Check if the current animation allows procedural head motion
    const isTalkOrIdle = !currentAnimationName || 
      currentAnimationName === 'idle' || 
      currentAnimationName === 'thinking' || 
      currentAnimationName === 'speaking' || 
      (currentAnimationName && currentAnimationName.toLowerCase().startsWith('talk'));
      
    // Apply subtle head motion ONLY (NO spine to prevent body deformation)
    const prefersReducedMotion = prefersReducedMotionRef.current;

    // Only allow procedural head motion during idle or talk clips, NOT gestures
    if (!prefersReducedMotion && headBoneRef.current && isTalkOrIdle) {
      if (isPlaying) {
        applySubtleHeadMotion(
          headBoneRef.current,
          enhancedMorphTargets,
          safeDt,
          headMotionStateRef.current,
          state.camera
        );
      } else if (isMovementEnabled && currentAnimationName === 'thinking') {
        applyThinkingMotion(headBoneRef.current, safeDt, headMotionStateRef.current, state.camera);
      } else {
        applyReturnToNeutral(headBoneRef.current, safeDt, headMotionStateRef.current, state.camera);
      }
    }

    // Context-Aware Mobile Camera Framing (Omnichannel Fluidity)
    const aspect = state.camera.aspect;
    const isMobile = aspect < 1;
    const isTalkingOrIdle =
      ['idle', 'thinking'].includes(currentAnimationName) ||
      (currentAnimationName && currentAnimationName.startsWith('talk'));
    const isPlayingAction = isMovementEnabled && !isTalkingOrIdle;

    let targetY = 0.9;
    let targetZ = 2.8;

    if (isMobile) {
      if (isPlayingAction) {
        targetY = 0.4;
        targetZ = 5.2;
      } else {
        targetY = 1.0;
        targetZ = 2.8;
      }
    }

    if (isFirstFrame.current) {
      // Zero-latency snap for the initial load
      state.camera.position.y = targetY;
      state.camera.position.z = targetZ;
      isFirstFrame.current = false;
    } else {
      // Silky smooth interpolation for all subsequent state changes
      state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, 0.05);
      state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, targetZ, 0.05);
    }

    // Anchor-Based Soft Stabilization
    if (stableSceneTransformRef.current.initialized) {
      // Prevent world-space X/Z drift while preserving local Y motion (crouch/breathing)
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

/**
 * Apply morph target influences to a mesh with smooth interpolation
 * CRITICAL: This version resets ALL visemes to 0 smoothly to avoid "stuck" expressions
 * and prevents accumulation by clamping all values to [0, 1]
 *
 * @param {THREE.Mesh} mesh - The mesh with morph targets (MUST be Head or Teeth only)
 * @param {Object} morphTargets - Object mapping viseme names to influence values (0-1)
 * @param {WeakMap<THREE.Mesh, number[]>} [visemeIndexCache] - Cache for viseme index lookups
 */
function applyMorphTargetsSmooth(mesh, morphTargets, visemeIndexCache) {
  if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
    return;
  }

  const resetSpeed = 0.15; // Slower reset to avoid jitter

  // Cache viseme indices to avoid re-scanning the morph dictionary every frame.
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

  // STEP 1: Reset ALL visemes toward 0 first (prevents accumulation)
  for (const index of visemeIndices) {
    // Safety check: ensure index is within bounds
    if (index < 0 || index >= mesh.morphTargetInfluences.length) {
      if (import.meta.env.DEV) {
        console.warn(`[AvatarScene] Invalid morph target index: ${index}`);
      }
      continue;
    }

    const current = mesh.morphTargetInfluences[index];
    const newValue = THREE.MathUtils.lerp(current, 0, resetSpeed);

    // CRITICAL: Clamp to [0, 1] to prevent accumulation
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, newValue));
  }

  // STEP 2: Apply active morph targets
  for (const [visemeName, targetValue] of Object.entries(morphTargets)) {
    const index = mesh.morphTargetDictionary[visemeName];

    if (index === undefined) {
      // Viseme not found in this mesh (normal for Teeth mesh)
      continue;
    }

    // Safety check: ensure index is within bounds
    if (index < 0 || index >= mesh.morphTargetInfluences.length) {
      if (import.meta.env.DEV) {
        console.warn(`[AvatarScene] Invalid morph target index for "${visemeName}": ${index}`);
      }
      continue;
    }

    // CRITICAL: Clamp target value to [0, 1] for safety and reduce exaggeration
    const clampedTarget = Math.max(0, Math.min(1, targetValue)) * 0.75;

    // Smooth interpolation
    const current = mesh.morphTargetInfluences[index];
    const newValue = THREE.MathUtils.lerp(current, clampedTarget, 0.15);

    // CRITICAL: Clamp final value to [0, 1]
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, newValue));
  }
}

// --- Configuration Constants ---
const GAZE_VERTICAL_OFFSET = 1.5; // Adjust to lift head (positive = look head higher)

/**
 * Calculate target yaw and pitch to track the camera smoothly.
 * Returns local rotation offsets.
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {THREE.Camera} camera - Camera reference
 * @returns {{ yaw: number, pitch: number }}
 */
function calculateCameraRotation(headBone, camera) {
  if (!headBone || !camera) {
    return { yaw: 0, pitch: 0 };
  }

  // Get world positions
  const headPos = new THREE.Vector3();
  headBone.getWorldPosition(headPos);

  const cameraPos = new THREE.Vector3();
  camera.getWorldPosition(cameraPos);

  // Apply vertical offset to the target so the avatar looks "higher" (at eyes/lens level)
  cameraPos.y += GAZE_VERTICAL_OFFSET;

  // Direction from head to camera
  const dir = new THREE.Vector3().subVectors(cameraPos, headPos).normalize();

  // Convert to local space of the head's parent to find relative angles
  // However, since we are setting .rotation (local), and assuming the avatar
  // is generally oriented towards the camera, we can use a simpler approach
  // or use a helper to get the local direction.
  const localDir = dir.clone();
  if (headBone.parent) {
    const parentWorldInverse = new THREE.Matrix4().copy(headBone.parent.matrixWorld).invert();
    localDir.applyMatrix4(parentWorldInverse);
  }

  // Calculate Yaw (y-axis rotation) and Pitch (x-axis rotation)
  // In Three.js standard bone orientation (y-up):
  // Yaw is atan2(x, z)
  // Pitch is atan2(y, z) or similar
  // NOTE: We clamp these to avoid the avatar turning its head too far.
  const yaw = THREE.MathUtils.clamp(Math.atan2(localDir.x, localDir.z), -0.4, 0.4); // ±23 deg
  const pitch = THREE.MathUtils.clamp(Math.atan2(-localDir.y, localDir.z), -0.3, 0.3); // ±17 deg

  return { yaw, pitch };
}

/**
 * Apply subtle head motion ONLY (NO spine to prevent body deformation)
 * Creates natural head nodding during speech driven by mouth openness
 * SMOOTH CONTINUOUS MOTION - No cuts or snaps!
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {Object} morphTargets - Current morph targets (to derive motion from mouth openness)
 * @param {number} deltaTime - Time since last frame (for smooth animation)
 * @param {Object} state - Motion state object (for continuity between frames)
 * @param {THREE.Camera} camera - Camera for tracking
 */
function applySubtleHeadMotion(headBone, morphTargets, deltaTime, state, camera) {
  if (!headBone) {
    return;
  }

  // Update time continuously (no jumps!)
  state.time += deltaTime;

  // 1. Camera Tracking Base
  const { yaw: trackYaw, pitch: trackPitch } = calculateCameraRotation(headBone, camera);

  // 2. Speech-driven Motion
  // Calculate mouth openness from viseme influences (AA, E, I, O, U are open vowels)
  const openVowels = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'jawOpen'];
  let mouthOpenness = 0;
  for (const vowel of openVowels) {
    if (morphTargets[vowel]) {
      mouthOpenness = Math.max(mouthOpenness, morphTargets[vowel]);
    }
  }

  // Calculate target rotations using continuous sine waves
  // Pitch (up/down nod) - driven by speech intensity + breathing
  const speechNod = mouthOpenness * 0.015; // Max ~0.86 degrees
  const breathingNod = Math.sin(state.time * 0.3) * 0.008; // Slow breathing rhythm ±0.46 degrees
  const targetPitch = trackPitch + speechNod + breathingNod;

  // Yaw (left/right turn) - drift scales slightly with speech intensity
  const baseYaw = Math.sin(state.time * 0.2) * 0.012; // ±0.69 degrees
  const speechYaw = mouthOpenness * Math.sin(state.time * 0.35) * 0.005; // Subtle speech-driven sway
  const targetYaw = trackYaw + baseYaw + speechYaw;

  // Roll (head tilt) - adds 3D realism, scales slightly with intensity
  const baseRoll = Math.sin(state.time * 0.15) * 0.008; // ±0.46 degrees
  const speechRoll = mouthOpenness * Math.sin(state.time * 0.25) * 0.003;
  const targetRoll = baseRoll + speechRoll;

  // Frame-rate-independent exponential smoothing: 1 - e^(-speed * dt)
  // Coefficients: pitch=4 converges in ~0.75s, yaw=2.5 in ~1.2s, roll=2 in ~1.5s
  const pitchSpeed = 1.0 - Math.exp(-4.0 * deltaTime);
  const yawSpeed = 1.0 - Math.exp(-2.5 * deltaTime);
  const rollSpeed = 1.0 - Math.exp(-2.0 * deltaTime);

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, pitchSpeed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, targetYaw, yawSpeed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, targetRoll, rollSpeed);

  // Apply clamped values to bone
  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.4, 0.4);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw, -0.5, 0.5);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll, -0.2, 0.2);
}

/**
 * Return head to neutral position smoothly when not speaking
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {number} deltaTime - Time since last frame
 * @param {Object} state - Motion state object
 * @param {THREE.Camera} camera - Camera for tracking
 */
function applyReturnToNeutral(headBone, deltaTime, state, camera) {
  if (!headBone) {
    return;
  }

  // Continue time for smooth transition
  state.time += deltaTime;

  // 1. Camera Tracking Base
  const { yaw: trackYaw, pitch: trackPitch } = calculateCameraRotation(headBone, camera);

  // Target is camera position but keep subtle idle motion
  const idleBreathing = Math.sin(state.time * 0.25) * 0.005; // Very subtle breathing
  const idleDrift = Math.sin(state.time * 0.18) * 0.008; // Very subtle drift

  const targetPitch = trackPitch + idleBreathing;
  const targetYaw = trackYaw + idleDrift;
  const targetRoll = 0;

  // Slower return to neutral — exponential smoothing, coefficient 1.5 (converges in ~2s)
  const returnSpeed = 1.0 - Math.exp(-1.5 * deltaTime);

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, returnSpeed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, targetYaw, returnSpeed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, targetRoll, returnSpeed);

  // Apply to bone (clamped for safety)
  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.4, 0.4);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw, -0.5, 0.5);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll, -0.2, 0.2);
}

/**
 * Apply thinking head motion — deliberate slow tilt and drift to convey pondering.
 * Uses the idle animation clip as a base; this function overlays procedural head motion.
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {number} deltaTime - Time since last frame
 * @param {Object} state - Motion state object (for continuity between frames)
 * @param {THREE.Camera} camera - Camera for tracking
 */
function applyThinkingMotion(headBone, deltaTime, state, camera) {
  if (!headBone) {
    return;
  }

  state.time += deltaTime;

  // Thinking: gentle persistent head tilt + slow deliberate drift
  // Tracking is weakened during thinking to simulate "lost in thought"
  const { yaw: trackYaw, pitch: trackPitch } = calculateCameraRotation(headBone, camera);
  const trackingWeight = 0.3; // Only 30% tracking when thinking

  // Slight downward pitch (looking slightly down, as if contemplating)
  const thinkPitch = Math.sin(state.time * 0.15) * 0.01 + 0.012; // Slight downward bias
  // Slower, wider yaw drift (looking side to side slowly)
  const thinkYaw = Math.sin(state.time * 0.1) * 0.018;
  // Subtle persistent tilt (head tilted slightly to one side)
  const thinkRoll = Math.sin(state.time * 0.08) * 0.012 + 0.008; // Slight tilt bias

  const targetPitch = trackPitch * trackingWeight + thinkPitch;
  const targetYaw = trackYaw * trackingWeight + thinkYaw;
  const targetRoll = thinkRoll;

  // Smooth interpolation — exponential smoothing, coefficient 2.0
  const speed = 1.0 - Math.exp(-2.0 * deltaTime);

  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, speed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, targetYaw, speed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, targetRoll, speed);

  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.4, 0.4);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw, -0.5, 0.5);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll, -0.2, 0.2);
}

/**
 * AvatarScene - Pure rendering component for 3D avatar
 *
 * @param {object} props
 * @param {string} props.modelPath - Path to GLB model file
 * @param {string|object} [props.currentAnimation='idle'] - Animation name or timeline directive
 * @param {React.MutableRefObject<Record<string, number>>} [props.morphTargetsRef] - Live viseme ref
 * @param {{ headBob: number, chestBob: number }} [props.bodyMotion] - Subtle body animation
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {(err: Error) => void} [props.onError] - Callback for errors
 * @param {React.RefObject<HTMLAudioElement>} [props.audioRef] - Ref to audio element
 * @param {Array<{ start: number, end: number, value: string }>} [props.mouthCues] - Lip-sync timeline
 * @param {boolean} [props.isPlaying] - Whether audio is currently playing
 * @param {boolean} [props.isMovementEnabled] - Whether full body motion is enabled
 * @param {number} [props.audioGeneration] - Increments on each new audio response
 * @param {string|string[]} [props.currentIntents] - Current response intent labels
 */
const AvatarScene = React.memo(function AvatarScene({
  modelPath,
  currentAnimation = 'idle',
  morphTargetsRef,
  onModelLoaded,
  onError,
  audioRef,
  mouthCues,
  isPlaying,
  emotionData,
  isMovementEnabled = true,
  audioGeneration = 0,
  currentIntents = [],
}) {
  const loadStartRef = useRef(0);

  useEffect(() => {
    loadStartRef.current = performance.now();
    try {
      // Preload model
      useGLTF.preload(modelPath);
    } catch (err) {
      logger.error('[AvatarScene] Failed to preload model:', err);
      onError?.(err);
    }
  }, [modelPath, onError]);

  const handleModelReady = () => {
    onModelLoaded?.();
  };

  const handleModelError = (err) => {
    console.error('[AvatarScene] Model error:', err);
    onError?.(err);
  };

  return (
    <AvatarErrorBoundary
      fallback={
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'rgb(22 22 22)',
          }}
        />
      }
      onError={onError}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <Canvas shadows dpr={[1, 1.5]} camera={CAMERA_CONFIG} gl={GL_CONFIG}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[4, 6, 4]} intensity={1.0} castShadow />
          <directionalLight position={[-4, 5, -3]} intensity={0.35} />
          <pointLight position={[0, 2, 2]} intensity={0.35} />

          <Environment preset="studio" />

          <Suspense fallback={null}>
            <AvatarErrorBoundary fallback={null} onError={handleModelError}>
              <AvatarRig
                modelPath={modelPath}
                currentAnimation={currentAnimation}
                morphTargetsRef={morphTargetsRef}
                onModelLoaded={handleModelReady}
                audioRef={audioRef}
                mouthCues={mouthCues}
                isPlaying={isPlaying}
                isMovementEnabled={isMovementEnabled}
                emotionData={emotionData}
                audioGeneration={audioGeneration}
                currentIntents={currentIntents}
              />
            </AvatarErrorBoundary>
          </Suspense>

          <ContactShadows position={[0, -1.25, 0]} opacity={0.35} scale={10} blur={2} far={4} />

          <OrbitControls
            enablePan={false}
            enableZoom
            minDistance={1.5}
            maxDistance={6.5}
            minPolarAngle={Math.PI / 5}
            maxPolarAngle={Math.PI / 2.15}
            minAzimuthAngle={-Math.PI / 2.5}
            maxAzimuthAngle={Math.PI / 2.5}
          />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
});

export default AvatarScene;

// Preload the default avatar model as soon as this chunk is downloaded
useGLTF.preload('/models/avatar1.glb');

// Warm HTTP cache for critical animations
// THREE.Cache.enabled = true (set above) ensures FBXLoader
// will reuse these cached responses instead of re-downloading
if (typeof window !== 'undefined') {
  ['/models/animations/Idle/Idle.fbx'].forEach((url) => {
    fetch(url, { priority: 'low' }).catch(() => {});
  });
}
