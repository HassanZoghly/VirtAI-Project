/**
 * AvatarController.jsx — Audio orchestrator and wiring layer.
 *
 * Responsibilities:
 *   - Manage WebAudioQueue for audio playback
 *   - Run useAudioDrivenLipSync hook
 *   - Connect audio events (onPlay/onEnded) to AvatarAnimationController
 *   - Pass lip sync refs and emotion data to AvatarScene
 *   - Process audioItems / audioUrl props into the audio queue
 *
 * Does NOT:
 *   - Own the animation mixer
 *   - Make animation decisions
 *   - Parse animation timelines
 *   - Run state machines
 */
import apiClient from '@/core/api/apiClient';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAudioDrivenLipSync } from '../hooks/useAudioDrivenLipSync';
import { WebAudioQueue } from '../utils/WebAudioQueue';
import { isAvatarDebugEnabled } from '../utils/avatarFirstFrameValidation';

const AvatarScene = React.lazy(() => import('./AvatarScene'));

function normalizeAudioRequestUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl, window.location.origin);
    const path = `${parsed.pathname}${parsed.search}`;
    if (path.startsWith('/api/v1/')) return path.slice('/api/v1'.length);
    return path;
  } catch {
    if (sourceUrl.startsWith('/api/v1/')) return sourceUrl.slice('/api/v1'.length);
    return sourceUrl;
  }
}

/**
 * AvatarController - Connects audio to avatar animation and lip sync.
 */
export default function AvatarController({
  pipelineState = 'idle',
  audioUrl = null,
  audioItems = null,
  audioQueueResetToken = 0,
  mouthCues = [],
  modelPath,
  avatarId,
  avatarLifecycleState,
  onSceneMounted,
  onFirstFrameValidated,
  onRenderFailure,
  onError,
  onAnimationComplete,
  emotionData,
  isMovementEnabled = true,
}) {
  const audioRef = useRef(null);
  const animationControllerRef = useRef(null); // AvatarAnimationController from AvatarScene

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const isPlayingAudioRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const audioRequestIdRef = useRef(0);

  // ── Lip sync hook ──────────────────────────────────────────────────────
  const { morphTargetsRef, updateLipSync } = useAudioDrivenLipSync(
    audioRef,
    mouthCues,
    isPlayingAudio
  );

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio;
  }, [isPlayingAudio]);

  const pipelineStateRef = useRef(pipelineState);
  const responseSpeakingRef = useRef(false);
  const endGraceTimerRef = useRef(null);
  const chunkIntervalsRef = useRef([]);
  const lastChunkTimeRef = useRef(0);
  
  const evaluateSpeechEnd = useCallback(() => {
    const hasPendingChunks = audioQueueRef.current.some(
      (item) => item.status === 'pending' || item.status === 'loading'
    );
    const audioDrained = !isPlayingAudioRef.current && !hasPendingChunks;
    
    if (audioDrained && pipelineStateRef.current === 'idle') {
      if (endGraceTimerRef.current) return; // already timing out

      const avg = chunkIntervalsRef.current.length
        ? chunkIntervalsRef.current.reduce((a, b) => a + b, 0) / chunkIntervalsRef.current.length
        : 800;
        
      const minGrace = 300;
      const maxGrace = 1200;
      const graceMs = Math.max(minGrace, Math.min(maxGrace, avg * 1.5));
      
      endGraceTimerRef.current = setTimeout(() => {
        endGraceTimerRef.current = null;
        // Double check after grace period
        if (!isPlayingAudioRef.current && pipelineStateRef.current === 'idle') {
           responseSpeakingRef.current = false;
           if (animationControllerRef.current) {
             animationControllerRef.current.stopTalking();
           }
        }
      }, graceMs);
    }
  }, []);

  useEffect(() => {
    pipelineStateRef.current = pipelineState;
    if (pipelineState === 'idle') {
      evaluateSpeechEnd();
    } else {
      // Reset chunk tracking on new session
      if (!responseSpeakingRef.current) {
        chunkIntervalsRef.current = [];
        lastChunkTimeRef.current = 0;
      }
    }
  }, [pipelineState, evaluateSpeechEnd]);

  // ── WebAudioQueue setup ────────────────────────────────────────────────
  const webAudioQueueRef = useRef(null);
  const audioQueueRef = useRef([]);
  const queuedAudioIdsRef = useRef(new Set());
  const currentAudioItemRef = useRef(null);

  useEffect(() => {
    const queue = new WebAudioQueue();
    webAudioQueueRef.current = queue;
    audioRef.current = queue;

    queue.onPlay = () => {
      setIsPlayingAudio(true);
      if (endGraceTimerRef.current) {
        clearTimeout(endGraceTimerRef.current);
        endGraceTimerRef.current = null;
      }

      if (!responseSpeakingRef.current) {
        responseSpeakingRef.current = true;
        // Signal animation controller: audio is playing → start body movement
        if (animationControllerRef.current) {
          animationControllerRef.current.startTalking(isMovementEnabled);
        }
      }
    };

    queue.onEnded = () => {
      setIsPlayingAudio(false);
      currentAudioItemRef.current = null;
      evaluateSpeechEnd();
    };

    return () => {
      queue.dispose();
      webAudioQueueRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: isMovementEnabled is accessed via closure. This is intentional —
  // we don't want to recreate the WebAudioQueue when the toggle changes.
  // The animation controller checks movementEnabled in startTalking().

  // ── Update pending chunk count ─────────────────────────────────────────
  const updatePendingChunksCount = useCallback(() => {
    const pendingCount = audioQueueRef.current.filter(
      (item) => item.status === 'pending' || item.status === 'loading'
    ).length;

    if (webAudioQueueRef.current) {
      webAudioQueueRef.current.setPendingChunkCount(pendingCount);
    }
  }, []);

  // ── Flush ready buffers to queue ───────────────────────────────────────
  const flushReadyBuffersToQueue = useCallback(() => {
    const queue = webAudioQueueRef.current;
    if (!queue) return false;

    let flushed = false;
    while (audioQueueRef.current.length > 0) {
      const nextItem = audioQueueRef.current[0];

      if (nextItem.status === 'ready' && nextItem.audioBuffer) {
        audioQueueRef.current.shift();
        currentAudioItemRef.current = nextItem;
        queue.queueBuffer(nextItem.audioBuffer);
        flushed = true;
        updatePendingChunksCount();
        continue;
      }

      if (nextItem.status === 'failed' || nextItem.cancelled) {
        audioQueueRef.current.shift();
        updatePendingChunksCount();
        continue;
      }

      break;
    }

    return flushed;
  }, [updatePendingChunksCount]);

  // ── Stop audio queue ───────────────────────────────────────────────────
  const stopAudioQueue = useCallback(
    ({ updateState = true } = {}) => {
      audioQueueRef.current.forEach((item) => {
        item.cancelled = true;
      });
      // eslint-disable-next-line react-hooks/immutability
      audioQueueRef.current = [];

      if (currentAudioItemRef.current) {
        currentAudioItemRef.current.cancelled = true;
        currentAudioItemRef.current = null;
      }

      if (webAudioQueueRef.current) {
        webAudioQueueRef.current.stop();
        webAudioQueueRef.current.setPendingChunkCount(0);
      }

      if (updateState) {
        setIsPlayingAudio(false);
      }

      updatePendingChunksCount();

      clearTimeout(endGraceTimerRef.current);
      responseSpeakingRef.current = false;

      // Stop body animation → return to idle
      if (animationControllerRef.current) {
        animationControllerRef.current.stopTalking();
      }
    },
    [updatePendingChunksCount]
  );

  // ── Process audio queue ────────────────────────────────────────────────
  const processAudioQueue = useCallback(() => {
    if (!webAudioQueueRef.current) return;

    let startedLoading = false;
    audioQueueRef.current.forEach((item) => {
      if (item.status === 'pending') {
        item.status = 'loading';
        startedLoading = true;

        const requestUrl = normalizeAudioRequestUrl(item.sourceUrl);
        if (!requestUrl) {
          item.status = 'failed';
          flushReadyBuffersToQueue();
          return;
        }

        apiClient
          .get(requestUrl, { responseType: 'blob' })
          .then(({ data: blob }) => {
            if (!blob) throw new Error('Received empty blob');
            if (item.cancelled) return;
            return webAudioQueueRef.current?.decode(blob);
          })
          .then((audioBuffer) => {
            if (!audioBuffer || item.cancelled) return;
            item.audioBuffer = audioBuffer;
            item.status = 'ready';
            flushReadyBuffersToQueue();
          })
          .catch((err) => {
            if (err?.response?.status === 400 || requestUrl.includes('filler')) {
               console.warn('[Audio] Skipping filler audio due to 400 error or missing asset:', err);
               // Gracefully ignore and let the queue proceed
               item.status = 'failed';
               item.cancelled = true; // prevent it from blocking
               flushReadyBuffersToQueue();
               return;
            }
            console.error('[AvatarController] Audio preload failed:', err);
            item.status = 'failed';
            flushReadyBuffersToQueue();
          });
      }
    });

    if (startedLoading) {
      updatePendingChunksCount();
    }

    flushReadyBuffersToQueue();
  }, [flushReadyBuffersToQueue, updatePendingChunksCount]);

  // ── Enqueue audio item ─────────────────────────────────────────────────
  const enqueueAudioItem = useCallback(
    (item) => {
      const sourceUrl = item?.url || item?.sourceUrl;
      if (!sourceUrl) return;

      const id = String(item.id || item.messageId || sourceUrl);
      if (queuedAudioIdsRef.current.has(id)) return;
      queuedAudioIdsRef.current.add(id);

      const now = performance.now();
      if (lastChunkTimeRef.current > 0 && pipelineStateRef.current !== 'idle') {
        const interval = now - lastChunkTimeRef.current;
        chunkIntervalsRef.current.push(interval);
        if (chunkIntervalsRef.current.length > 5) chunkIntervalsRef.current.shift();
      }
      lastChunkTimeRef.current = now;

      audioQueueRef.current.push({
        id,
        messageId: item.messageId || null,
        durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
        sourceUrl,
        status: 'pending',
        audioBuffer: null,
      });

      updatePendingChunksCount();
      processAudioQueue();
    },
    [processAudioQueue, updatePendingChunksCount]
  );

  // ── Audio queue reset ──────────────────────────────────────────────────
  const usesStructuredAudioItems = Array.isArray(audioItems);

  useEffect(() => {
    const timer = setTimeout(() => {
      queuedAudioIdsRef.current.clear();
      stopAudioQueue();
    }, 0);
    return () => clearTimeout(timer);
  }, [audioQueueResetToken, stopAudioQueue]);

  // ── Process structured audio items ─────────────────────────────────────
  useEffect(() => {
    if (!usesStructuredAudioItems) return;
    audioItems.forEach((item) => {
      enqueueAudioItem({
        id: item.id || item.messageId || item.url,
        messageId: item.messageId || null,
        durationMs: item.durationMs,
        url: item.url,
      });
    });
  }, [audioItems, enqueueAudioItem, usesStructuredAudioItems]);

  // ── Process single audio URL ───────────────────────────────────────────
  useEffect(() => {
    if (usesStructuredAudioItems) return;

    if (!audioUrl) {
      const timer = setTimeout(() => {
        queuedAudioIdsRef.current.clear();
        stopAudioQueue();
      }, 0);
      return () => clearTimeout(timer);
    }

    enqueueAudioItem({
      id: ++audioRequestIdRef.current,
      url: audioUrl,
    });
  }, [audioUrl, enqueueAudioItem, stopAudioQueue, usesStructuredAudioItems]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopAudioQueue({ updateState: false });
    };
  }, [stopAudioQueue]);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  const avatarDebugEnabled = isAvatarDebugEnabled();
  const renderCountRef = useRef(0);
  useEffect(() => {
    if (avatarDebugEnabled) {
      renderCountRef.current++;
      console.info(`[DIAG][AvatarController] 🔄 Render #${renderCountRef.current}. pipelineState: ${pipelineState}`);
    }
  });

  useEffect(() => {
    if (avatarDebugEnabled) {
      console.info('[DIAG][AvatarController] 🟢 MOUNTED');
      return () => console.info('[DIAG][AvatarController] 🔴 UNMOUNTED');
    }
    return undefined;
  }, [avatarDebugEnabled]);

  // ── Model loaded handler ───────────────────────────────────────────────────
  const handleModelLoaded = useCallback(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      onAnimationComplete?.();
    }
    onSceneMounted?.();
  }, [onAnimationComplete, onSceneMounted]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-t-2 border-b-2 border-gold opacity-80" />
        </div>
      }
    >
      <AvatarScene
        modelPath={modelPath}
        avatarId={avatarId}
        animationControllerRef={animationControllerRef}
        morphTargetsRef={morphTargetsRef}
        updateLipSync={updateLipSync}
        onModelLoaded={handleModelLoaded}
        avatarLifecycleState={avatarLifecycleState}
        onFirstFrameValidated={onFirstFrameValidated}
        onRenderFailure={onRenderFailure}
        onError={onError}
        audioRef={audioRef}
        isPlaying={isPlayingAudio}
        emotionData={emotionData}
        isMovementEnabled={isMovementEnabled}
      />
    </Suspense>
  );
}
