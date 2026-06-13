/* eslint-disable no-console */
/**
 * AvatarScene.jsx — Dumb Three.js renderer.
 *
 * Responsibilities:
 *   - Render Canvas with lights, environment, orbit controls
 *   - Load GLB model
 *   - Lazy-load FBX animations (idle + talk variants)
 *   - Create AvatarAnimationController + AvatarLipSyncController
 *   - Call update(dt) every frame
 *   - Camera stabilization
 *
 * Does NOT:
 *   - Make animation decisions
 *   - Own state logic
 *   - Process audio
 *   - Handle emotion data directly
 */
import { ContactShadows, Environment, OrbitControls, useFBX, useGLTF } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AvatarAnimationController } from '../AvatarAnimationController';
import { AvatarLipSyncController } from '../AvatarLipSyncController';
import { ANIMATIONS, getAnimationsByType } from '../data/animationRegistry';

THREE.Cache.enabled = true;

// ── Scene Config ─────────────────────────────────────────────────────────────
const CAMERA_CONFIG = { position: [0, -0.5, 4], fov: 35, near: 0.1, far: 100 };
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: false };
const AVATAR_BASE_POSITION = [0, 0, 0];
const AVATAR_BASE_SCALE = 1.25;
const SAFE_MIN_DELTA = 1 / 120;
const SAFE_MAX_DELTA = 1 / 15;

// ── FBX Clip Sanitization ────────────────────────────────────────────────────
// Strip root motion and head/eye tracks from FBX clips so body animations
// don't fight the procedural face system or move the avatar from origin.

function sanitizeClip(clip) {
  const clean = clip.clone();

  clean.tracks = clean.tracks.filter((track) => {
    const name = track.name;

    // Remove leaf bone tracks (crash prevention)
    if (name.includes('_end') || name.includes('End_end')) return false;

    // Remove head/neck/eye tracks — face is controlled by AvatarLipSyncController
    if (
      name.includes('Neck') ||
      name.includes('Head') ||
      name.includes('LeftEye') ||
      name.includes('RightEye')
    ) {
      return false;
    }

    // Remove root motion translation (only for hips/root, to avoid skeleton collapse)
    const lowerName = name.toLowerCase();
    if (lowerName.includes('hips.position') || lowerName.includes('root.position') || lowerName.includes('armature.position')) {
      return false;
    }

    return true;
  });

  return clean;
}

// ── Error Boundary ───────────────────────────────────────────────────────────

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
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

// ── Avatar Rig ───────────────────────────────────────────────────────────────

const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  animationControllerRef,
  morphTargetsRef,
  updateLipSync,
  onModelLoaded,
  audioRef,
  isPlaying,
  isMovementEnabled = true,
  emotionData,
}) {
  const { scene } = useGLTF(modelPath);

  // Refs
  const group = useRef();
  const mixerRef = useRef(null);
  const animControllerRef = useRef(null);
  const lipSyncControllerRef = useRef(null);

  // Loading state
  const idleFBX = useFBX(ANIMATIONS.idle.path);
  const loadedTalkAnimationsRef = useRef(new Map());
  const [talkAnimationRevision, setTalkAnimationRevision] = useState(0);
  const talkPreloadStartedRef = useRef(false);

  // Scene transform stabilization
  const isFirstFrame = useRef(true);
  const stableSceneTransformRef = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    initialized: false,
  });

  // Audio time tracking for lip sync
  const lastAudioTimeRef = useRef(0);
  const wasPlayingAudioRef = useRef(false);

  // ── Model setup: collect morph meshes ──────────────────────────────────
  useEffect(() => {
    if (!scene) return;

    const allMorphMeshes = [];
    scene.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.frustumCulled = false;
        if (child.morphTargetDictionary) {
          allMorphMeshes.push(child);
        }
      }
    });

    // Create lip sync controller
    if (!lipSyncControllerRef.current) {
      lipSyncControllerRef.current = new AvatarLipSyncController();
    }
    lipSyncControllerRef.current.initializeMeshes(allMorphMeshes);

    onModelLoaded?.();
  }, [scene, onModelLoaded]);

  // ── Prepare idle clip ──────────────────────────────────────────────────
  const idleClip = useMemo(() => {
    const raw = idleFBX?.animations?.[0];
    if (!raw) return null;
    const clip = sanitizeClip(raw.clone());
    clip.name = 'idle';
    return clip;
  }, [idleFBX]);

  // ── Capture stable scene transform ─────────────────────────────────────
  useEffect(() => {
    if (!scene || stableSceneTransformRef.current.initialized) return;
    stableSceneTransformRef.current.position.copy(scene.position);
    stableSceneTransformRef.current.quaternion.copy(scene.quaternion);
    stableSceneTransformRef.current.initialized = true;
  }, [scene]);

  // ── Create mixer + animation controller ────────────────────────────────
  useEffect(() => {
    if (!scene || !idleClip) return;

    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;

    const controller = new AvatarAnimationController(mixer);
    animControllerRef.current = controller;

    // Register idle action
    const idleAction = mixer.clipAction(idleClip);
    controller.registerActions({ idle: idleAction });

    // Expose to parent (AvatarController)
    if (animationControllerRef) {
      animationControllerRef.current = controller;
    }

    return () => {
      if (animationControllerRef) {
        animationControllerRef.current = null;
      }
      controller.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      animControllerRef.current = null;
    };
  }, [scene, idleClip, animationControllerRef]);

  // ── Lazy-load talk animations ──────────────────────────────────────────
  useEffect(() => {
    if (talkPreloadStartedRef.current || !idleClip) return;
    talkPreloadStartedRef.current = true;

    let cancelled = false;
    const loader = new FBXLoader();
    const talkAnims = getAnimationsByType('talk');

    const loadAll = async () => {
      for (const anim of talkAnims) {
        if (cancelled || loadedTalkAnimationsRef.current.has(anim.name)) continue;

        try {
          const loaded = await loader.loadAsync(anim.path);
          if (cancelled) return;
          loadedTalkAnimationsRef.current.set(anim.name, loaded);
          setTalkAnimationRevision((r) => r + 1);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn(`[AvatarScene] Failed to load '${anim.name}':`, err);
          }
        }
      }
    };

    const scheduleId =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(() => void loadAll(), { timeout: 1500 })
        : window.setTimeout(() => void loadAll(), 0);

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(scheduleId);
      } else {
        clearTimeout(scheduleId);
      }
    };
  }, [idleClip]);

  // ── Register loaded talk actions with the animation controller ─────────
  useEffect(() => {
    const controller = animControllerRef.current;
    const mixer = mixerRef.current;
    if (!controller || !mixer || loadedTalkAnimationsRef.current.size === 0) return;

    const newActions = {};
    for (const [name, fbx] of loadedTalkAnimationsRef.current.entries()) {
      // Skip if already registered
      if (controller.actions[name]) continue;

      const clip = fbx?.animations?.[0];
      if (!clip) continue;

      const sanitized = sanitizeClip(clip.clone());
      sanitized.name = name;

      const action = mixer.clipAction(sanitized);
      newActions[name] = action;
    }

    if (Object.keys(newActions).length > 0) {
      controller.registerActions(newActions);
    }
  }, [talkAnimationRevision]);

  // ── Forward emotion data ───────────────────────────────────────────────
  useEffect(() => {
    if (lipSyncControllerRef.current && emotionData) {
      lipSyncControllerRef.current.setEmotionData(emotionData);
    }
  }, [emotionData]);

  // ── Forward speaking state ─────────────────────────────────────────────
  useEffect(() => {
    if (lipSyncControllerRef.current) {
      lipSyncControllerRef.current.setSpeaking(!!isPlaying);
    }
  }, [isPlaying]);

  // ── Cleanup ────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (lipSyncControllerRef.current) {
        lipSyncControllerRef.current.dispose();
      }
    };
  }, []);

  // ── Frame loop ─────────────────────────────────────────────────────────
  useFrame((state, dt) => {
    let safeDt = THREE.MathUtils.clamp(dt || 0, SAFE_MIN_DELTA, SAFE_MAX_DELTA);

    // Sync delta to audio clock when available
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

    // 1. Lip sync update (synchronous, from audio clock)
    if (updateLipSync) {
      updateLipSync(safeDt * 1000);
    }

    // 2. Audio diagnostics
    if (audioRef?.current?.updateDiagnostics) {
      audioRef.current.updateDiagnostics();
    }

    // 3. Body animation update (mixer tick)
    if (animControllerRef.current) {
      animControllerRef.current.update(safeDt);
    }

    // 4. Face + lip sync morph application
    if (lipSyncControllerRef.current) {
      const lipSyncMorphs = morphTargetsRef?.current || {};
      lipSyncControllerRef.current.applyToMeshes(safeDt, lipSyncMorphs);
    }

    // 5. Camera stabilization
    // REMOVED: Camera zoom/pan is now fully controlled by OrbitControls. No lerping here.

    // Scene position stabilization (prevent root motion drift)
    // REMOVED: scene position lerping removed since we strip all .position tracks in sanitizeClip

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

// ── Scene Wrapper ────────────────────────────────────────────────────────────

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

          <ContactShadows
            position={[0, -1.25, 0]}
            opacity={0.35}
            scale={10}
            blur={2}
            far={4}
          />
          <OrbitControls
            enablePan={false}
            enableZoom
            target={[0, -0.2, 0]}
            minDistance={1.5}
            maxDistance={6.5}
            minPolarAngle={Math.PI / 5}
            maxPolarAngle={Math.PI / 2}
            minAzimuthAngle={-Math.PI / 2.5}
            maxAzimuthAngle={Math.PI / 2.5}
          />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
});

export default AvatarSceneWrapper;

// Preload model
useGLTF.preload('/models/avatar1.glb');

// Preload idle animation
if (typeof window !== 'undefined') {
  ['/models/animations/Idle/Idle.fbx'].forEach((url) => {
    fetch(url, { priority: 'low' }).catch(() => { });
  });
}
