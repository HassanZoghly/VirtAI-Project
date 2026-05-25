import { lazy, Suspense } from 'react';

const AvatarController = lazy(() => import('./AvatarController.jsx'));

/**
 * Avatar viewport panel with loading indicator and lazy-loaded AvatarController.
 * @param {object} props
 * @param {string} props.modelPath - Path to the GLB model file
 * @param {boolean} props.avatarLoaded - Whether the avatar model has loaded
 * @param {boolean} props.avatarError - Whether the avatar failed to load
 * @param {string} props.pipelineState - Current pipeline state
 * @param {string|null} props.audioUrl - TTS audio URL when speaking
 * @param {Array<object>} [props.audioItems] - Ordered TTS audio items queued by the shell
 * @param {number} [props.audioQueueResetToken] - Incremented to interrupt and clear queued audio
 * @param {{ start: number, end: number, value: number }[]} props.mouthCues - Lip sync timeline
 * @param {Array<object>} [props.animationTimeline] - Backend-provided animation timeline items
 * @param {() => void} props.onModelLoaded - Model loaded callback
 * @param {(error: Error) => void} props.onError
 * @param {boolean} props.isMovementEnabled - Whether full body motion is enabled
 * @param {object|null} props.emotionData - Emotion data from AI response - Error callback
 */
export default function AvatarPanel({
  modelPath,
  avatarLoaded,
  avatarError,
  pipelineState,
  audioUrl,
  audioItems,
  audioQueueResetToken,
  mouthCues,
  animationTimeline,
  onModelLoaded,
  onError,
  isMovementEnabled,
  emotionData,
}) {
  const panelClassName = `avatar-panel${avatarLoaded ? ' loaded' : ''}`;

  return (
    <div className={panelClassName} style={{ background: avatarLoaded ? '#333' : '' }}>
      {!avatarLoaded && !avatarError && (
        <div
          className="avatar-skeleton-container"
          role="status"
          aria-busy="true"
          aria-label="Loading avatar"
        >
          <div className="loader">
            <span></span>
            <span></span>
            <span></span>
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
            audioItems={audioItems}
            audioQueueResetToken={audioQueueResetToken}
            mouthCues={mouthCues}
            animationTimeline={animationTimeline}
            onModelLoaded={onModelLoaded}
            onError={onError}
            emotionData={emotionData}
            isMovementEnabled={isMovementEnabled}
          />
        </Suspense>
      </div>
    </div>
  );
}
