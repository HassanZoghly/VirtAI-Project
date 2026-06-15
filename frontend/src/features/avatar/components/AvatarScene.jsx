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
import { ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AvatarAnimationController } from '../AvatarAnimationController';
import { AvatarLipSyncController } from '../AvatarLipSyncController';
import {
  formatMissingTalkAnimationsWarning,
  getAnimationsByType,
  getMissingTalkAnimationNames,
} from '../data/animationRegistry';
import { getAvatarRigProfile } from '../data/avatarRigProfiles';
import { getCameraPreset } from '../data/cameraPresets';
import {
  FIRST_FRAME_VALIDATION_ACTIONS,
  captureAvatarFailureScreenshot,
  computeAvatarCameraFit,
  emitAvatarFailureScreenshot,
  emitAvatarVisibilityTelemetry,
  evaluateAvatarFirstFrameValidation,
  hasVisibleFramebufferPixels,
  isAvatarDebugEnabled,
} from '../utils/avatarFirstFrameValidation';
import { logger } from '@/shared/utils/logger';

THREE.Cache.enabled = true;

// ── Scene Config ─────────────────────────────────────────────────────────────
const GL_CONFIG = { antialias: true, alpha: true, preserveDrawingBuffer: isAvatarDebugEnabled() };
// NOTE: Avatar positioning is now controlled SOLELY by avatarRigProfiles.js.
// Do NOT add additional hardcoded offsets here.
const SAFE_MIN_DELTA = 1 / 120;
const SAFE_MAX_DELTA = 1 / 15;

// ── Error Boundary ───────────────────────────────────────────────────────────

class AvatarErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, error: err };
  }
  componentDidCatch(err, errorInfo) {
    if (isAvatarDebugEnabled()) {
      console.error('[DIAG][AvatarErrorBoundary] ❌ Caught render error:', err.message);
      console.error('[DIAG][AvatarErrorBoundary] Component stack:', errorInfo?.componentStack);
    }
    if (this.props.onError) {
      this.props.onError(err);
    }
  }
  render() {
    if (this.state.hasError) {
      if (isAvatarDebugEnabled()) {
        console.warn('[DIAG][AvatarErrorBoundary] Rendering fallback. Error was:', this.state.error?.message);
      }
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

// ── Avatar Rig ───────────────────────────────────────────────────────────────

const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  avatarId,
  animationControllerRef,
  morphTargetsRef,
  updateLipSync,
  onModelLoaded,
  audioRef,
  isPlaying,
  emotionData,
  avatarLifecycleState,
  onFirstFrameValidated,
  onRenderFailure,
}) {
  const renderCountRef = useRef(0);
  useEffect(() => {
    if (isAvatarDebugEnabled()) {
      renderCountRef.current++;
      console.info(`[DIAG][AvatarRig] 🔄 Render #${renderCountRef.current} with modelPath:`, modelPath, 'avatarId:', avatarId);
    }
  });

  useEffect(() => {
    if (isAvatarDebugEnabled()) {
      console.info('[DIAG][AvatarRig] 🟢 MOUNTED. avatarId:', avatarId);
      return () => console.info('[DIAG][AvatarRig] 🔴 UNMOUNTED');
    }
  }, [avatarId]);

  // Resolve rig profile — single source of truth for position/scale
  const rigProfile = useMemo(() => {
    // Default fallback - moved Y up from -1.25 to -0.9 so the head is closer to the camera target (1.3)
    return getAvatarRigProfile(avatarId) || { position: [0, -0.9, 0], scale: 1.25 };
  }, [avatarId]);

  const { scene } = useGLTF(modelPath);
  if (isAvatarDebugEnabled()) {
    console.info('[DIAG][AvatarRig]', scene ? '✅ useGLTF returned scene' : '❌ useGLTF returned null', 'children:', scene?.children?.length);
  }
  
  // DIAG: Initial scene position
  useEffect(() => {
    if (isAvatarDebugEnabled() && scene) {
      console.info('[DIAG][AvatarRig] 📍 scene.position IMMEDIATELY after useGLTF:', `[${scene.position.x.toFixed(3)}, ${scene.position.y.toFixed(3)}, ${scene.position.z.toFixed(3)}]`);
    }
  }, [scene]);

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
  const [isIdleReady, setIsIdleReady] = useState(false);
  
  useEffect(() => {
    const idleEntry = getAnimationsByType('idle')[0];
    if (!idleEntry) return;

    const loader = new FBXLoader();
    loader.loadAsync(idleEntry.path)
      .then(fbx => {
        // Only store the FBX — Effect 2 (dep: [idleFBX]) will register + play it
        // once the animation controller is confirmed ready via animControllerRef.
        setIdleFBX(fbx);
      })
      .catch(err => {
        logger.warn('[AvatarScene] Idle animation load failed, rendering without idle clip:', err);
      });
  }, []);
  const loadedTalkAnimationsRef = useRef(new Map());
  const [talkAnimationRevision, setTalkAnimationRevision] = useState(0);
  const talkPreloadStartedRef = useRef(false);

  // Scene transform stabilization
  const frameDiagRef = useRef(null);
  const diagDoneRef = useRef(false); // Phase 0 diagnostic — one-time bbox/frustum check
  const rescueAttemptedRef = useRef(false); // Track if we've tried to rescue the camera
  const rescueWaitFramesRef = useRef(0); // Frame countdown after rescue fit (approved 2-frame pattern)
  const cameraFitAppliedRef = useRef(false);
  const cameraFitWaitFramesRef = useRef(0);
  const visibilityFrameCountRef = useRef(0);
  // Single-fire guards — reset by epoch-key remount (new component instance), not re-render
  const firstFrameValidatedRef = useRef(false);
  const renderFailureReportedRef = useRef(false);
  const consecutiveValidFramesRef = useRef(0);
  const consecutiveInvalidFramesRef = useRef(0);
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
    if (!scene) {
      if (isAvatarDebugEnabled()) console.warn('[DIAG][AvatarRig] Model setup skipped — scene is falsy');
      return;
    }

    let totalMeshes = 0;
    let totalSkinnedMeshes = 0;
    const allMorphMeshes = [];
    scene.traverse((child) => {
      if (child.isMesh) totalMeshes++;
      if (child.isSkinnedMesh) totalSkinnedMeshes++;
      if (child.isMesh || child.isSkinnedMesh) {
        child.frustumCulled = false;
        if (child.morphTargetDictionary) {
          allMorphMeshes.push(child);
        }
      }
    });

    if (isAvatarDebugEnabled()) {
      console.info('[DIAG][AvatarRig] 📊 Model census:', {
        modelPath,
        totalMeshes,
        totalSkinnedMeshes,
        morphMeshes: allMorphMeshes.length,
        morphTargetNames: allMorphMeshes[0] ? Object.keys(allMorphMeshes[0].morphTargetDictionary).slice(0, 10) : '(none)',
        scenePosition: `[${scene.position.x.toFixed(2)}, ${scene.position.y.toFixed(2)}, ${scene.position.z.toFixed(2)}]`,
        sceneScale: `[${scene.scale.x.toFixed(2)}, ${scene.scale.y.toFixed(2)}, ${scene.scale.z.toFixed(2)}]`,
      });

      const bbox = new THREE.Box3().setFromObject(scene);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      console.info('[DIAG][AvatarRig] 📦 Raw scene bbox:', {
        center: `[${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}]`,
        size: `[${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)}]`,
        min: `[${bbox.min.x.toFixed(3)}, ${bbox.min.y.toFixed(3)}, ${bbox.min.z.toFixed(3)}]`,
        max: `[${bbox.max.x.toFixed(3)}, ${bbox.max.y.toFixed(3)}, ${bbox.max.z.toFixed(3)}]`,
        isEmpty: bbox.isEmpty(),
      });

      if (totalMeshes === 0) {
        console.error('[DIAG][AvatarRig] ❌ ZERO meshes found in loaded scene — model may be empty or corrupt');
      }
    }

    // Create lip sync controller
    if (!lipSyncControllerRef.current) {
      lipSyncControllerRef.current = new AvatarLipSyncController();
    }
    lipSyncControllerRef.current.initializeMeshes(allMorphMeshes);

    if (isAvatarDebugEnabled()) {
      console.info('[DIAG][AvatarRig] ✅ Calling onModelLoaded()');
    }
    onModelLoaded?.();
  }, [scene, onModelLoaded, modelPath]);

  // ── Capture stable scene transform ─────────────────────────────────────
  useEffect(() => {
    if (!scene) return;
    if (!stableSceneTransformRef.current.initialized) {
      stableSceneTransformRef.current.position.copy(scene.position);
      stableSceneTransformRef.current.quaternion.copy(scene.quaternion);
      stableSceneTransformRef.current.initialized = true;
    }

    if (isAvatarDebugEnabled()) {
      const driftInterval = setInterval(() => {
        if (!scene || !group.current) return;
        
        let firstMesh = null;
        scene.traverse((child) => {
          if (!firstMesh && child.isSkinnedMesh) firstMesh = child;
        });

        console.info('[DIAG][SceneDrift] scene.position:', `[${scene.position.x.toFixed(3)}, ${scene.position.y.toFixed(3)}, ${scene.position.z.toFixed(3)}]`, 
          'camera.position:', `[${camera.position.x.toFixed(3)}, ${camera.position.y.toFixed(3)}, ${camera.position.z.toFixed(3)}]`);

        if (firstMesh) {
          let hasNanBones = false;
          if (firstMesh.skeleton && firstMesh.skeleton.bones.length > 0) {
            const bp = firstMesh.skeleton.bones[0].position;
            if (isNaN(bp.x) || isNaN(bp.y) || isNaN(bp.z)) hasNanBones = true;
          }

          let hasNanMorphs = false;
          if (firstMesh.morphTargetInfluences) {
            for (let i = 0; i < firstMesh.morphTargetInfluences.length; i++) {
              if (isNaN(firstMesh.morphTargetInfluences[i])) hasNanMorphs = true;
            }
          }

          console.info('[DIAG][MeshCheck] Mesh:', firstMesh.name, 
            'visible:', firstMesh.visible,
            'nanBones:', hasNanBones,
            'nanMorphs:', hasNanMorphs
          );
        }
      }, 5000);

      return () => clearInterval(driftInterval);
    }
  }, [scene, camera]);

  // ── Effect 1: Create mixer + animation controller ONCE when scene is ready ──
  // Dependency: [scene] ONLY — never re-runs when FBX loads or controller ref changes.
  useEffect(() => {
    if (!scene) return;

    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;

    const controller = new AvatarAnimationController(mixer);
    animControllerRef.current = controller;

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
  }, [scene, animationControllerRef]); // idleFBX intentionally omitted.

  // ── Effect 2: Register idle animation when FBX finishes loading ─────────────
  // Dependency: [idleFBX] — runs only when the FBX load completes.
  // Reads animControllerRef.current (a ref — intentionally not a dep).
  useEffect(() => {
    if (!idleFBX || !animControllerRef.current) return;

    const rawClip = idleFBX.animations?.[0];
    if (!rawClip) {
      logger.warn('[AvatarScene] Idle FBX loaded but contained no animation clips.');
      return;
    }

    const clip = rawClip.clone();
    clip.name = 'idle';
    animControllerRef.current.setIdleClip(clip);
    animControllerRef.current.playIdle();

    if (isAvatarDebugEnabled() && scene) {
      console.info('[DIAG][AvatarRig] 🎬 Idle animation registered & started. scene.position:', `[${scene.position.x.toFixed(3)}, ${scene.position.y.toFixed(3)}, ${scene.position.z.toFixed(3)}]`);
    }
    
    // Give it a tiny delay to ensure the pose is applied to the meshes before validation
    setTimeout(() => setIsIdleReady(true), 50);
  }, [idleFBX, scene]); // Added `scene` to dependencies to handle race condition where idleFBX loads before scene

  // ── Lazy-load talk animations ──────────────────────────────────────────
  useEffect(() => {
    if (talkPreloadStartedRef.current) return;
    talkPreloadStartedRef.current = true;

    let cancelled = false;
    const loader = new FBXLoader();
    const talkAnimations = getAnimationsByType('talk');
    const missingTalkAnimations = getMissingTalkAnimationNames();

    if (isAvatarDebugEnabled() && missingTalkAnimations.length > 0) {
      logger.warn(`[AvatarScene] ${formatMissingTalkAnimationsWarning(missingTalkAnimations)}`);
    }

    const loadAll = async () => {
      for (const anim of talkAnimations) {
        if (cancelled || loadedTalkAnimationsRef.current.has(anim.name)) continue;

        try {
          const loaded = await loader.loadAsync(anim.path);
          if (cancelled) return;
          loadedTalkAnimationsRef.current.set(anim.name, loaded);
          setTalkAnimationRevision((r) => r + 1);
        } catch (err) {
          logger.warn(`[AvatarScene] ${anim.name} missing or failed to load at '${anim.path}':`, err);
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
  }, [talkAnimationRevision, scene]);

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
  // eslint-disable-next-line react-hooks/immutability
  useFrame((state, dt) => {
    const currentScene = state.scene;
    const currentControls = state.controls || controls;
    let safeDt = THREE.MathUtils.clamp(dt || 0, SAFE_MIN_DELTA, SAFE_MAX_DELTA);
    visibilityFrameCountRef.current += 1;

    // ── PHASE 0: one-time bbox + frustum check after first frame ──
    if (!diagDoneRef.current && group.current && currentScene && isIdleReady) {
      if (cameraFitAppliedRef.current && cameraFitWaitFramesRef.current > 0) {
        cameraFitWaitFramesRef.current--;
        return; // let the camera fit render before validating visibility
      }

      // If rescue was applied, count down frames before re-validating
      if (rescueAttemptedRef.current && rescueWaitFramesRef.current > 0) {
        rescueWaitFramesRef.current--;
        return; // skip validation — let the camera/controls propagate
      }

      diagDoneRef.current = true; // assume done; only unset for rescue retry

      // Compute world-space bbox of the positioned group
      const worldBox = new THREE.Box3().setFromObject(group.current);
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      const worldSize = worldBox.getSize(new THREE.Vector3());

      if (!cameraFitAppliedRef.current && !worldBox.isEmpty()) {
        const cameraFit = computeAvatarCameraFit({
          worldCenter: worldCenter.toArray(),
          worldSize: worldSize.toArray(),
          fovDeg: camera.fov,
          aspect: camera.aspect,
        });
        const target = new THREE.Vector3(...cameraFit.target);
        const position = new THREE.Vector3(...cameraFit.position);

        camera.position.copy(position);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        if (currentControls) {
          currentControls.target.copy(target);
          // eslint-disable-next-line react-hooks/immutability
          currentControls.enableDamping = false;
          currentControls.update();
        }

        cameraFitAppliedRef.current = true;
        cameraFitWaitFramesRef.current = 5;
        diagDoneRef.current = false;

        if (isAvatarDebugEnabled()) {
          console.info('[DIAG][AvatarRig] 📷 Applied one-time camera fit before validation:', {
            target: cameraFit.target.map((v) => v.toFixed(3)),
            position: cameraFit.position.map((v) => v.toFixed(3)),
            distance: cameraFit.distance.toFixed(3),
          });
        }

        return;
      }

      // Camera frustum check
      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);
      const isInFrustum = frustum.intersectsBox(worldBox);

      let visibleMeshes = 0;
      let hasNaN = false;
      scene.traverse((child) => {
        if (child.isMesh && child.visible) visibleMeshes++;
        if (child.isBone) {
          const wPos = new THREE.Vector3();
          child.getWorldPosition(wPos);
          if (Number.isNaN(wPos.x) || Number.isNaN(wPos.y) || Number.isNaN(wPos.z)) {
            hasNaN = true;
          }
        }
      });

      if (isAvatarDebugEnabled()) {
        console.info('[DIAG][AvatarRig] 🎯 FIRST FRAME — World-space diagnostics:', {
          groupPosition: group.current.position.toArray().map(v => v.toFixed(3)),
          groupScale: group.current.scale.toArray().map(v => v.toFixed(3)),
          rigProfilePosition: rigProfile.position,
          rigProfileScale: rigProfile.scale,
          avatarId: avatarId || '(none)',
          worldBboxCenter: worldCenter.toArray().map(v => v.toFixed(3)),
          worldBboxSize: worldSize.toArray().map(v => v.toFixed(3)),
          worldBboxMin: worldBox.min.toArray().map(v => v.toFixed(3)),
          worldBboxMax: worldBox.max.toArray().map(v => v.toFixed(3)),
          bboxIsEmpty: worldBox.isEmpty(),
          cameraPosition: camera.position.toArray().map(v => v.toFixed(3)),
          cameraFov: camera.fov,
          isInCameraFrustum: isInFrustum,
        });
      }

      const pixelVisible = isAvatarDebugEnabled() ? hasVisibleFramebufferPixels(state.gl) : true;
      const validationResult = evaluateAvatarFirstFrameValidation({
        isWorldBoxEmpty: worldBox.isEmpty(),
        visibleMeshes,
        hasNaN,
        isInFrustum,
        rescueAttempted: rescueAttemptedRef.current,
        hasRenderedPixels: pixelVisible,
      });

      const createVisibilityTelemetryPayload = (overrides = {}) => ({
        avatarId: avatarId || null,
        lifecycleState: avatarLifecycleState || null,
        bboxValid: !worldBox.isEmpty(),
        bboxSize: worldSize.toArray(),
        inFrustum: isInFrustum,
        pixelVisible,
        rescueAttempted: rescueAttemptedRef.current,
        rescueSucceeded:
          rescueAttemptedRef.current &&
          validationResult.action === FIRST_FRAME_VALIDATION_ACTIONS.SUCCESS,
        avatarScale: group.current.scale.toArray(),
        avatarPosition: group.current.position.toArray(),
        cameraPosition: camera.position.toArray(),
        cameraTarget: controls?.target?.toArray?.() ?? null,
        cameraNear: camera.near,
        cameraFar: camera.far,
        fov: camera.fov,
        frameCountAtDecision: visibilityFrameCountRef.current,
        failureReason: validationResult.failureReason ?? null,
        timestamp: new Date().toISOString(),
        ...overrides,
      });

      if (validationResult.action === FIRST_FRAME_VALIDATION_ACTIONS.REQUEST_RESCUE) {
        // First attempt — apply rescue fit, then wait 5 frames for propagation
        rescueAttemptedRef.current = true;
        rescueWaitFramesRef.current = 5;
        diagDoneRef.current = false; // re-enter this block after countdown
        emitAvatarVisibilityTelemetry(
          createVisibilityTelemetryPayload({
            rescueAttempted: true,
            rescueSucceeded: false,
          })
        );

        if (isAvatarDebugEnabled()) {
          console.warn('[DIAG][AvatarRig] ⚠️ AVATAR IS OUTSIDE CAMERA FRUSTUM — Attempting one-time rescue fit (2-frame wait)');
        }
        if (controls) {
          const center = worldBox.getCenter(new THREE.Vector3());
          center.y += worldSize.y * 0.3; // ~80% of model height (center is at 50%, add 30%)
          const fovRad = camera.fov * THREE.MathUtils.DEG2RAD;
          const distance = worldSize.y / (2 * Math.tan(fovRad / 2));
          camera.position.set(center.x, center.y, center.z + distance);
          controls.target.copy(center);
          controls.update();
        }
        return; // Defer callbacks until 2 frames later
      }

      // Single-fire callbacks — each fires at most once per mount
      if (validationResult.action === FIRST_FRAME_VALIDATION_ACTIONS.FAILURE) {
        consecutiveInvalidFramesRef.current++;
        if (consecutiveInvalidFramesRef.current < 5) return; // Wait 5 consecutive invalid frames
        
        if (!renderFailureReportedRef.current) {
          renderFailureReportedRef.current = true;
          const timestamp = new Date().toISOString();
          emitAvatarVisibilityTelemetry(
            createVisibilityTelemetryPayload({
              rescueSucceeded: false,
              timestamp,
            })
          );
          const screenshotDataUrl = captureAvatarFailureScreenshot(state.gl);
          emitAvatarFailureScreenshot({
            avatarId: avatarId || null,
            failureReason: validationResult.failureReason,
            screenshotDataUrl,
            timestamp,
          });
          if (isAvatarDebugEnabled()) {
            console.error(`[DIAG][AvatarRig] ❌ First frame validation failed: ${validationResult.reason}`);
          }
          onRenderFailure?.(new Error(`First frame validation failed: ${validationResult.reason}`));
        }
      } else {
        consecutiveValidFramesRef.current++;
        if (consecutiveValidFramesRef.current < 2) return; // Wait 2 consecutive valid frames
        
        if (!firstFrameValidatedRef.current) {
          firstFrameValidatedRef.current = true;
          emitAvatarVisibilityTelemetry(
            createVisibilityTelemetryPayload({
              failureReason: null,
            })
          );
          if (isAvatarDebugEnabled()) console.info('[DIAG][AvatarRig] ✅ Avatar IS inside camera frustum and validated — should be visible');
          onFirstFrameValidated?.();
        }
      }

      // Renderer state (dev only)
      if (isAvatarDebugEnabled()) {
        const gl = state.gl;
        console.info('[DIAG][AvatarRig] 🖥️ Renderer state:', {
          rendererType: gl?.constructor?.name,
          canvasWidth: gl?.domElement?.width,
          canvasHeight: gl?.domElement?.height,
          pixelRatio: gl?.getPixelRatio?.(),
          contextLost: gl?.getContext?.()?.isContextLost?.() ?? 'unknown',
        });
      }
    }

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

    // DIAG: Frame counting for 5 seconds
    if (!frameDiagRef.current) frameDiagRef.current = { count: 0, time: 0 };
    frameDiagRef.current.count++;
    frameDiagRef.current.time += safeDt;
    
    // Deep trace at frame 60 and frame 120
    if (isAvatarDebugEnabled()) {
      if (frameDiagRef.current.count === 60 || frameDiagRef.current.count === 120 || frameDiagRef.current.count === 180) {
        console.warn(`[DIAG][DEEP_TRACE] 🔍 Frame ${frameDiagRef.current.count} (${frameDiagRef.current.time.toFixed(1)}s) Deep Visibility Audit`);
        
        const gl = state.gl;
        console.info('[DIAG][DEEP_TRACE] 📷 Camera & Renderer:', {
          cameraPos: state.camera.position.toArray().map(n => n.toFixed(3)),
          cameraTarget: controls?.target ? controls.target.toArray().map(n => n.toFixed(3)) : 'OrbitControls undefined',
          canvasSize: `${gl?.domElement?.width}x${gl?.domElement?.height}`,
          contextLost: gl?.getContext?.()?.isContextLost?.()
        });

        if (mixerRef.current) {
          // Collect active actions
          const activeActions = [];
          for (let i = 0; i < mixerRef.current._actions.length; i++) {
            const action = mixerRef.current._actions[i];
            if (action.isRunning()) {
              activeActions.push({
                name: action._clip.name,
                weight: action.getEffectiveWeight().toFixed(3),
                timeScale: action.getEffectiveTimeScale().toFixed(3)
              });
            }
          }
          console.info('[DIAG][DEEP_TRACE] 🎬 AnimationMixer Active Actions:', activeActions);
        }

        if (scene) {
          let invisibleMeshes = 0;
          let zeroScaleMeshes = 0;
          let nanBones = 0;

          scene.traverse((child) => {
            if (child.isMesh) {
              const wPos = new THREE.Vector3();
              const wScale = new THREE.Vector3();
              child.getWorldPosition(wPos);
              child.getWorldScale(wScale);
              
              const mat = child.material;
              const matOpacity = mat?.opacity ?? 1;
              const matVisible = mat?.visible ?? true;
              const matTransparent = mat?.transparent ?? false;

              if (!child.visible) invisibleMeshes++;
              if (wScale.lengthSq() < 0.0001) zeroScaleMeshes++;

              const box = new THREE.Box3().setFromObject(child);
              const size = new THREE.Vector3();
              if (!box.isEmpty()) box.getSize(size);

              console.info(`[DIAG][DEEP_TRACE] 🧊 Mesh '${child.name}':`,
                `visible=${child.visible}`,
                `| scale=[${wScale.x.toFixed(3)}, ${wScale.y.toFixed(3)}, ${wScale.z.toFixed(3)}]`,
                `| wPos=[${wPos.x.toFixed(2)}, ${wPos.y.toFixed(2)}, ${wPos.z.toFixed(2)}]`,
                `| bboxSize=[${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)}]`,
                `| mat: vis=${matVisible}, opac=${matOpacity}, trans=${matTransparent}`,
                `| frustumCulled=${child.frustumCulled}`
              );
            }

            if (child.isBone) {
              const wPos = new THREE.Vector3();
              child.getWorldPosition(wPos);
              if (Number.isNaN(wPos.x) || Number.isNaN(wPos.y) || Number.isNaN(wPos.z)) {
                nanBones++;
                console.error(`[DIAG][DEEP_TRACE] ☠️ Bone '${child.name}' has NaN position!`);
              }
            }
          });

          console.info(`[DIAG][DEEP_TRACE] 📊 Summary: ${invisibleMeshes} invisible meshes, ${zeroScaleMeshes} zero-scale meshes, ${nanBones} NaN bones.`);
        }
      }
    }

    // Lock the scene root in place to prevent the model from drifting/walking forward out of the group
    if (stableSceneTransformRef.current.initialized && currentScene) {
      currentScene.position.x = THREE.MathUtils.lerp(currentScene.position.x, stableSceneTransformRef.current.position.x, 0.1);
      currentScene.position.z = THREE.MathUtils.lerp(currentScene.position.z, stableSceneTransformRef.current.position.z, 0.1);
      currentScene.quaternion.copy(stableSceneTransformRef.current.quaternion);
    }


    if (group.current) {
      group.current.position.y = rigProfile.position[1];
    }
  });

  return (
    <group ref={group} position={rigProfile.position} scale={rigProfile.scale}>
      <primitive object={scene} />
    </group>
  );
});

// ── Scene Wrapper ────────────────────────────────────────────────────────────

let globalRendererCreatedCount = 0;
let globalRendererDisposedCount = 0;
let globalActiveRendererCount = 0;
let globalContextLossCount = 0;

const RendererTelemetry = () => {
  const { gl } = useThree();
  useEffect(() => {
    if (isAvatarDebugEnabled()) {
      globalRendererCreatedCount++;
      globalActiveRendererCount++;
      console.info(`[DIAG][AvatarScene] 🎨 rendererCreated (Total Created: ${globalRendererCreatedCount}, Active: ${globalActiveRendererCount})`);
      
      const onContextLost = (e) => {
        e.preventDefault();
        globalContextLossCount++;
        console.warn(`[DIAG][AvatarScene] 💥 contextLost (Total Lost: ${globalContextLossCount})`);
      };
      
      const onContextRestored = () => {
        console.info('[DIAG][AvatarScene] ♻️ contextRestored');
      };
      
      gl.domElement.addEventListener('webglcontextlost', onContextLost);
      gl.domElement.addEventListener('webglcontextrestored', onContextRestored);
      
      return () => {
        globalRendererDisposedCount++;
        globalActiveRendererCount--;
        console.info(`[DIAG][AvatarScene] 🗑️ rendererDisposed (Total Disposed: ${globalRendererDisposedCount}, Active: ${globalActiveRendererCount})`);
        gl.domElement.removeEventListener('webglcontextlost', onContextLost);
        gl.domElement.removeEventListener('webglcontextrestored', onContextRestored);
        
        // --- MINIMAL FIX FOR CONTEXT LOSS ---
        // Attempt to gracefully release the WebGL context before the DOM element is garbage collected.
        // This prevents the browser from hitting the active WebGL contexts limit (typically ~8-16)
        // during rapid remounts / retries.
        try {
          const extension = gl.getExtension('WEBGL_lose_context');
          if (extension && typeof extension.loseContext === 'function') {
             extension.loseContext();
             console.info('[DIAG][AvatarScene] 🧨 Explicitly called WEBGL_lose_context.loseContext()');
          }
        } catch (e) {
          console.warn('[DIAG][AvatarScene] Failed to explicitly lose context:', e);
        }
        
        // Ensure Three.js internal resources are released
        gl.dispose();
      };
    }
  }, [gl]);
  return null;
};

const AvatarSceneWrapper = React.memo(function AvatarSceneWrapper(props) {
  const renderCountRef = useRef(0);
  useEffect(() => {
    if (isAvatarDebugEnabled()) {
      renderCountRef.current++;
      console.info(`[DIAG][AvatarSceneWrapper] 🔄 Render #${renderCountRef.current}. modelPath:`, props.modelPath);
    }
  });

  useEffect(() => {
    if (isAvatarDebugEnabled()) {
      console.info('[DIAG][AvatarSceneWrapper] 🟢 MOUNTED');
      return () => console.info('[DIAG][AvatarSceneWrapper] 🔴 UNMOUNTED');
    }
    return undefined;
  }, []);

  const rigProfile = useMemo(() => getAvatarRigProfile(props.avatarId), [props.avatarId]);
  
  const cameraConfig = useMemo(() => {
    const baseConfig = getCameraPreset('classroom');
    if (rigProfile.classroomOffset) {
      return {
        ...baseConfig,
        position: [
          baseConfig.position[0] + rigProfile.classroomOffset.position[0],
          baseConfig.position[1] + rigProfile.classroomOffset.position[1],
          baseConfig.position[2] + rigProfile.classroomOffset.position[2]
        ],
        target: [
          baseConfig.target[0] + rigProfile.classroomOffset.target[0],
          baseConfig.target[1] + rigProfile.classroomOffset.target[1],
          baseConfig.target[2] + rigProfile.classroomOffset.target[2]
        ]
      };
    }
    return baseConfig;
  }, [rigProfile]);

  // Preload active avatar model only (not all avatars)
  useEffect(() => {
    if (props.modelPath) {
      if (isAvatarDebugEnabled()) {
        console.info('[DIAG][AvatarSceneWrapper] 📥 Preloading active avatar:', props.modelPath);
      }
      useGLTF.preload(props.modelPath);
    }
  }, [props.modelPath]);

  return (
    <AvatarErrorBoundary
      fallback={
        <div style={{ width: '100%', height: '100%', background: 'rgb(22 22 22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', fontSize: '0.9rem', padding: '1rem', textAlign: 'center' }}>
          Avatar render error
        </div>
      }
      onError={(err) => { props.onRenderFailure?.(err); props.onError?.(err); }}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <Canvas shadows dpr={[1, 1.5]} camera={cameraConfig} gl={GL_CONFIG}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[4, 6, 4]} intensity={1.0} castShadow />
          <directionalLight position={[-4, 5, -3]} intensity={0.35} />
          <pointLight position={[0, 2, 2]} intensity={0.35} />
          <Environment preset="studio" />
          <RendererTelemetry />

          <Suspense fallback={null}>
            <AvatarErrorBoundary onError={(err) => { if (isAvatarDebugEnabled()) console.error('[DIAG][InnerErrorBoundary] ❌ Caught inside Canvas:', err.message); props.onRenderFailure?.(err); props.onError?.(err); }}>
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
            target={cameraConfig.target}
          />
        </Canvas>
      </div>
    </AvatarErrorBoundary>
  );
});

export default AvatarSceneWrapper;

// NOTE: Avatar preloading is now done per-active-avatar in AvatarScene via the
// modelPath prop. We only preload the idle animation here since it's shared.
if (typeof window !== 'undefined') {
  ['/models/animations/Idle/Idle.fbx'].forEach((url) => {
    fetch(url, { priority: 'low' }).catch(() => { });
  });
}
