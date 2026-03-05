import { lazy, Suspense } from 'react';

const AvatarController = lazy(() => import('../../../pages/Classroom/components/AvatarController.jsx'));

/**
 * Avatar viewport panel with loading indicator and lazy-loaded AvatarController.
 * @param {object} props
 * @param {string} props.modelPath - Path to the GLB model file
 * @param {boolean} props.avatarLoaded - Whether the avatar model has loaded
 * @param {boolean} props.avatarError - Whether the avatar failed to load
 * @param {string} props.pipelineState - Current pipeline state
 * @param {string|null} props.audioUrl - TTS audio URL when speaking
 * @param {{ start: number, end: number, value: number }[]} props.mouthCues - Lip sync timeline
 * @param {() => void} props.onModelLoaded - Model loaded callback
 * @param {(error: Error) => void} props.onError - Error callback
 */
export default function AvatarPanel({
  modelPath,
  avatarLoaded,
  avatarError,
  pipelineState,
  audioUrl,
  mouthCues,
  onModelLoaded,
  onError,
}) {
  return (
    <div className="avatar-panel" style={{ background: avatarLoaded ? '#333' : '' }}>
      {!avatarLoaded && !avatarError && (
        <div className="avatar-skeleton-container" role="status" aria-busy="true" aria-label="Loading avatar">
          <div className="avatar-skeleton-silhouette">
            <div className="avatar-skeleton-head" />
            <div className="avatar-skeleton-body" />
          </div>
          <span className="avatar-skeleton-label">Loading avatar…</span>
        </div>
      )}

      <div className="avatar-canvas-wrapper visible" role="img" aria-label="AI avatar">
        <Suspense fallback={null}>
          <AvatarController
            modelPath={modelPath}
            pipelineState={pipelineState}
            audioUrl={audioUrl}
            mouthCues={mouthCues}
            onModelLoaded={onModelLoaded}
            onError={onError}
          />
        </Suspense>
      </div>
    </div>
  );
}
