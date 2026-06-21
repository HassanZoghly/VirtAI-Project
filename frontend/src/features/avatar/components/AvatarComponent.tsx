/// <reference types="@react-three/fiber" />
import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useGraph } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import { useAvatarAnimations } from './useAvatarAnimations';
import { useAvatarLipSync, Viseme } from './useAvatarLipSync';
import { toast } from '@/shared/utils/toast';

const TOAST_DURATION = 5000;

export interface AvatarComponentProps {
  avatarId: string;
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error';
  movementEnabled?: boolean;
  mouthCuesRef?: React.MutableRefObject<Viseme[]>;
  audioContext?: AudioContext | null;
  playbackStartTimeRef?: React.MutableRefObject<number | null>;
}

interface GLTFResult {
  scene: THREE.Group;
  nodes: Record<string, THREE.Object3D | THREE.Mesh>;
}

export function AvatarComponent({ 
  avatarId,
  pipelineState, 
  movementEnabled = true,
  mouthCuesRef,
  audioContext,
  playbackStartTimeRef
}: AvatarComponentProps) {
  const groupRef = useRef<THREE.Group>(null);
  const avatarUrl = `/models/${avatarId}.glb`;
  const { scene } = useGLTF(avatarUrl) as unknown as GLTFResult;
  
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone) as unknown as GLTFResult;
  
  const avatarRoot = useMemo(() => {
    return clone;
  }, [clone]);

  // Hook 1: Animation Mixer, Tracks, and State Machine
  useAvatarAnimations(avatarRoot as THREE.Group, pipelineState, movementEnabled);

  const toastShownRef = useRef(false);

  const targetMeshes = useMemo(() => {
    if (!nodes) return [];
    return Object.values(nodes).filter(
      (node) => {
        const mesh = node as THREE.SkinnedMesh;
        // Strictly filter to meshes with skinning AND morph targets (e.g. Wolf3D_Head)
        if (mesh.isSkinnedMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          if (import.meta.env.DEV) {
            console.log(`[AvatarComponent] Available Morph Targets on ${mesh.name}:`, Object.keys(mesh.morphTargetDictionary));
          }
          return true;
        }
        return false;
      }
    ) as THREE.SkinnedMesh[];
  }, [nodes]);

  useEffect(() => {
    if (nodes && targetMeshes.length === 0 && !toastShownRef.current) {
      if (import.meta.env.DEV) {
        console.warn('[AvatarComponent] Missing morphTargetDictionary or morphTargetInfluences on Avatar nodes. Expressions and lip-sync will fail silently.');
      }
      toast.warning('Avatar Warning', 'Lip-sync targets missing. Using fallback animation.', TOAST_DURATION);
      toastShownRef.current = true;
    }
  }, [nodes, targetMeshes]);

  // Hook 2: Morph Target Interpolation, Blink, and Viseme application
  useAvatarLipSync({
    targetMeshes,
    pipelineState,
    mouthCuesRef,
    audioContext,
    playbackStartTimeRef,
    groupRef
  });

  return (
    <group position={[0, -0.2, 0]}>
      <primitive object={clone} ref={groupRef} />
    </group>
  );
}
