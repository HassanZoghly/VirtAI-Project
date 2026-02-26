import React, { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF, useFBX, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

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
        console.warn("[AvatarScene] Caught error, showing fallback:", err.message);
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

// Animation paths
const ANIM = {
    greeting: [{ fbx: "/models/animations/Greeting/Greeting.fbx" }],
    idle: [{ fbx: "/models/animations/Idle/Idle.fbx" }],
};

const JAW_OPEN_MAX = 0.15;

// استخدم React.memo لمنع إعادة التصيير غير الضرورية
const AvatarRig = React.memo(function AvatarRig({
    modelPath,
    animState,
    onGreetingFinished,
    speechAmplitude = 0,
    onModelReady,
}) {
    const group = useRef();
    const { scene } = useGLTF(modelPath);

    const greetingFBX = useFBX(ANIM.greeting[0].fbx);
    const idleFBX = useFBX(ANIM.idle[0].fbx);

    const mixerRef = useRef(null);
    const actionsRef = useRef({});
    const currentActionRef = useRef(null);

    const jawBoneRef = useRef(null);
    const jawRestRotation = useRef(null);
    const currentAmplitudeRef = useRef(0);

    // إضافة حالة للتأكد من أن المشهد جاهز
    const [sceneReady, setSceneReady] = useState(false);

    useEffect(() => {
        if (!scene) return;
        // تأكد من أن traverse يعمل
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

            if (o.isBone) {
                const name = o.name.toLowerCase();
                if (
                    name.includes("jaw") ||
                    name.includes("chin") ||
                    name === "head_joint"
                ) {
                    if (!jawBoneRef.current) {
                        jawBoneRef.current = o;
                        jawRestRotation.current = o.rotation.x;
                        console.log("Jaw bone found:", o.name);
                    }
                }
            }
        });
        setSceneReady(true);
        onModelReady?.();
    }, [scene, onModelReady]);

    const clips = useMemo(() => {
        const result = [];
        const normalizeClip = (clip, name) => {
            const c = clip.clone();
            c.name = name;
            return c;
        };

        const g = greetingFBX?.animations?.[0];
        const i = idleFBX?.animations?.[0];

        if (g) result.push(normalizeClip(g, "greeting"));
        if (i) result.push(normalizeClip(i, "idle"));

        return result;
    }, [greetingFBX, idleFBX]);

    useEffect(() => {
        if (!scene || !sceneReady || clips.length === 0) return;

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
    }, [scene, sceneReady, clips]);

    function playAction(name, { loop = THREE.LoopRepeat, fade = 0.25, once = false } = {}) {
        const actions = actionsRef.current;
        const next = actions[name];
        if (!next) {
            console.warn(`Action ${name} not found`);
            return;
        }

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

    useEffect(() => {
        if (!actionsRef.current || !scene || !sceneReady) return;

        console.log("Playing animation:", animState);
        if (animState === "greeting") {
            playAction("greeting", { fade: 0.2, once: true });
        } else if (animState === "idle" || animState === "speaking") {
            playAction("idle", { fade: 0.25 });
        }
    }, [animState, scene, sceneReady]);

    useFrame((_, dt) => {
        if (mixerRef.current) mixerRef.current.update(dt);

        if (jawBoneRef.current && jawRestRotation.current !== null) {
            const target = animState === "speaking" ? Math.max(0, Math.min(1, speechAmplitude)) : 0;
            currentAmplitudeRef.current = THREE.MathUtils.lerp(
                currentAmplitudeRef.current,
                target,
                dt * 12
            );
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
});

// مكون AvatarScene مع memo
const AvatarScene = React.memo(function AvatarScene({
    avatarData,
    avatarMode = "idle",
    speechAmplitude = 0,
    onAvatarLoaded,
    modelPath: explicitModelPath,
    onError,
}) {
    const loadStartRef = useRef(0);
    const [animState, setAnimState] = useState("idle");
    const greetedRef = useRef(false);
    const isGreetingRef = useRef(false);
    const [loadError, setLoadError] = useState(null);

    const handleGreetingFinished = () => {
        isGreetingRef.current = false;
        if (avatarMode === "speaking") {
            setAnimState("speaking");
        } else {
            setAnimState("idle");
        }
    };

    const modelPath = explicitModelPath || avatarData?.modelPath || "/models/avatar1.glb";

    useEffect(() => {
        loadStartRef.current = performance.now();
        try {
            // Preload model
            useGLTF.preload(modelPath);
        } catch (err) {
            setLoadError(err);
            onError?.(err);
        }
    }, [modelPath, onError]);

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

    const handleModelError = (err) => {
        setLoadError(err);
        onError?.(err);
    };

    useEffect(() => {
        const mappedState = avatarMode === "speaking" ? "speaking" : "idle";

        if (isGreetingRef.current) {
            if (mappedState === "idle") return;
            isGreetingRef.current = false;
        }

        setAnimState(mappedState);
    }, [avatarMode]);

    if (loadError) {
        return <div style={{ width: "100%", height: "100%", background: "rgb(22 22 22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
            Failed to load avatar
        </div>;
    }

    return (
        <AvatarErrorBoundary fallback={<div style={{ width: "100%", height: "100%", background: "rgb(22 22 22)" }} />} onError={onError}>
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
                        <AvatarErrorBoundary fallback={null} onError={handleModelError}>
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
});

export default AvatarScene;