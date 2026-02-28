/**
 * Example: Avatar with Retargeting Support
 * 
 * This component demonstrates how to use the animation system with retargeting.
 * It loads both Mixamo (direct) and non-Mixamo (retargeted) animations.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { loadAnimation, preloadAnimations } from './animationLoader';
import { AnimationStateController, AnimationState } from './AnimationStateController';

/**
 * Avatar component with animation retargeting
 */
export function AvatarWithRetargeting({
    modelPath = '/models/avatar1.glb',
    isStreaming = false, // True when AI is generating response
    onReady = null,
}) {
    const group = useRef();
    const { scene } = useGLTF(modelPath);

    // Animation system refs
    const mixerRef = useRef(null);
    const controllerRef = useRef(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    // Track previous streaming state
    const prevStreamingRef = useRef(isStreaming);

    // Initialize animation system
    useEffect(() => {
        if (!scene) return;

        const initAnimations = async () => {
            try {
                setIsLoading(true);

                if (import.meta.env.DEV) {
                    console.debug('[Example] Initializing animation system...');
                }

                // Define animations to load
                const animationsToLoad = [
                    { name: 'IDLE', url: '/models/animations/Idle/Idle.fbx' },
                    { name: 'GREETING', url: '/models/animations/Greeting/Greeting.fbx' },
                    { name: 'TALK', url: '/models/animations/Talk/Talk.fbx' }, // May have Talk.json companion
                ];

                // Preload all animations
                const clips = await preloadAnimations(animationsToLoad, scene);

                // Ensure we have at least IDLE
                if (!clips.has('IDLE')) {
                    throw new Error('Failed to load IDLE animation - cannot continue');
                }

                // Create animation mixer
                const mixer = new THREE.AnimationMixer(scene);
                mixerRef.current = mixer;

                // Create animation controller
                const controller = new AnimationStateController(mixer, clips);
                controllerRef.current = controller;

                // Start with IDLE state
                controller.start();

                setIsLoading(false);

                if (import.meta.env.DEV) {
                    console.debug('[Example] ✓ Animation system ready');
                    console.debug('[Example] Available states:', Array.from(clips.keys()));
                }

                // Notify parent component
                if (onReady) {
                    onReady({ controller, mixer, clips });
                }

            } catch (error) {
                console.error('[Example] Failed to initialize animations:', error);
                setLoadError(error.message);
                setIsLoading(false);
            }
        };

        initAnimations();

        // Cleanup
        return () => {
            if (controllerRef.current) {
                controllerRef.current.dispose();
                controllerRef.current = null;
            }
            if (mixerRef.current) {
                mixerRef.current.stopAllAction();
                mixerRef.current.uncacheRoot(scene);
                mixerRef.current = null;
            }
        };
    }, [scene, onReady]);

    // Handle streaming state changes
    useEffect(() => {
        if (!controllerRef.current || isLoading) return;

        const controller = controllerRef.current;

        // Transition based on streaming state
        if (isStreaming && !prevStreamingRef.current) {
            // Started streaming - switch to TALK
            if (import.meta.env.DEV) {
                console.debug('[Example] AI started streaming → TALK');
            }
            controller.transitionTo(AnimationState.TALK);

        } else if (!isStreaming && prevStreamingRef.current) {
            // Stopped streaming - return to IDLE
            if (import.meta.env.DEV) {
                console.debug('[Example] AI stopped streaming → IDLE');
            }
            controller.transitionTo(AnimationState.IDLE);
        }

        prevStreamingRef.current = isStreaming;

    }, [isStreaming, isLoading]);

    // Update animation mixer every frame
    useFrame((_, delta) => {
        if (controllerRef.current) {
            controllerRef.current.update(delta);
        }
    });

    // Show loading state
    if (isLoading) {
        return (
            <group ref={group}>
                <primitive object={scene} />
                {/* You could add a loading indicator here */}
            </group>
        );
    }

    // Show error state
    if (loadError) {
        console.error('[Example] Animation system error:', loadError);
        // Still render the avatar, just without animations
        return (
            <group ref={group}>
                <primitive object={scene} />
            </group>
        );
    }

    return (
        <group ref={group}>
            <primitive object={scene} />
        </group>
    );
}

/**
 * Example usage in a scene
 */
export function ExampleScene() {
    const [isAISpeaking, setIsAISpeaking] = useState(false);

    const handleAnimationReady = ({ controller }) => {
        console.log('Animation system ready!');
        console.log('Current state:', controller.getCurrentState());

        // Example: Play greeting after 2 seconds
        setTimeout(() => {
            controller.transitionTo(AnimationState.GREETING);

            // Return to idle after 3 seconds
            setTimeout(() => {
                controller.transitionTo(AnimationState.IDLE);
            }, 3000);
        }, 2000);
    };

    const handleStartSpeaking = () => {
        console.log('AI started speaking');
        setIsAISpeaking(true);

        // Simulate AI finishing after 5 seconds
        setTimeout(() => {
            console.log('AI finished speaking');
            setIsAISpeaking(false);
        }, 5000);
    };

    return (
        <>
            <AvatarWithRetargeting
                modelPath="/models/avatar1.glb"
                isStreaming={isAISpeaking}
                onReady={handleAnimationReady}
            />

            {/* Example UI controls */}
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}>
                <button onClick={handleStartSpeaking} disabled={isAISpeaking}>
                    {isAISpeaking ? 'AI Speaking...' : 'Start AI Speaking'}
                </button>
            </div>
        </>
    );
}

/**
 * Integration with existing WebSocket system
 * 
 * Example of how to integrate with your existing chat system:
 */
export function IntegrationExample() {
    const [isStreaming, setIsStreaming] = useState(false);
    const controllerRef = useRef(null);

    // WebSocket message handler
    const handleWebSocketMessage = (message) => {
        switch (message.type) {
            case 'tts.start':
                // AI started generating audio
                setIsStreaming(true);
                break;

            case 'tts.end':
                // AI finished generating audio
                setIsStreaming(false);
                break;

            case 'audio.playing':
                // Audio started playing
                if (controllerRef.current) {
                    controllerRef.current.transitionTo(AnimationState.TALK);
                }
                break;

            case 'audio.ended':
                // Audio finished playing
                if (controllerRef.current) {
                    controllerRef.current.transitionTo(AnimationState.IDLE);
                }
                break;
        }
    };

    return (
        <AvatarWithRetargeting
            modelPath="/models/avatar1.glb"
            isStreaming={isStreaming}
            onReady={({ controller }) => {
                controllerRef.current = controller;
            }}
        />
    );
}

export default AvatarWithRetargeting;
