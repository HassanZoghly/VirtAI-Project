import { ContactShadows, Environment, OrbitControls, useFBX, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AvatarFaceController } from '../AvatarFaceController';
import {
  ANIMATION_METADATA,
  getTransitionFade,
  MORPH_SMOOTHING,
  pickWeightedRandom,
} from '../constants';
import { useRealismEnhancements } from '../hooks/useRealismEnhancements';

const CAMERA_CONFIG = { position: [0, 0.2, 3.6], fov: 45, near: 0.01, far: 100 };
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: false };

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
  talk1: [{ fbx: `/models/animations/Talk/Talk1.fbx${CACHE_BUST}` }],
  talk2: [{ fbx: `/models/animations/Talk/Talk2.fbx${CACHE_BUST}` }],
  talk3: [{ fbx: `/models/animations/Talk/Talk3.fbx${CACHE_BUST}` }],
  talk4: [{ fbx: `/models/animations/Talk/Talk4.fbx${CACHE_BUST}` }],
  talk5: [{ fbx: `/models/animations/Talk/Talk5.fbx${CACHE_BUST}` }],
  talk6: [{ fbx: `/models/animations/Talk/Talk6.fbx${CACHE_BUST}` }],
  talk7: [{ fbx: `/models/animations/Talk/Talk7.fbx${CACHE_BUST}` }],
};

// Animation fallback map for missing animations
const ANIMATION_FALLBACK = {
  thinking: 'idle',
  speaking: 'talk1',
  talk: 'talk1',
};

// Fuzzy animation name matching
export const ANIMATION_ALIASES = {
  talk: ['talk1', 'talk2', 'talk3', 'talk4', 'talk5', 'talk6', 'talk7'],
  talk1: ['talk1'],
  talk2: ['talk2'],
  talk3: ['talk3'],
  talk4: ['talk4'],
  talk5: ['talk5'],
  talk6: ['talk6'],
  talk7: ['talk7'],
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
 * @param {string} [props.currentAnimation] - Animation name ('idle','thinking','speaking','greeting')
 * @param {Record<string, number>} [props.morphTargets] - Viseme names → influence values (0-1)
 * @param {{ headBob: number, chestBob: number }} [props.bodyMotion] - Subtle body animation
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {React.RefObject<HTMLAudioElement>} [props.audioRef] - Ref to audio element
 * @param {Array<{ start: number, end: number, value: string }>} [props.mouthCues] - Lip-sync timeline
 * @param {boolean} [props.isPlaying] - Whether audio is currently playing
 */
const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  currentAnimation,
  morphTargets = {},
  bodyMotion = { headBob: 0, chestBob: 0 },
  onModelLoaded,
  audioRef,
  mouthCues,
  isPlaying,
  emotionData,
}) {
  const group = useRef();
  const { scene } = useGLTF(modelPath);

  // Load all animation FBX files (static hook calls — must always be the same count)
  const greetingFBX = useFBX(ANIM.greeting[0].fbx);
  const idleFBX = useFBX(ANIM.idle[0].fbx);
  const talk1FBX = useFBX(ANIM.talk1[0].fbx);
  const talk2FBX = useFBX(ANIM.talk2[0].fbx);
  const talk3FBX = useFBX(ANIM.talk3[0].fbx);
  const talk4FBX = useFBX(ANIM.talk4[0].fbx);
  const talk5FBX = useFBX(ANIM.talk5[0].fbx);
  const talk6FBX = useFBX(ANIM.talk6[0].fbx);
  const talk7FBX = useFBX(ANIM.talk7[0].fbx);

  const talkFBXs = useMemo(
    () => [
      { name: 'talk1', fbx: talk1FBX },
      { name: 'talk2', fbx: talk2FBX },
      { name: 'talk3', fbx: talk3FBX },
      { name: 'talk4', fbx: talk4FBX },
      { name: 'talk5', fbx: talk5FBX },
      { name: 'talk6', fbx: talk6FBX },
      { name: 'talk7', fbx: talk7FBX },
    ],
    [talk1FBX, talk2FBX, talk3FBX, talk4FBX, talk5FBX, talk6FBX, talk7FBX]
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
  const currentActionRef = useRef(null);
  const currentActionNameRef = useRef(null); // Track current action name to prevent re-triggers
  const clipNameCacheRef = useRef({}); // Cache resolved names
  const lastPlayedTalkRef = useRef(null); // Track last played talk variant for no-repeat

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
  const enhancedMorphTargets = useRealismEnhancements(
    scene,
    morphTargets,
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
      return c;
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
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
      currentActionNameRef.current = null; // Reset name tracking
    };
  }, [scene, clips]);

  // Play animation with smooth transitions and fallback support
  const playAction = (name, { loop = THREE.LoopRepeat, fade } = {}) => {
    const actions = actionsRef.current;
    const availableClips = Object.keys(actions);
    let resolvedName;

    // Weighted random selection for talk/speaking animations
    const isTalkRequest = name === 'speaking' || name === 'talk';
    if (isTalkRequest) {
      const picked = pickWeightedRandom('talk', lastPlayedTalkRef.current);
      if (picked && actions[picked]) {
        resolvedName = picked;
      }
    }

    // Standard resolution for non-talk or if random pick failed
    if (!resolvedName) {
      resolvedName = clipNameCacheRef.current[name];

      if (!resolvedName) {
        resolvedName = resolveAnimationName(name, availableClips);

        if (!resolvedName && ANIMATION_FALLBACK[name]) {
          resolvedName = resolveAnimationName(ANIMATION_FALLBACK[name], availableClips);
        }

        if (resolvedName) {
          clipNameCacheRef.current[name] = resolvedName;
          if (import.meta.env.DEV) {
            console.debug(`[AvatarScene] Resolved '${name}' → '${resolvedName}'`);
          }
        }
      }
    }

    // For talk requests, allow re-triggering with a different variant
    if (!isTalkRequest && currentActionNameRef.current === resolvedName) {
      return;
    }
    // For talk requests, still skip if same variant was picked
    if (isTalkRequest && currentActionNameRef.current === resolvedName) {
      return;
    }

    const next = actions[resolvedName];
    if (!next) {
      if (import.meta.env.DEV) {
        console.warn(`[AvatarScene] Animation '${name}' not found (tried: ${resolvedName})`);
      }
      return;
    }

    // Compute cross-fade duration from transition type if not explicitly provided
    const fromCategory = ANIMATION_METADATA[currentActionNameRef.current]?.category ?? 'idle';
    const toCategory =
      ANIMATION_METADATA[resolvedName]?.category ??
      (resolvedName.startsWith('talk') ? 'talk' : resolvedName);
    const fadeDuration = fade ?? getTransitionFade(fromCategory, toCategory);

    next.setLoop(loop, Infinity);
    next.reset();
    next.enabled = true;
    next.play();

    const cur = currentActionRef.current;
    if (cur && cur !== next) {
      cur.crossFadeTo(next, fadeDuration, false);
    } else {
      next.fadeIn(fadeDuration);
    }

    currentActionRef.current = next;
    currentActionNameRef.current = resolvedName;

    // Track last talk variant for no-repeat logic
    if (isTalkRequest) {
      lastPlayedTalkRef.current = resolvedName;
    }
  };

  // Handle animation changes
  useEffect(() => {
    if (!actionsRef.current || !scene) {
      return;
    }

    playAction(currentAnimation);
  }, [currentAnimation, scene]);

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
    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(dt);
    }

    // Compute face animation targets (blink, idle, emotion, speaking)
    let faceMorphs = {};
    if (faceControllerRef.current) {
      faceMorphs = faceControllerRef.current.update(dt);
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
              infl[idx] = THREE.MathUtils.lerp(infl[idx], clamped, Math.min(dt * 10, 1));
            }
          }
        }
      }
    }

    // Apply ENHANCED morph targets — lip-sync (with coarticulation, jaw coupling, etc.)
    if (headMeshRef.current && headMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(headMeshRef.current, enhancedMorphTargets);
    }
    if (teethMeshRef.current && teethMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(teethMeshRef.current, enhancedMorphTargets);
    }

    // Apply subtle head motion ONLY (NO spine to prevent body deformation)
    if (isPlaying && headBoneRef.current) {
      applySubtleHeadMotion(
        headBoneRef.current,
        enhancedMorphTargets,
        dt,
        headMotionStateRef.current
      );
    } else if (currentAnimation === 'thinking' && headBoneRef.current) {
      applyThinkingMotion(headBoneRef.current, dt, headMotionStateRef.current);
    } else if (headBoneRef.current) {
      // Return head to neutral when not speaking (slower for smoother transition)
      applyReturnToNeutral(headBoneRef.current, dt, headMotionStateRef.current);
    }
  });

  return (
    <group ref={group} position={[0, -1.25, 0]} scale={1.25}>
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
 */
function applyMorphTargetsSmooth(mesh, morphTargets) {
  if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
    return;
  }

  const smoothingFactor = MORPH_SMOOTHING;
  const resetSpeed = 0.15; // Slower reset to avoid jitter

  // Get all viseme indices (morph targets that start with "viseme_" or contain "jaw"/"mouth")
  const visemeIndices = [];
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

  // CRITICAL: Smooth interpolation using delta time for frame-rate independence
  // This ensures motion is smooth regardless of FPS
  const smoothness = 1.0 - Math.pow(0.001, deltaTime); // Exponential smoothing
  const pitchSpeed = Math.min(smoothness * 0.05, 1.0);
  const yawSpeed = Math.min(smoothness * 0.03, 1.0);
  const rollSpeed = Math.min(smoothness * 0.02, 1.0);

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, pitchSpeed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, targetYaw, yawSpeed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, targetRoll, rollSpeed);

  // Apply clamped values to bone
  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.03, 0.03);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw, -0.025, 0.025);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll, -0.02, 0.02);
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

  // Slower return to neutral for smooth transition
  const smoothness = 1.0 - Math.pow(0.001, deltaTime);
  const returnSpeed = Math.min(smoothness * 0.02, 1.0); // Slower than speaking motion

  // Update current state smoothly
  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, targetPitch, returnSpeed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, targetYaw, returnSpeed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, targetRoll, returnSpeed);

  // Apply to bone
  headBone.rotation.x = state.currentPitch;
  headBone.rotation.y = state.currentYaw;
  headBone.rotation.z = state.currentRoll;
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

  // Smooth interpolation — slower than speaking, faster than idle return
  const smoothness = 1.0 - Math.pow(0.001, deltaTime);
  const speed = Math.min(smoothness * 0.03, 1.0);

  state.currentPitch = THREE.MathUtils.lerp(state.currentPitch, thinkPitch, speed);
  state.currentYaw = THREE.MathUtils.lerp(state.currentYaw, thinkYaw, speed);
  state.currentRoll = THREE.MathUtils.lerp(state.currentRoll, thinkRoll, speed);

  headBone.rotation.x = THREE.MathUtils.clamp(state.currentPitch, -0.03, 0.03);
  headBone.rotation.y = THREE.MathUtils.clamp(state.currentYaw, -0.025, 0.025);
  headBone.rotation.z = THREE.MathUtils.clamp(state.currentRoll, -0.02, 0.02);
}

/**
 * AvatarScene - Pure rendering component for 3D avatar
 *
 * @param {object} props
 * @param {string} props.modelPath - Path to GLB model file
 * @param {string} [props.currentAnimation='idle'] - Animation name ('idle','thinking','speaking','greeting')
 * @param {Record<string, number>} [props.morphTargets] - Viseme names → influence values (0-1)
 * @param {{ headBob: number, chestBob: number }} [props.bodyMotion] - Subtle body animation
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {(err: Error) => void} [props.onError] - Callback for errors
 * @param {React.RefObject<HTMLAudioElement>} [props.audioRef] - Ref to audio element
 * @param {Array<{ start: number, end: number, value: string }>} [props.mouthCues] - Lip-sync timeline
 * @param {boolean} [props.isPlaying] - Whether audio is currently playing
 */
const AvatarScene = React.memo(function AvatarScene({
  modelPath,
  currentAnimation = 'idle',
  morphTargets = {},
  bodyMotion = { headBob: 0, chestBob: 0 },
  onModelLoaded,
  onError,
  audioRef,
  mouthCues,
  isPlaying,
  emotionData,
}) {
  const loadStartRef = useRef(0);

  useEffect(() => {
    loadStartRef.current = performance.now();
    try {
      // Preload model
      useGLTF.preload(modelPath);
    } catch (err) {
      console.error('[AvatarScene] Failed to preload model:', err);
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
                morphTargets={morphTargets}
                bodyMotion={bodyMotion}
                onModelLoaded={handleModelReady}
                audioRef={audioRef}
                mouthCues={mouthCues}
                isPlaying={isPlaying}
                emotionData={emotionData}
              />
            </AvatarErrorBoundary>
          </Suspense>

          <ContactShadows position={[0, -1.25, 0]} opacity={0.35} scale={10} blur={2} far={4} />

          <OrbitControls
            enablePan={false}
            enableZoom
            minDistance={1.5}
            maxDistance={6.5}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={Math.PI / 2}
          />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
});

export default AvatarScene;
