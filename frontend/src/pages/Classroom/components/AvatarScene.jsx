import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls, useGLTF, useFBX, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

// Error boundary
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
const ANIM = {
  greeting: [{ fbx: '/models/animations/Greeting/Greeting.fbx' }],
  idle: [{ fbx: '/models/animations/Idle/Idle.fbx' }],
  // Think and Talk animations are missing - will fallback to idle
};

// Animation fallback map for missing animations
const ANIMATION_FALLBACK = {
  thinking: 'idle',
  speaking: 'idle',
};

/**
 * AvatarRig - Pure 3D rendering component
 * Handles model loading, animation playback, and morph target application
 */
const AvatarRig = React.memo(function AvatarRig({
  modelPath,
  currentAnimation,
  morphTargets = {},
  bodyMotion = { headBob: 0, chestBob: 0 },
  onModelLoaded,
}) {
  const group = useRef();
  const { scene } = useGLTF(modelPath);

  // Load only animations that exist
  const greetingFBX = useFBX(ANIM.greeting[0].fbx);
  const idleFBX = useFBX(ANIM.idle[0].fbx);

  const mixerRef = useRef(null);
  const actionsRef = useRef({});
  const currentActionRef = useRef(null);
  const currentActionNameRef = useRef(null); // Track current action name to prevent re-triggers

  // Refs for morph target meshes
  const headMeshRef = useRef(null);
  const teethMeshRef = useRef(null);

  // Refs for skeleton bones (for body motion)
  const headBoneRef = useRef(null);
  const spineBoneRef = useRef(null);

  // Setup scene materials and shadows + inspect morph targets
  useEffect(() => {
    if (!scene) {
      return;
    }

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
            console.debug(`[AvatarScene] Mesh "${o.name}" has ${morphKeys.length} morph targets:`, morphKeys);
          }

          // Check if this mesh should be excluded (body/outfit/hair/eyes)
          const isExcluded = excludedMeshNames.some(excluded => meshName.includes(excluded));

          // Check if this mesh has viseme morph targets
          const hasVisemes = morphKeys.some(key => key.toLowerCase().startsWith('viseme_') || key.toLowerCase().includes('jaw') || key.toLowerCase().includes('mouth'));

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
            console.debug(`[AvatarScene] ✗ EXCLUDED mesh from lip sync: "${o.name}" (body/outfit/hair/eyes)`);
          }
        }
      }

      // Find skeleton bones for body motion
      if (o.isBone) {
        // Common bone names for head: Head, head, mixamorigHead
        if (o.name.toLowerCase().includes('head') && !headBoneRef.current) {
          headBoneRef.current = o;
          if (import.meta.env.DEV) {
            console.debug('[AvatarScene] Found head bone:', o.name);
          }
        }
        // Common bone names for spine/chest: Spine, Spine1, Spine2, mixamorigSpine1
        if ((o.name.toLowerCase().includes('spine') || o.name.toLowerCase().includes('chest')) && !spineBoneRef.current) {
          spineBoneRef.current = o;
          if (import.meta.env.DEV) {
            console.debug('[AvatarScene] Found spine bone:', o.name);
          }
        }
      }
    });

    // Safety check: warn if no mouth meshes found
    if (mouthMeshes.length === 0 && import.meta.env.DEV) {
      console.warn('[AvatarScene] ⚠️ No mouth meshes found with viseme morph targets!');
    }

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

    return result;
  }, [greetingFBX, idleFBX]);

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
  const playAction = (name, { loop = THREE.LoopRepeat, fade = 0.25 } = {}) => {
    const actions = actionsRef.current;

    // Check if animation exists, use fallback if not
    let animationName = name;
    if (!actions[name] && ANIMATION_FALLBACK[name]) {
      animationName = ANIMATION_FALLBACK[name];
      if (import.meta.env.DEV) {
        console.debug(`[AvatarScene] Animation '${name}' not found, using fallback '${animationName}'`);
      }
    }

    // CRITICAL: Prevent re-triggering the same animation
    if (currentActionNameRef.current === animationName) {
      if (import.meta.env.DEV) {
        console.debug(`[AvatarScene] Already playing '${animationName}', skipping re-trigger`);
      }
      return;
    }

    const next = actions[animationName];
    if (!next) {
      console.warn(`[AvatarScene] Action ${animationName} not found`);
      return;
    }

    next.setLoop(loop, Infinity);
    next.reset();
    next.enabled = true;
    next.play();

    const cur = currentActionRef.current;
    if (cur && cur !== next) {
      cur.crossFadeTo(next, fade, false);
    } else {
      next.fadeIn(fade);
    }

    currentActionRef.current = next;
    currentActionNameRef.current = animationName; // Track the name
  };

  // Handle animation changes
  useEffect(() => {
    if (!actionsRef.current || !scene) {
      return;
    }

    playAction(currentAnimation, { fade: 0.25 });
  }, [currentAnimation, scene]);

  // Update animation mixer and apply morph targets (NO BODY MOTION to prevent deformation)
  useFrame((_, dt) => {
    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(dt);
    }

    // Apply morph targets ONLY to head and teeth meshes (prevents body deformation)
    if (headMeshRef.current && headMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(headMeshRef.current, morphTargets);
    }
    if (teethMeshRef.current && teethMeshRef.current.morphTargetInfluences) {
      applyMorphTargetsSmooth(teethMeshRef.current, morphTargets);
    }

    // DISABLED: Body motion causes visual deformation (spine bone affects entire body mesh)
    // TODO: Re-enable with proper bone isolation or IK constraints
    // if (bodyMotion && (bodyMotion.headBob > 0 || bodyMotion.chestBob > 0)) {
    //   applyBodyMotion(headBoneRef.current, spineBoneRef.current, bodyMotion);
    // }
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

  const smoothingFactor = 0.3; // How fast to interpolate (0-1, higher = faster)
  const resetSpeed = 0.15; // Slower reset to avoid jitter

  // Get all viseme indices (morph targets that start with "viseme_" or contain "jaw"/"mouth")
  const visemeIndices = [];
  for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
    const nameLower = name.toLowerCase();
    if (nameLower.startsWith('viseme_') || nameLower.includes('jaw') || nameLower.includes('mouth')) {
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
 * Apply subtle body motion to skeleton bones
 * Creates natural head and chest bobbing during speech
 * 
 * @param {THREE.Bone} headBone - Head bone reference
 * @param {THREE.Bone} spineBone - Spine/chest bone reference
 * @param {Object} bodyMotion - { headBob: number, chestBob: number }
 */
function applyBodyMotion(headBone, spineBone, bodyMotion) {
  const { headBob = 0, chestBob = 0 } = bodyMotion;

  // Apply head bob (subtle Y-axis rotation and position offset)
  if (headBone && headBob > 0) {
    // Subtle nod motion (rotation around X-axis)
    const headRotation = headBob * 0.05; // Max ~3 degrees
    headBone.rotation.x = THREE.MathUtils.lerp(
      headBone.rotation.x,
      headRotation,
      0.2 // Smooth interpolation
    );

    // Subtle vertical bob
    const headOffset = headBob * 0.5; // Max 0.5cm * headBob
    headBone.position.y = THREE.MathUtils.lerp(
      headBone.position.y,
      headOffset,
      0.2
    );
  } else if (headBone) {
    // Return to neutral position when not speaking
    headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, 0, 0.1);
    headBone.position.y = THREE.MathUtils.lerp(headBone.position.y, 0, 0.1);
  }

  // Apply chest bob (subtle breathing motion)
  if (spineBone && chestBob > 0) {
    // Subtle chest expansion (scale on Z-axis)
    const chestScale = 1.0 + chestBob * 0.02; // Max 2% expansion
    spineBone.scale.z = THREE.MathUtils.lerp(
      spineBone.scale.z,
      chestScale,
      0.15
    );

    // Subtle forward/back motion
    const chestOffset = chestBob * 0.3; // Max 0.3cm * chestBob
    spineBone.position.z = THREE.MathUtils.lerp(
      spineBone.position.z,
      chestOffset,
      0.15
    );
  } else if (spineBone) {
    // Return to neutral when not speaking
    spineBone.scale.z = THREE.MathUtils.lerp(spineBone.scale.z, 1.0, 0.1);
    spineBone.position.z = THREE.MathUtils.lerp(spineBone.position.z, 0, 0.1);
  }
}

/**
 * AvatarScene - Pure rendering component for 3D avatar
 *
 * Props:
 * - modelPath: Path to GLB model file
 * - currentAnimation: Animation name ('idle', 'thinking', 'speaking', 'greeting')
 * - morphTargets: Object mapping viseme names to influence values (0-1)
 * - bodyMotion: Object with { headBob: number, chestBob: number } for subtle body animation
 * - onModelLoaded: Callback when model is loaded
 * - onError: Callback for errors
 */
const AvatarScene = React.memo(function AvatarScene({
  modelPath,
  currentAnimation = 'idle',
  morphTargets = {},
  bodyMotion = { headBob: 0, chestBob: 0 },
  onModelLoaded,
  onError,
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
        <Canvas
          shadows
          dpr={[1, 1.5]}
          camera={{ position: [0, 0.2, 3.6], fov: 45, near: 0.01, far: 100 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        >
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
