import React, { memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import { AvatarComponent } from '@/features/avatar/components/AvatarComponent';
import { Viseme } from '@/features/voice/hooks/useGaplessAudioQueue';

interface AvatarCanvasWrapperProps {
  avatarId: string;
  pipelineState: string;
  movementEnabled: boolean;
  mouthCuesRef: React.MutableRefObject<Viseme[]>;
  audioContext: AudioContext;
  playbackStartTimeRef: React.MutableRefObject<number | null>;
}

export const AvatarCanvasWrapper = memo(function AvatarCanvasWrapper({
  avatarId,
  pipelineState,
  movementEnabled,
  mouthCuesRef,
  audioContext,
  playbackStartTimeRef
}: AvatarCanvasWrapperProps) {
  return (
    <div className="avatar-panel" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 1.2, 3.2]} fov={45} />
        <OrbitControls target={[0, 1.0, 0]} enablePan={false} enableZoom={false} enableRotate={false} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 2, 3]} intensity={1} />
        <AvatarComponent 
          avatarId={avatarId}
          pipelineState={pipelineState} 
          movementEnabled={movementEnabled}
          mouthCuesRef={mouthCuesRef}
          audioContext={audioContext}
          playbackStartTimeRef={playbackStartTimeRef}
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
    prevProps.audioContext === nextProps.audioContext &&
    prevProps.playbackStartTimeRef === nextProps.playbackStartTimeRef
  );
});
