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
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AvatarAnimationController } from '../AvatarAnimationController';
import { AvatarLipSyncController } from '../AvatarLipSyncController';
import { getAnimationsByType } from '../data/animationRegistry';

THREE.Cache.enabled = true;

// ── Scene Config ─────────────────────────────────────────────────────────────
const CAMERA_CONFIG = { position: [0, 1.5, 2.5], fov: 30, near: 0.01, far: 100 };
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: false };
const AVATAR_BASE_POSITION = [0, -1.5, 0];
const AVATAR_BASE_SCALE = 1.25;
const SAFE_MIN_DELTA = 1 / 120;
const SAFE_MAX_DELTA = 1 / 15;

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
  const { camera, controls } = useThree();

  // ── Auto Camera Framing ────────────────────────────────────────────────
  // REMOVED: Auto Camera Framing is deleted so OrbitControls has 100% control.
  const lipSyncControllerRef = useRef(null);

  // Loading state
  const [idleFBX, setIdleFBX] = useState(null);
  
  useEffect(() => {
    const idleEntry = getAnimationsByType('idle')[0];
    if (!idleEntry) return;

    const loader = new FBXLoader();
    loader.loadAsync(idleEntry.path)
      .then(fbx => {
        setIdleFBX(fbx);
        const rawClip = fbx.animations?.[0];
        if (rawClip && animControllerRef.current) {
          const clip = rawClip.clone();
          clip.name = 'idle';
          animControllerRef.current.setIdleClip(clip);
          animControllerRef.current.playIdle();
        }
      })
      .catch(err => {
        console.warn('[AvatarScene] Idle animation load failed, rendering without idle clip:', err);
      });
  }, []);
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

  // ── Enforce Frustum Culling ────────────────────────────────────────────
  useEffect(() => {
      if (scene) {
          scene.traverse((child) => {
              if (child.isMesh) {
                  child.frustumCulled = false;
              }
          });
      }
  }, [scene]);

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

  // ── Capture stable scene transform ─────────────────────────────────────
  useEffect(() => {
    if (!scene || stableSceneTransformRef.current.initialized) return;
    stableSceneTransformRef.current.position.copy(scene.position);
    stableSceneTransformRef.current.quaternion.copy(scene.quaternion);
    stableSceneTransformRef.current.initialized = true;
  }, [scene]);

  // ── Create mixer + animation controller ────────────────────────────────
  useEffect(() => {
    if (!scene) return;

    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;

    const controller = new AvatarAnimationController(mixer);
    animControllerRef.current = controller;

    // Check if idleFBX is already loaded (in case scene re-mounts)
    if (idleFBX) {
      const rawClip = idleFBX.animations?.[0];
      if (rawClip) {
        const clip = rawClip.clone();
        clip.name = 'idle';
        controller.setIdleClip(clip);
        controller.playIdle();
      }
    }

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
  }, [scene, idleFBX, animationControllerRef]);

  // ── Lazy-load talk animations ──────────────────────────────────────────
  useEffect(() => {
    if (talkPreloadStartedRef.current) return;
    talkPreloadStartedRef.current = true;

    let cancelled = false;
    const loader = new FBXLoader();
    const talkAnimations = getAnimationsByType('talk');

    const loadAll = async () => {
      for (const anim of talkAnimations) {
        if (cancelled || loadedTalkAnimationsRef.current.has(anim.name)) continue;

        try {
          const loaded = await loader.loadAsync(anim.path);
          if (cancelled) return;
          loadedTalkAnimationsRef.current.set(anim.name, loaded);
          setTalkAnimationRevision((r) => r + 1);
        } catch (err) {
          console.warn(`[AvatarScene] Animation load failed for '${anim.name}' at path '${anim.path}':`, err);
          // DO NOT crash the setup, just ignore the missing animation
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
  }, [idleFBX]);

  // ── Register loaded talk actions with the animation controller ─────────
  useEffect(() => {
    const controller = animControllerRef.current;
    if (!controller || loadedTalkAnimationsRef.current.size === 0) return;

    for (const [name, fbx] of loadedTalkAnimationsRef.current.entries()) {
      // Skip if already registered
      if (controller.actions[name]) continue;

      const clip = fbx?.animations?.[0];
      if (!clip) continue;

      const clone = clip.clone();
      clone.name = name;

      controller.addTalkClip(name, clone);
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
      animControllerRef.current.checkAndForceIdle();
    }

    // 4. Face + lip sync morph application
    if (lipSyncControllerRef.current) {
      const lipSyncMorphs = morphTargetsRef?.current || {};
      lipSyncControllerRef.current.applyToMeshes(safeDt, lipSyncMorphs);
    }

    // 5. Camera stabilization
    // REMOVED: Camera zoom/pan is now fully controlled by OrbitControls. No lerping here.

    // Lock the scene root in place to prevent the model from drifting/walking forward out of the group
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
      <primitive object={scene} scale={1} position={[0, -1.6, 0]} />
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
            makeDefault
            enablePan={false}
            enableZoom={false}
            enableRotate={false}
            target={[0, 1.3, 0]}
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
