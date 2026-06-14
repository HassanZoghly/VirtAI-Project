/* eslint-disable no-console */
import React, { lazy, Suspense, useRef, useEffect } from 'react';

const AvatarController = lazy(() => import('./AvatarController.jsx'));

/**
 * Avatar viewport panel with loading indicator, error UI, and lazy-loaded AvatarController.
 *
 * @param {object} props
 * @param {string} props.modelPath - Path to the GLB model file
 * @param {string} props.avatarId - Active avatar ID (e.g., 'avatar1')
 * @param {'loading'|'scene-ready'|'failed'} props.avatarStatus - Avatar lifecycle status
 * @param {string} props.pipelineState - Current pipeline state
 * @param {string|null} props.audioUrl - TTS audio URL when speaking
 * @param {Array<object>} [props.audioItems] - Ordered TTS audio items queued by the shell
 * @param {number} [props.audioQueueResetToken] - Incremented to interrupt and clear queued audio
 * @param {{ start: number, end: number, value: number }[]} props.mouthCues - Lip sync timeline
 * @param {(error: Error) => void} props.onError - Error callback
 * @param {() => void} props.onRetry - Retry loading callback
 * @param {boolean} props.isMovementEnabled - Whether full body motion is enabled
 * @param {object|null} props.emotionData - Emotion data from AI response
 * @param {Error|null} [props.lastError] - Last error object for dev diagnostics
 */
export default function AvatarPanel({
  modelPath,
  avatarId,
  avatarStatus = 'loading',
  pipelineState,
  audioUrl,
  audioItems,
  audioQueueResetToken,
  mouthCues,
  onSceneMounted,
  onFirstFrameValidated,
  onRenderFailure,
  onError,
  onRetry,
  isMovementEnabled,
  emotionData,
  lastError,
}) {
  // Phase 0 diagnostics (kept until visibility confirmed)
  const renderCountRef = useRef(0);
  if (import.meta.env.DEV) {
    renderCountRef.current++;
    console.info(`[DIAG][AvatarPanel] 🔄 Render #${renderCountRef.current}. avatarStatus: ${avatarStatus}, modelPath: ${modelPath}, avatarId: ${avatarId}`);
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[DIAG][AvatarPanel] 🟢 ACTUAL MOUNT');
      const interval = setInterval(() => {
        const wrapper = document.querySelector('.avatar-canvas-wrapper');
        const canvas = document.querySelector('.avatar-canvas-wrapper canvas');
        const skeleton = document.querySelector('.avatar-skeleton-container');
        const panel = document.querySelector('.avatar-panel');
        
        console.info('[DIAG][DOM_AUDIT]', {
          avatarStatus,
          pipelineState,
          panelClasses: panel?.className,
          wrapperClasses: wrapper?.className,
          wrapperOpacity: wrapper ? window.getComputedStyle(wrapper).opacity : null,
          wrapperDisplay: wrapper ? window.getComputedStyle(wrapper).display : null,
          wrapperVisibility: wrapper ? window.getComputedStyle(wrapper).visibility : null,
          canvasMounted: !!canvas,
          canvasBounds: canvas?.getBoundingClientRect(),
          canvasDisplay: canvas ? window.getComputedStyle(canvas).display : null,
          canvasVisibility: canvas ? window.getComputedStyle(canvas).visibility : null,
          canvasOpacity: canvas ? window.getComputedStyle(canvas).opacity : null,
          canvasWidth: canvas?.width,
          canvasHeight: canvas?.height,
          skeletonMounted: !!skeleton,
          skeletonOpacity: skeleton ? window.getComputedStyle(skeleton).opacity : null,
        });
      }, 5000);

      return () => {
        console.info('[DIAG][AvatarPanel] 🔴 ACTUAL UNMOUNT');
        clearInterval(interval);
      };
    }
  }, []); // Empty deps so it ONLY tracks true mount/unmount

  if (import.meta.env.DEV) {
    if (avatarStatus === 'failed') {
      console.warn('[DIAG][AvatarPanel] ⚠️ avatarStatus is FAILED — error UI should be visible');
    }
  }

  const isLoaded = avatarStatus === 'scene-ready';
  const isFailed = avatarStatus === 'failed';
  const isLoading = avatarStatus === 'loading' || avatarStatus === 'scene-mounted';

  const panelClassName = `avatar-panel${isLoaded ? ' loaded' : ''}`;

  return (
    <div className={panelClassName} style={{ background: isLoaded ? '#333' : '' }}>
      {/* Loading skeleton — visible only while loading */}
      {isLoading && (
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

      {/* Error state — visible when avatar fails to load */}
      {isFailed && (
        <div className="avatar-error-container" role="alert">
          <div className="avatar-error-icon">⚠️</div>
          <p className="avatar-error-title">Avatar failed to load</p>
          <p className="avatar-error-detail">
            The 3D model could not be rendered. Please try again.
          </p>
          {onRetry && (
            <button
              className="avatar-retry-btn"
              onClick={onRetry}
              type="button"
            >
              Try Again
            </button>
          )}
          {import.meta.env.DEV && lastError && (
            <pre className="avatar-error-dev">
              {lastError.message || String(lastError)}
            </pre>
          )}
        </div>
      )}

      {/* Avatar canvas — always mounted to allow loading, visibility controlled by CSS */}
      <div className={`avatar-canvas-wrapper${isFailed ? '' : ' visible'}`} role="img" aria-label="AI avatar">
        <Suspense fallback={null}>
          <AvatarController
            modelPath={modelPath}
            avatarId={avatarId}
            pipelineState={pipelineState}
            audioUrl={audioUrl}
            audioItems={audioItems}
            audioQueueResetToken={audioQueueResetToken}
            mouthCues={mouthCues}
            onSceneMounted={onSceneMounted}
            onFirstFrameValidated={onFirstFrameValidated}
            onRenderFailure={onRenderFailure}
            onError={onError}
            emotionData={emotionData}
            isMovementEnabled={isMovementEnabled}
          />
        </Suspense>
      </div>

      {/* Diagnostic Overlay */}
      {import.meta.env.DEV && (
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 9999,
          background: 'rgba(0,0,0,0.8)', color: 'lime', fontSize: '10px',
          padding: '8px', fontFamily: 'monospace', pointerEvents: 'none',
          whiteSpace: 'pre-wrap'
        }}>
          {`[DIAG]\nStatus: ${avatarStatus}\nLoading: ${isLoading}\nFailed: ${isFailed}\nLoaded: ${isLoaded}\nPipeline: ${pipelineState}\nEmotion: ${emotionData?.primary || 'none'}`}
        </div>
      )}
    </div>
  );
}
