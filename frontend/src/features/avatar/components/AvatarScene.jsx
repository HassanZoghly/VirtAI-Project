/* eslint-disable no-console */
import { ContactShadows, Environment, OrbitControls, useFBX, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AvatarFaceController } from '../AvatarFaceController';
import { ANIMATION_METADATA, getTransitionFade, MORPH_SMOOTHING } from '../constants';
import { useRealismEnhancements } from '../hooks/useRealismEnhancements';
import { logger } from '@/shared/utils/logger';

const CAMERA_CONFIG = { position: [0, 0.2, 3.6], fov: 45, near: 0.01, far: 100 };
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: false };
const TIMELINE_FPS = 30;
const AVATAR_BASE_POSITION = [0, -1.25, 0];
const AVATAR_BASE_SCALE = 1.25;
const SAFE_MIN_DELTA = 1 / 120;
const SAFE_MAX_DELTA = 1 / 15;  // tolerate up to ~66 ms spikes without huge motion jumps

const TALK_VARIANT_PATTERN = /^talk\d\.\d$/i;
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

  sanitized.tracks = sanitized.tracks.filter((track) => {
    const shouldStrip = isRootMotionTrack(track.name);
    if (shouldStrip) {
      removedTrackNames.push(track.name);
    }
    return !shouldStrip;
  });

  sanitized.resetDuration();

  if (removedTrackNames.length > 0 && import.meta.env.DEV) {
    console.debug(
      `[AvatarScene] Root motion disabled for '${clipName}': ${removedTrackNames.join(', ')}`
    );
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
  greeting: [{ fbx: `/models/animations/Greeting/Greeting.fbx${CACHE_BUST}` }],
  idle: [{ fbx: `/models/animations/Idle/Idle.fbx${CACHE_BUST}` }],
  talk11: [{ fbx: `/models/animations/Talk/Talk1.1.fbx${CACHE_BUST}` }],
  talk12: [{ fbx: `/models/animations/Talk/Talk1.2.fbx${CACHE_BUST}` }],
  talk21: [{ fbx: `/models/animations/Talk/Talk2.1.fbx${CACHE_BUST}` }],
  talk22: [{ fbx: `/models/animations/Talk/Talk2.2.fbx${CACHE_BUST}` }],
  talk31: [{ fbx: `/models/animations/Talk/Talk3.1.fbx${CACHE_BUST}` }],
  talk32: [{ fbx: `/models/animations/Talk/Talk3.2.fbx${CACHE_BUST}` }],
  talk41: [{ fbx: `/models/animations/Talk/Talk4.1.fbx${CACHE_BUST}` }],
  talk42: [{ fbx: `/models/animations/Talk/Talk4.2.fbx${CACHE_BUST}` }],
  talk51: [{ fbx: `/models/animations/Talk/Talk5.1.fbx${CACHE_BUST}` }],
  talk52: [{ fbx: `/models/animations/Talk/Talk5.2.fbx${CACHE_BUST}` }],
  talk61: [{ fbx: `/models/animations/Talk/Talk6.1.fbx${CACHE_BUST}` }],
  talk62: [{ fbx: `/models/animations/Talk/Talk6.2.fbx${CACHE_BUST}` }],
  talk71: [{ fbx: `/models/animations/Talk/Talk7.1.fbx${CACHE_BUST}` }],
  talk72: [{ fbx: `/models/animations/Talk/Talk7.2.fbx${CACHE_BUST}` }],
};

// Animation fallback map for missing animations
const ANIMATION_FALLBACK = {
  thinking: 'idle',
  speaking: 'talk1',
  talk: 'talk1',
};

// Fuzzy animation name matching
export const ANIMATION_ALIASES = {
  talk: [
    'talk1',
    'talk2',
    'talk3',
    'talk4',
    'talk5',
    'talk6',
    'talk7',
    'talk1.1',
    'talk1.2',
    'talk2.1',
    'talk2.2',
    'talk3.1',
    'talk3.2',
    'talk4.1',
    'talk4.2',
    'talk5.1',
    'talk5.2',
    'talk6.1',
    'talk6.2',
    'talk7.1',
    'talk7.2',
  ],
  talk1: ['talk1', 'talk1.1', 'talk1.2'],
  talk2: ['talk2', 'talk2.1', 'talk2.2'],
  talk3: ['talk3', 'talk3.1', 'talk3.2'],
  talk4: ['talk4', 'talk4.1', 'talk4.2'],
  talk5: ['talk5', 'talk5.1', 'talk5.2'],
  talk6: ['talk6', 'talk6.1', 'talk6.2'],
  talk7: ['talk7', 'talk7.1', 'talk7.2'],
  idle: ['idle', 'standing', 'neutral'],
  greeting: ['greeting', 'wave', 'hello'],
};

/**
 * Resolve animation name using fuzzy matching
 * @param {string} requestedName - Requested animation name
 * @param {string[]} availableClips - Available clip names
 * @returns {string|null} - Resolved clip name or null
 */
export function resolveAnimationName(requestedName, availableClips) {
  const requested = requestedName.toLowerCase();

  // 1. Exact match (case-insensitive)
  const exactMatch = availableClips.find((clip) => clip.toLowerCase() === requested);
  if (exactMatch) {
    return exactMatch;
  }

  // 2. Check aliases
  const aliases = ANIMATION_ALIASES[requested] || [requested];
  for (const alias of aliases) {
    const match = availableClips.find((clip) => clip.toLowerCase().includes(alias.toLowerCase()));
    if (match) {
      return match;
    }
  }

  // 3. If only one clip exists, use it (auto-select)
  if (availableClips.length === 1) {
    if (import.meta.env.DEV) {
      console.debug(`[AvatarScene] Auto-selecting only available clip: ${availableClips[0]}`);
    }
    return availableClips[0];
  }

  return null;
}

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
 */
const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  currentAnimation,
  morphTargetsRef,
  onModelLoaded,
  audioRef,
  mouthCues,
  isPlaying,
  emotionData,
  audioGeneration,
}) {
  const group = useRef();
  const prefersReducedMotionRef = useRef(
    typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
  );
  const { scene } = useGLTF(modelPath);

  // Load all animation FBX files (static hook calls — must always be the same count)
  const greetingFBX = useFBX(ANIM.greeting[0].fbx);
  const idleFBX = useFBX(ANIM.idle[0].fbx);
  const talk11FBX = useFBX(ANIM.talk11[0].fbx);
  const talk12FBX = useFBX(ANIM.talk12[0].fbx);
  const talk21FBX = useFBX(ANIM.talk21[0].fbx);
  const talk22FBX = useFBX(ANIM.talk22[0].fbx);
  const talk31FBX = useFBX(ANIM.talk31[0].fbx);
  const talk32FBX = useFBX(ANIM.talk32[0].fbx);
  const talk41FBX = useFBX(ANIM.talk41[0].fbx);
  const talk42FBX = useFBX(ANIM.talk42[0].fbx);
  const talk51FBX = useFBX(ANIM.talk51[0].fbx);
  const talk52FBX = useFBX(ANIM.talk52[0].fbx);
  const talk61FBX = useFBX(ANIM.talk61[0].fbx);
  const talk62FBX = useFBX(ANIM.talk62[0].fbx);
  const talk71FBX = useFBX(ANIM.talk71[0].fbx);
  const talk72FBX = useFBX(ANIM.talk72[0].fbx);

  const talkFBXs = useMemo(
    () => [
      { name: 'Talk1.1', fbx: talk11FBX },
      { name: 'Talk1.2', fbx: talk12FBX },
      { name: 'Talk2.1', fbx: talk21FBX },
      { name: 'Talk2.2', fbx: talk22FBX },
      { name: 'Talk3.1', fbx: talk31FBX },
      { name: 'Talk3.2', fbx: talk32FBX },
      { name: 'Talk4.1', fbx: talk41FBX },
      { name: 'Talk4.2', fbx: talk42FBX },
      { name: 'Talk5.1', fbx: talk51FBX },
      { name: 'Talk5.2', fbx: talk52FBX },
      { name: 'Talk6.1', fbx: talk61FBX },
      { name: 'Talk6.2', fbx: talk62FBX },
      { name: 'Talk7.1', fbx: talk71FBX },
      { name: 'Talk7.2', fbx: talk72FBX },
    ],
    [
      talk11FBX,
      talk12FBX,
      talk21FBX,
      talk22FBX,
      talk31FBX,
      talk32FBX,
      talk41FBX,
      talk42FBX,
      talk51FBX,
      talk52FBX,
      talk61FBX,
      talk62FBX,
      talk71FBX,
      talk72FBX,
    ]
  );

  // Log loaded FBX data to verify animations are present
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug('[AvatarScene] FBX Load Status:');
      console.debug('  - Greeting:', greetingFBX?.animations?.length || 0, 'clips');
      console.debug('  - Idle:', idleFBX?.animations?.length || 0, 'clips');
      talkFBXs.forEach(({ name, fbx }) => {
        console.debug(`  - ${name}:`, fbx?.animations?.length || 0, 'clips');
      });
    }
  }, [greetingFBX, idleFBX, talkFBXs]);

  const mixerRef = useRef(null);
  const actionsRef = useRef({});
  const stopInactiveTimerRef = useRef(null);
  const currentActionRef = useRef(null);
  const currentActionNameRef = useRef(null); // Track current action name to prevent re-triggers
  const currentRangeRef = useRef(null);
  const clipNameCacheRef = useRef({}); // Cache resolved names
  const lastPlayedTalkRef = useRef(null); // Track last played talk variant for no-repeat
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

  // Setup animation clips - only include animations that loaded successfully
  const clips = useMemo(() => {
    const result = [];
    const normalizeClip = (clip, name) => {
      const c = clip.clone();
      c.name = name;
      return sanitizeClipRootMotion(c, name);
    };

    const g = greetingFBX?.animations?.[0];
    const i = idleFBX?.animations?.[0];

    if (g) {
      result.push(normalizeClip(g, 'greeting'));
    }
    if (i) {
      result.push(normalizeClip(i, 'idle'));
    }

    // Add all talk variants
    for (const { name, fbx } of talkFBXs) {
      const clip = fbx?.animations?.[0];
      if (clip) {
        result.push(normalizeClip(clip, name));
      }
    }

    if (import.meta.env.DEV) {
      console.debug('[AvatarScene] Loaded clips:', result.map((c) => c.name).join(', '));
    }

    return result;
  }, [greetingFBX, idleFBX, talkFBXs]);

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
    if (!scene || clips.length === 0) {
      return;
    }

    mixerRef.current = new THREE.AnimationMixer(scene);
    const mixer = mixerRef.current;

    const actions = {};
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = true;
      actions[clip.name] = action;
    }
    actionsRef.current = actions;

    // Log available clips for debugging
    if (import.meta.env.DEV) {
      console.debug(
        '[AvatarScene] Available animation clips:',
        clips.map((c) => `${c.name} (${c.duration.toFixed(2)}s)`).join(', ')
      );
    }

    return () => {
      if (stopInactiveTimerRef.current) {
        clearTimeout(stopInactiveTimerRef.current);
        stopInactiveTimerRef.current = null;
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
      currentActionNameRef.current = null; // Reset name tracking
      currentRangeRef.current = null;
    };
  }, [scene, clips]);

  // Play animation with smooth transitions and backend timeline directive support.
  const playAction = (request, { loop = THREE.LoopRepeat, fade } = {}) => {
    const directive = isAnimationDirective(request) ? request : { animation: request };
    const requestedNameRaw = `${directive.animation || 'idle'}`;
    const requestedName = requestedNameRaw.toLowerCase();
    const requestedAsset =
      typeof directive.animationAsset === 'string' ? directive.animationAsset : null;

    const actions = actionsRef.current;
    const availableClips = Object.keys(actions);
    let resolvedName = null;

    if (requestedAsset) {
      resolvedName = resolveAnimationName(requestedAsset, availableClips);
    }

    const isTalkRequest =
      requestedName === 'speaking' || requestedName === 'talk' || /^talk\d$/.test(requestedName);

    if (!resolvedName && isTalkRequest) {
      let variantPool = availableClips.filter((clip) => TALK_VARIANT_PATTERN.test(clip));
      if (/^talk\d$/.test(requestedName)) {
        variantPool = variantPool.filter((clip) =>
          clip.toLowerCase().startsWith(`${requestedName}.`)
        );
      }

      if (variantPool.length > 0) {
        const noRepeatPool =
          variantPool.length > 1
            ? variantPool.filter((clip) => clip !== lastPlayedTalkRef.current)
            : variantPool;
        const pickFrom = noRepeatPool.length > 0 ? noRepeatPool : variantPool;
        resolvedName = pickFrom[Math.floor(Math.random() * pickFrom.length)];
      }
    }

    if (!resolvedName) {
      resolvedName = clipNameCacheRef.current[requestedName];

      if (!resolvedName) {
        resolvedName = resolveAnimationName(requestedName, availableClips);

        if (!resolvedName && ANIMATION_FALLBACK[requestedName]) {
          resolvedName = resolveAnimationName(ANIMATION_FALLBACK[requestedName], availableClips);
        }

        if (resolvedName) {
          clipNameCacheRef.current[requestedName] = resolvedName;
          if (import.meta.env.DEV) {
            console.debug(`[AvatarScene] Resolved '${requestedName}' → '${resolvedName}'`);
          }
        }
      }
    }

    if (!resolvedName) {
      if (import.meta.env.DEV) {
        console.warn(`[AvatarScene] Animation '${requestedNameRaw}' not found`);
      }
      return;
    }

    const hasTimeRange =
      Number.isFinite(directive.startTime) &&
      Number.isFinite(directive.endTime) &&
      directive.endTime > directive.startTime;
    const hasFrameRange =
      !hasTimeRange &&
      Number.isFinite(directive.startFrame) &&
      Number.isFinite(directive.endFrame) &&
      directive.endFrame > directive.startFrame;

    // Don't re-trigger if same animation is already playing
    if (
      currentActionNameRef.current === resolvedName &&
      !hasTimeRange &&
      !hasFrameRange &&
      !requestedAsset &&
      !isTalkRequest
    ) {
      return;
    }

    // CRITICAL: If a talk variant is already playing, don't switch to a new one
    // mid-response — this prevents the jarring flip/angle-change during speaking.
    const currentIsTalkVariant =
      currentActionNameRef.current && TALK_VARIANT_PATTERN.test(currentActionNameRef.current);
    if (isTalkRequest && currentIsTalkVariant && !hasTimeRange && !hasFrameRange && !requestedAsset) {
      return;
    }

    const next = actions[resolvedName];
    if (!next) {
      return;
    }

    const clip = next.getClip();
    const startTime = hasTimeRange
      ? THREE.MathUtils.clamp(directive.startTime, 0, Math.max(0, clip.duration - 0.001))
      : hasFrameRange
      ? THREE.MathUtils.clamp(
          frameToSeconds(directive.startFrame),
          0,
          Math.max(0, clip.duration - 0.001)
        )
      : 0;
    const endTime = hasTimeRange
      ? THREE.MathUtils.clamp(
          directive.endTime,
          startTime + 1 / TIMELINE_FPS,
          Math.max(startTime + 1 / TIMELINE_FPS, clip.duration)
        )
      : hasFrameRange
      ? THREE.MathUtils.clamp(
          frameToSeconds(directive.endFrame),
          startTime + 1 / TIMELINE_FPS,
          clip.duration
        )
      : clip.duration;

    const loopStartTime = hasTimeRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.loopStartTime) ? directive.loopStartTime : startTime,
          startTime,
          endTime
        )
      : hasFrameRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.loopStartFrame)
            ? frameToSeconds(directive.loopStartFrame)
            : startTime,
          startTime,
          endTime
        )
      : 0;
    const loopEndTime = hasTimeRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.loopEndTime) ? directive.loopEndTime : endTime,
          loopStartTime + 1 / TIMELINE_FPS,
          endTime
        )
      : hasFrameRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.loopEndFrame)
            ? frameToSeconds(directive.loopEndFrame)
            : endTime,
          loopStartTime + 1 / TIMELINE_FPS,
          endTime
        )
      : clip.duration;
    const transitionOutTime = hasTimeRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.transitionOutTime) ? directive.transitionOutTime : endTime,
          startTime + 1 / TIMELINE_FPS,
          endTime
        )
      : hasFrameRange
      ? THREE.MathUtils.clamp(
          Number.isFinite(directive.transitionOutFrame)
            ? frameToSeconds(directive.transitionOutFrame)
            : endTime,
          startTime + 1 / TIMELINE_FPS,
          endTime
        )
      : clip.duration;

    const blendFade = Number.isFinite(directive.blend)
      ? THREE.MathUtils.clamp(0.12 + directive.blend * 0.38, 0.08, 0.5)
      : null;

    const playbackSpeed = Number.isFinite(directive.speed)
      ? THREE.MathUtils.clamp(directive.speed, 0.65, 1.45)
      : 1;

    const transitionFadeBoost =
      directive.transitionType === 'pause'
        ? -0.05
        : directive.transitionType === 'emphasis'
          ? 0.06
          : 0;

    const categoryFromName = (name) => {
      const lower = `${name || 'idle'}`.toLowerCase();
      if (lower.startsWith('talk')) {
        return 'talk';
      }
      return ANIMATION_METADATA[lower]?.category ?? lower;
    };

    const fromCategory = categoryFromName(currentActionNameRef.current);
    const toCategory = categoryFromName(resolvedName);
    const fadeDuration = THREE.MathUtils.clamp(
      (fade ?? blendFade ?? getTransitionFade(fromCategory, toCategory)) + transitionFadeBoost,
      0.08,
      0.6
    );

    next.setLoop(loop, Infinity);
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(playbackSpeed);
    next.time = startTime;
    next.fadeIn(fadeDuration).play();

    const cur = currentActionRef.current;
    if (cur && cur !== next) {
      cur.enabled = true;
      cur.fadeOut(fadeDuration);
    }

    for (const action of Object.values(actions)) {
      if (action !== next && action !== cur && action.isRunning()) {
        action.fadeOut(fadeDuration);
      }
    }

    if (stopInactiveTimerRef.current) {
      clearTimeout(stopInactiveTimerRef.current);
    }
    stopInactiveTimerRef.current = window.setTimeout(
      () => {
        for (const action of Object.values(actionsRef.current)) {
          if (action !== currentActionRef.current) {
            action.stop();
            action.enabled = false;
          }
        }
      },
      Math.max(100, fadeDuration * 1000 + 30)
    );

    if (import.meta.env.DEV) {
      console.debug(
        `[AvatarScene] Transition '${currentActionNameRef.current || 'none'}' → '${resolvedName}' (fade ${fadeDuration.toFixed(2)}s)`
      );
    }

    currentActionRef.current = next;
    currentActionNameRef.current = resolvedName;
    currentRangeRef.current = {
      action: next,
      hasFrameRange,
      hasTimeRange,
      startTime,
      endTime,
      loopStartTime,
      loopEndTime,
      transitionOutTime,
    };

    if (isTalkRequest || TALK_VARIANT_PATTERN.test(resolvedName)) {
      lastPlayedTalkRef.current = resolvedName;
    }
  };

  // When a new audio response starts, unlock the talk variant so a fresh one is selected.
  // This allows variety between responses while preventing mid-response churn.
  useEffect(() => {
    if (!audioGeneration) { return; }
    // Only clear if a talk variant is currently locked — idle/greeting don't need resetting
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

    playAction(currentAnimation);
  }, [currentAnimation, scene, clips]);


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

  // Update animation mixer and apply enhanced morph targets with realism
  useFrame((_, dt) => {
    const safeDt = THREE.MathUtils.clamp(dt || 0, SAFE_MIN_DELTA, SAFE_MAX_DELTA);
    const enhancedMorphTargets = enhancedMorphTargetsRef.current || {};
    const currentAnimationName =
      typeof currentAnimation === 'string' ? currentAnimation : currentAnimation?.animation;

    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(safeDt);
    }

    const currentRange = currentRangeRef.current;
    if (
      currentRange &&
      currentActionRef.current === currentRange.action &&
      (currentRange.hasFrameRange || currentRange.hasTimeRange)
    ) {
      const action = currentRange.action;
      const now = action.time;

      if (now < currentRange.startTime) {
        action.time = currentRange.startTime;
      } else if (now >= currentRange.transitionOutTime) {
        const loopSpan = Math.max(
          1 / TIMELINE_FPS,
          currentRange.loopEndTime - currentRange.loopStartTime
        );
        action.time = currentRange.loopStartTime + ((now - currentRange.loopStartTime) % loopSpan);
      }
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
          // Blink morphs: write directly — AvatarFaceController already handles easing
          const isBlink = name === 'eyeBlinkLeft' || name === 'eyeBlinkRight';
          if (isBlink) {
            infl[idx] = clamped;
          } else {
            // For mouth/jaw/viseme targets, take max of lip-sync and emotion to avoid fighting
            const isVisemeRelated = name.startsWith('viseme_') || name === 'jawOpen';
            if (isVisemeRelated) {
              infl[idx] = Math.max(infl[idx], clamped);
            } else {
              infl[idx] = THREE.MathUtils.lerp(infl[idx], clamped, Math.min(safeDt * 10, 1));
            }
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

    // Apply subtle head motion ONLY (NO spine to prevent body deformation)
    const prefersReducedMotion = prefersReducedMotionRef.current;

    if (!prefersReducedMotion) {
      if (isPlaying && headBoneRef.current) {
        applySubtleHeadMotion(
          headBoneRef.current,
          enhancedMorphTargets,
          safeDt,
          headMotionStateRef.current
        );
      } else if (currentAnimationName === 'thinking' && headBoneRef.current) {
        applyThinkingMotion(headBoneRef.current, safeDt, headMotionStateRef.current);
      } else if (headBoneRef.current) {
        // Return head to neutral when not speaking (slower for smoother transition)
        applyReturnToNeutral(headBoneRef.current, safeDt, headMotionStateRef.current);
      }
    }

    // Keep avatar grounded and forward-facing even if source clips contain root drift.
    if (stableSceneTransformRef.current.initialized) {
      scene.position.y = stableSceneTransformRef.current.position.y;
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

  const smoothingFactor = MORPH_SMOOTHING;
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

    // CRITICAL: Clamp target value to [0, 1] for safety
    const clampedTarget = Math.max(0, Math.min(1, targetValue));

    // Smooth interpolation
    const current = mesh.morphTargetInfluences[index];
    const newValue = THREE.MathUtils.lerp(current, clampedTarget, smoothingFactor);

    // CRITICAL: Clamp final value to [0, 1]
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, newValue));
  }
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
 */
function applySubtleHeadMotion(headBone, morphTargets, deltaTime, state) {
  if (!headBone) {
    return;
  }

  // Update time continuously (no jumps!)
  state.time += deltaTime;

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
  const targetPitch = speechNod + breathingNod;

  // Yaw (left/right turn) - drift scales slightly with speech intensity
  const baseYaw = Math.sin(state.time * 0.2) * 0.012; // ±0.69 degrees
  const speechYaw = mouthOpenness * Math.sin(state.time * 0.35) * 0.005; // Subtle speech-driven sway
  const targetYaw = baseYaw + speechYaw;

  // Roll (head tilt) - adds 3D realism, scales slightly with intensity
  const baseRoll = Math.sin(state.time * 0.15) * 0.008; // ±0.46 degrees
  const speechRoll = mouthOpenness * Math.sin(state.time * 0.25) * 0.003;
  const targetRoll = baseRoll + speechRoll;

  // Frame-rate-independent exponential smoothing: 1 - e^(-speed * dt)
  // Coefficients: pitch=4 converges in ~0.75s, yaw=2.5 in ~1.2s, roll=2 in ~1.5s
  const pitchSpeed = 1.0 - Math.exp(-4.0 * deltaTime);
  const yawSpeed   = 1.0 - Math.exp(-2.5 * deltaTime);
  const rollSpeed  = 1.0 - Math.exp(-2.0 * deltaTime);

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, pitchSpeed);
  state.currentYaw   = THREE.MathUtils.lerp(state.currentYaw,   targetYaw,   yawSpeed);
  state.currentRoll  = THREE.MathUtils.lerp(state.currentRoll,  targetRoll,  rollSpeed);

  // Apply clamped values to bone
  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.03,  0.03);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw,  -0.025, 0.025);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll,  -0.02,  0.02);
}

/**
 * Return head to neutral position smoothly when not speaking
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {number} deltaTime - Time since last frame
 * @param {Object} state - Motion state object
 */
function applyReturnToNeutral(headBone, deltaTime, state) {
  if (!headBone) {
    return;
  }

  // Continue time for smooth transition
  state.time += deltaTime;

  // Target is neutral (0, 0, 0) but keep subtle idle motion
  const idleBreathing = Math.sin(state.time * 0.25) * 0.005; // Very subtle breathing
  const idleDrift = Math.sin(state.time * 0.18) * 0.008; // Very subtle drift

  const targetPitch = idleBreathing;
  const targetYaw = idleDrift;
  const targetRoll = 0;

  // Slower return to neutral — exponential smoothing, coefficient 1.5 (converges in ~2s)
  const returnSpeed = 1.0 - Math.exp(-1.5 * deltaTime);

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, returnSpeed);
  state.currentYaw   = THREE.MathUtils.lerp(state.currentYaw,   targetYaw,   returnSpeed);
  state.currentRoll  = THREE.MathUtils.lerp(state.currentRoll,  targetRoll,  returnSpeed);

  // Apply to bone (clamped for safety)
  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.02, 0.02);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw,  -0.02, 0.02);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll,  -0.015, 0.015);
}

/**
 * Apply thinking head motion — deliberate slow tilt and drift to convey pondering.
 * Uses the idle animation clip as a base; this function overlays procedural head motion.
 *
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {number} deltaTime - Time since last frame
 * @param {Object} state - Motion state object (for continuity between frames)
 */
function applyThinkingMotion(headBone, deltaTime, state) {
  if (!headBone) {
    return;
  }

  state.time += deltaTime;

  // Thinking: gentle persistent head tilt + slow deliberate drift
  // Slight downward pitch (looking slightly down, as if contemplating)
  const thinkPitch = Math.sin(state.time * 0.15) * 0.01 + 0.012; // Slight downward bias
  // Slower, wider yaw drift (looking side to side slowly)
  const thinkYaw = Math.sin(state.time * 0.1) * 0.018;
  // Subtle persistent tilt (head tilted slightly to one side)
  const thinkRoll = Math.sin(state.time * 0.08) * 0.012 + 0.008; // Slight tilt bias

  // Smooth interpolation — exponential smoothing, coefficient 2.0
  const speed = 1.0 - Math.exp(-2.0 * deltaTime);

  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, thinkPitch, speed);
  state.currentYaw   = THREE.MathUtils.lerp(state.currentYaw,   thinkYaw,   speed);
  state.currentRoll  = THREE.MathUtils.lerp(state.currentRoll,  thinkRoll,  speed);

  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.03,  0.03);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw,  -0.025, 0.025);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll,  -0.02,  0.02);
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
 * @param {number} [props.audioGeneration] - Increments on each new audio response
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
  audioGeneration = 0,
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
                emotionData={emotionData}
                audioGeneration={audioGeneration}
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
