import React, { memo, useState, useCallback, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import { AvatarComponent } from '@/features/avatar/components/AvatarComponent';
import { Viseme } from '@/features/voice/hooks/useGaplessAudioQueue';
import * as THREE from 'three';

const CAMERA_POS_X = 0;
const CAMERA_POS_Y = 1.5;
const CAMERA_POS_Z = 2.2;
const CAMERA_FOV = 45;
const TARGET_POS_X = 0;
const TARGET_POS_Y = 1.4;
const TARGET_POS_Z = 0;
const AMBIENT_INTENSITY = 0.5;
const DIR_LIGHT_POS_X = 1;
const DIR_LIGHT_POS_Y = 2;
const DIR_LIGHT_POS_Z = 3;
const DIR_LIGHT_INTENSITY = 1;
const Z_INDEX_OVERLAY = 10;
const INSET_ZERO = 0;
const FULL_PERCENTAGE = '100%';

interface AvatarCanvasWrapperProps {
  avatarId: string;
  pipelineState: 'idle' | 'thinking' | 'speaking' | 'error';
  movementEnabled: boolean;
  mouthCuesRef: React.MutableRefObject<Viseme[]>;
  getAudioContext: () => AudioContext;
  playbackStartTimeRef: React.MutableRefObject<number | null>;
  getIsAudioPlaying: () => boolean;
  getNextPlaybackTime: () => number;
}

// DEFENSIVE: WebGL Context Watcher with strict cleanup
const WebGLContextWatcher = memo(({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) => {
  const gl = useThree((state) => state.gl);
  
  useEffect(() => {
    const handleLost = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    
    gl.domElement.addEventListener('webglcontextlost', handleLost);
    gl.domElement.addEventListener('webglcontextrestored', onRestored);
    
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', handleLost);
      gl.domElement.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, onLost, onRestored]);
  
  return null;
});

export const AvatarCanvasWrapper = memo(function AvatarCanvasWrapper({
  avatarId,
  pipelineState,
  movementEnabled,
  mouthCuesRef,
  getAudioContext,
  playbackStartTimeRef,
  getIsAudioPlaying,
  getNextPlaybackTime
}: AvatarCanvasWrapperProps) {
  const [isContextLost, setIsContextLost] = useState(false);

  const handleContextLost = useCallback(() => {
    console.warn('WebGL Context Lost! Gracefully pausing 3D rendering.');
    setIsContextLost(true);
  }, []);

  const handleContextRestored = useCallback(() => {
    console.info('WebGL Context Restored! Resuming 3D rendering.');
    setIsContextLost(false);
  }, []);

  return (
    <div className="avatar-panel" style={{ position: 'relative', width: FULL_PERCENTAGE, height: FULL_PERCENTAGE }}>
      {isContextLost && (
        <div style={{ position: 'absolute', inset: INSET_ZERO, zIndex: Z_INDEX_OVERLAY, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
          <p style={{ color: '#fff' }}>Recovering Avatar Graphics...</p>
        </div>
      )}
      <Canvas onCreated={(state) => {
        const evidence = {
          camera: {
            position: state.camera.position.toArray(),
            fov: (state.camera as THREE.PerspectiveCamera).fov,
            aspect: (state.camera as THREE.PerspectiveCamera).aspect
          },
          gl: {
            size: state.size,
            viewport: state.viewport
          }
        };
        console.log('[Runtime Evidence] Canvas Created:', evidence);
        (window as any).__CAMERA_EVIDENCE = evidence;
      }}>
        <WebGLContextWatcher onLost={handleContextLost} onRestored={handleContextRestored} />
        <PerspectiveCamera makeDefault position={[CAMERA_POS_X, CAMERA_POS_Y, CAMERA_POS_Z]} fov={CAMERA_FOV} />
        <OrbitControls target={[TARGET_POS_X, TARGET_POS_Y, TARGET_POS_Z]} enablePan={false} enableZoom={false} enableRotate={false} />
        <ambientLight intensity={AMBIENT_INTENSITY} />
        <directionalLight position={[DIR_LIGHT_POS_X, DIR_LIGHT_POS_Y, DIR_LIGHT_POS_Z]} intensity={DIR_LIGHT_INTENSITY} />
        <AvatarComponent 
          avatarId={avatarId}
          pipelineState={pipelineState} 
          movementEnabled={movementEnabled}
          mouthCuesRef={mouthCuesRef}
          getAudioContext={getAudioContext}
          playbackStartTimeRef={playbackStartTimeRef}
          getIsAudioPlaying={getIsAudioPlaying}
          getNextPlaybackTime={getNextPlaybackTime}
        />
      </Canvas>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.avatarId === nextProps.avatarId &&
    prevProps.pipelineState === nextProps.pipelineState &&
    prevProps.movementEnabled === nextProps.movementEnabled &&
    // Refs generally don't change, but check them just in case
    prevProps.mouthCuesRef === nextProps.mouthCuesRef &&
    prevProps.getAudioContext === nextProps.getAudioContext &&
    prevProps.playbackStartTimeRef === nextProps.playbackStartTimeRef &&
    prevProps.getIsAudioPlaying === nextProps.getIsAudioPlaying &&
    prevProps.getNextPlaybackTime === nextProps.getNextPlaybackTime
  );
});
