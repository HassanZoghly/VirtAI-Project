import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF, useFBX, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

// ------------------------ error boundary ------------------------
class AvatarErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(err) {
        console.warn("[AvatarScene] Caught error, showing fallback:", err.message);
    }
    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? null;
        }
        return this.props.children;
    }
}

// ------------------------ paths config ------------------------
const ANIM = {
    greeting: [{ fbx: "/models/animations/Greeting/Greeting.fbx" }],
    idle: [
        { fbx: "/models/animations/Idle/Idle.fbx" },
    ],
    think: [
        { fbx: "/models/animations/Think/Think.fbx" },
    ],
};

// Max jaw rotation in radians for lip sync
const JAW_OPEN_MAX = 0.15;

// ------------------------ R3F model + animations ------------------------
function AvatarRig({
    modelPath,
    animState,
    onGreetingFinished,
    speechAmplitude = 0,
    onModelReady,
}) {
    const group = useRef();
    const { scene } = useGLTF(modelPath);

    // FBX loads
    const greetingFBX = useFBX(ANIM.greeting[0].fbx);
    const idleFBX = useFBX(ANIM.idle[0].fbx);
    const thinkFBX = useFBX(ANIM.think[0].fbx);

    // Mixer / actions
    const mixerRef = useRef(null);
    const actionsRef = useRef({});
    const currentActionRef = useRef(null);

    // Lip sync refs
    const jawBoneRef = useRef(null);
    const jawRestRotation = useRef(null);
    const currentAmplitudeRef = useRef(0);

    // Pre-process scene
    useEffect(() => {
        scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.isSkinnedMesh) o.frustumCulled = false;
            if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((mat) => {
                mat.side = THREE.DoubleSide;
                mat.needsUpdate = true;
            });
            }
        }

        // Find jaw bone for lip sync
        if (o.isBone) {
            const name = o.name.toLowerCase();
            if (
            name.includes("jaw") ||
            name.includes("chin") ||
            name === "head_joint" // common in ReadyPlayerMe
            ) {
            if (!jawBoneRef.current) {
                jawBoneRef.current = o;
                jawRestRotation.current = o.rotation.x;
            }
            }
        }
        });

        onModelReady?.();
    }, [scene]);

    // Prepare clips
    const clips = useMemo(() => {
        const result = [];
        function normalizeClip(clip, name) {
        const c = clip.clone();
        c.name = name;
        return c;
        }

        const g = greetingFBX.animations?.[0];
        const i1 = idleFBX.animations?.[0];
        const t1 = thinkFBX.animations?.[0];

        if (g) result.push(normalizeClip(g, "greeting"));
        if (i1) result.push(normalizeClip(i1, "idle"));
        if (t1) result.push(normalizeClip(t1, "think"));

        return result;
    }, [greetingFBX, idleFBX, thinkFBX]);

    // Init mixer & actions
    useEffect(() => {
        if (!scene || clips.length === 0) return;

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
        };
    }, [scene, clips]);

    function playAction(name, { loop = THREE.LoopRepeat, fade = 0.25, once = false } = {}) {
        const actions = actionsRef.current;
        const next = actions[name];
        if (!next) return;

        if (once) {
        next.setLoop(THREE.LoopOnce, 1);
        next.reset();
        } else {
        next.setLoop(loop, Infinity);
        next.reset();
        }

        next.enabled = true;
        next.play();

        const cur = currentActionRef.current;
        if (cur && cur !== next) {
        cur.crossFadeTo(next, fade, false);
        } else {
        next.fadeIn(fade);
        }
        currentActionRef.current = next;

        if (once && mixerRef.current) {
        const mixer = mixerRef.current;
        const onFinish = (e) => {
            if (e.action === next) {
            mixer.removeEventListener("finished", onFinish);
            onGreetingFinished?.();
            }
        };
        mixer.addEventListener("finished", onFinish);
        }
    }

    // Drive animation by animState
    useEffect(() => {
        if (!actionsRef.current || !scene) return;

        if (animState === "greeting") {
        playAction("greeting", { fade: 0.2, once: true });
        return;
        }
        if (animState === "idle") {
        playAction("idle", { fade: 0.25 });
        return;
        }
        if (animState === "thinking") {
        playAction("think", { fade: 0.25 });
        return;
        }
        if (animState === "speaking") {
        // "talk" animation unavailable — fall back to idle
        playAction("idle", { fade: 0.15 });
        return;
        }
    }, [animState, scene]);

    // Update mixer + lip sync
    useFrame((_, dt) => {
        if (mixerRef.current) mixerRef.current.update(dt);

        // Lip sync: smooth interpolation of jaw bone based on speech amplitude
        if (jawBoneRef.current && jawRestRotation.current !== null) {
        const target = animState === "speaking" ? Math.max(0, Math.min(1, speechAmplitude)) : 0;

        // Smooth lerp
        currentAmplitudeRef.current = THREE.MathUtils.lerp(
            currentAmplitudeRef.current,
            target,
            dt * 12 // smoothing factor
        );

        // Apply jaw rotation (additive to rest)
        jawBoneRef.current.rotation.x =
            jawRestRotation.current + currentAmplitudeRef.current * JAW_OPEN_MAX;
        }
    });

    useEffect(() => {
        if (animState !== "speaking") {
        currentAmplitudeRef.current = 0;
        if (jawBoneRef.current && jawRestRotation.current !== null) {
            jawBoneRef.current.rotation.x = jawRestRotation.current;
        }
        }
    }, [animState]);

    return (
        <group ref={group} position={[0, -1.25, 0]} scale={1.25}>
        <primitive object={scene} />
        </group>
    );
}

// ------------------------ main scene wrapper ------------------------
/**
* @param {{
*   avatarData: object|null,
*   avatarMode: "idle"|"thinking"|"speaking",
*   speechAmplitude: number,
* }} props
*/
export default function AvatarScene({ avatarData, avatarMode = "idle", speechAmplitude = 0, onAvatarLoaded }) {

    const loadStartRef = useRef(0);
    const [animState, setAnimState] = useState("idle");
    const greetedRef = useRef(false);
    const isGreetingRef = useRef(false);

    const handleGreetingFinished = () => {
        isGreetingRef.current = false;

        if (avatarMode === "speaking") {
        setAnimState("speaking");
        return;
        }
        if (avatarMode === "thinking") {
        setAnimState("thinking");
        return;
        }
        setAnimState("idle");
    };

    const modelPath = avatarData?.modelPath || "/models/avatar2.glb";

    useEffect(() => {
        loadStartRef.current = performance.now();
        useGLTF.preload(modelPath);
    }, [modelPath]);

    const handleModelReady = () => {
        const elapsed = performance.now() - loadStartRef.current;
        console.info(`[Avatar] Loaded ${modelPath} in ${Math.round(elapsed)}ms`);
        onAvatarLoaded?.();

        if (!greetedRef.current) {
        greetedRef.current = true;
        isGreetingRef.current = true;
        setAnimState("greeting");
        }
    };

    // Map WS avatarMode to internal animation states (after greeting finishes)
    useEffect(() => {
        const mappedState = avatarMode === "speaking"
        ? "speaking"
        : avatarMode === "thinking"
        ? "thinking"
        : "idle";

        if (isGreetingRef.current) {
        if (mappedState === "idle") return;
        isGreetingRef.current = false;
        }

        setAnimState(mappedState);
    }, [avatarMode]);

    return (
        <AvatarErrorBoundary fallback={<div style={{ width: "100%", height: "100%", background: "rgb(22 22 22)" }} />}>
        <div style={{ width: "100%", height: "100%" }}>
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
                <AvatarErrorBoundary fallback={null}>
                <AvatarRig
                    modelPath={modelPath}
                    animState={animState}
                    onGreetingFinished={handleGreetingFinished}
                    speechAmplitude={speechAmplitude}
                    onModelReady={handleModelReady}
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
    }
