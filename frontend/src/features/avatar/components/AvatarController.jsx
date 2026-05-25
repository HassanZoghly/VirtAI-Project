import apiClient from '@/shared/services/apiClient';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAudioDrivenLipSync } from '../hooks/useAudioDrivenLipSync';

const AvatarScene = React.lazy(() => import('./AvatarScene'));

const TIMELINE_FPS = 30;
const AUDIO_BUFFER_READY_TIMEOUT_MS = 2500;
const HTML_MEDIA_HAVE_FUTURE_DATA = 3;

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function toAnimationDirective(item) {
  const animationAsset = item.animation_asset ?? item.animationAsset ?? null;
  const inferredTalk =
    typeof animationAsset === 'string'
      ? (() => {
          const match = animationAsset.match(/talk(\d+)/i);
          return match ? `talk${match[1]}` : null;
        })()
      : null;

  return {
    animation: item.animation ?? inferredTalk ?? 'idle',
    animationAsset,
    startFrame: firstFinite(item.start_frame, item.startFrame),
    endFrame: firstFinite(item.end_frame, item.endFrame),
    transitionOutFrame: firstFinite(item.transition_out_frame, item.transitionOutFrame),
    loopStartFrame: firstFinite(item.loop_start_frame, item.loopStartFrame),
    loopEndFrame: firstFinite(item.loop_end_frame, item.loopEndFrame),
    startTime: firstFinite(item.start_time, item.startTime),
    endTime: firstFinite(item.end_time, item.endTime),
    loopStartTime: firstFinite(item.loop_start_time, item.loopStartTime),
    loopEndTime: firstFinite(item.loop_end_time, item.loopEndTime),
    transitionOutTime: firstFinite(item.transition_out_time, item.transitionOutTime),
    blend: firstFinite(item.blend_weight, item.blendWeight, item.blend),
    speed: firstFinite(item.speed, item.playback_speed, item.playbackSpeed),
    intensity: firstFinite(item.intensity),
    transitionType: item.transition_type ?? item.transitionType,
    intent: item.intent,
    tone: item.tone,
    text: item.text,
  };
}

function estimateTimelineDurationMs(item) {
  const startTime = firstFinite(item.start_time, item.startTime);
  const endTime = firstFinite(item.end_time, item.endTime);

  if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
    return Math.max(100, Math.round((endTime - startTime) * 1000));
  }

  const start = Number.isFinite(item.start_frame) ? item.start_frame : 0;
  const effectiveEnd = Number.isFinite(item.transition_out_frame)
    ? item.transition_out_frame
    : Number.isFinite(item.end_frame)
      ? item.end_frame
      : null;

  if (Number.isFinite(effectiveEnd) && effectiveEnd > start) {
    const frameSpan = Math.max(1, effectiveEnd - start + 1);
    const blend = Number.isFinite(item.blend) ? Math.max(0, Math.min(1, item.blend)) : 0.3;
    const blendMs = 80 + blend * 160;
    return Math.max(120, Math.round((frameSpan / TIMELINE_FPS) * 1000 + blendMs));
  }

  const words =
    typeof item.text === 'string' ? item.text.trim().split(/\s+/).filter(Boolean).length : 0;
  const fromText = words > 0 ? words * 170 : 0;

  return fromText > 0 ? Math.max(180, Math.round(fromText)) : 420;
}

function normalizeAudioRequestUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl, window.location.origin);
    const path = `${parsed.pathname}${parsed.search}`;
    if (path.startsWith('/api/v1/')) {
      return path.slice('/api/v1'.length);
    }
    return path;
  } catch {
    if (sourceUrl.startsWith('/api/v1/')) {
      return sourceUrl.slice('/api/v1'.length);
    }
    return sourceUrl;
  }
}

/**
 * useAnimationQueue — sequential animation queue with interrupt support.
 *
 * Each queued item is `{ animation: string, durationMs?: number }`.
 * - If `durationMs` is set the item plays for that duration then advances.
 * - If `durationMs` is omitted (or 0) the item stays until interrupted or
 *   the queue is flushed externally.
 *
 * `flush(animation)` clears the queue and immediately plays `animation`.
 * `enqueue(items)` appends one or more items and starts processing if idle.
 * `replace(items)` replaces the queue and starts processing immediately.
 */
function useAnimationQueue(setAnimation, onDrain) {
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const processingRef = useRef(false);

  const processNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      processingRef.current = false;
      onDrain?.();
      return;
    }

    processingRef.current = true;
    const { animation, durationMs, onComplete } = queueRef.current.shift();
    setAnimation(animation);

    if (durationMs && durationMs > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onComplete?.();
        processNext();
      }, durationMs);
    }
    // If no duration, the item stays active until flush() or next enqueue with advance
  }, [setAnimation, onDrain]);

  const enqueue = useCallback(
    (items) => {
      const list = Array.isArray(items) ? items : [items];
      queueRef.current.push(...list);
      if (!processingRef.current) {
        processNext();
      }
    },
    [processNext]
  );

  const flush = useCallback(
    (animation) => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      processingRef.current = false;
      setAnimation(animation);
    },
    [setAnimation]
  );

  const replace = useCallback(
    (items) => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      processingRef.current = false;

      const list = Array.isArray(items) ? items : [items];
      queueRef.current.push(...list);
      processNext();
    },
    [processNext]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { enqueue, flush, replace };
}

/**
 * AvatarController - Orchestrates avatar animations, audio playback, and lip sync.
 *
 * Maps pipeline state to animation state, handles audio playback,
 * and drives lip sync from mouthCues timeline by updating morph targets.
 *
 * @param {object} props
 * @param {'idle'|'thinking'|'speaking'|'error'} [props.pipelineState='idle'] - Current pipeline state
 * @param {string|null} [props.audioUrl] - URL to audio file (when TTS is ready)
 * @param {Array<{ id?: string, messageId?: string, url: string, durationMs?: number|null }>|null} [props.audioItems] - Ordered TTS audio items
 * @param {number} [props.audioQueueResetToken] - Incremented to interrupt and clear queued audio
 * @param {Array<{ start: number, end: number, value: string }>} [props.mouthCues] - Lip-sync timeline
 * @param {Array<object>} [props.animationTimeline] - Backend animation timeline items
 * @param {string} props.modelPath - Path to GLB model file
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {(err: Error) => void} [props.onError] - Callback for errors
 * @param {() => void} [props.onAnimationComplete] - Callback when animation completes
 * @param {boolean} [props.isMovementEnabled] - Whether full body motion is enabled
 */
export default function AvatarController({
  pipelineState = 'idle',
  audioUrl = null,
  audioItems = null,
  audioQueueResetToken = 0,
  mouthCues = [],
  animationTimeline = [],
  modelPath,
  onModelLoaded,
  onError,
  onAnimationComplete,
  emotionData,
  intents = [],
  isMovementEnabled = true,
}) {
  const [currentAnimation, setCurrentAnimation] = useState('idle');
  const audioRef = useRef(null);
  const hasGreetedRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const isPlayingAudioRef = useRef(false);
  const pendingTimelineRef = useRef([]);
  const hasActiveTimelineRef = useRef(false);
  const audioRequestIdRef = useRef(0);
  // Bumped for each queued audio item so AvatarScene can pick a fresh talk variant.
  const [audioGeneration, setAudioGeneration] = useState(0);

  const { flush, replace } = useAnimationQueue(setCurrentAnimation, () => {
    hasActiveTimelineRef.current = false;
    if (isPlayingAudioRef.current) {
      setCurrentAnimation('speaking');
    }
  });

  // Use enhanced audio-driven lip sync hook to get morph targets and body motion
  const { morphTargetsRef } = useAudioDrivenLipSync(audioRef, mouthCues, isPlayingAudio);

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio;
  }, [isPlayingAudio]);

  useEffect(() => {
    if (!Array.isArray(animationTimeline) || animationTimeline.length === 0) {
      return;
    }

    const normalized = animationTimeline
      .filter(
        (item) =>
          item &&
          (typeof item.animation === 'string' ||
            typeof item.animation_asset === 'string' ||
            typeof item.animationAsset === 'string')
      )
      .map((item) => ({
        directive: toAnimationDirective(item),
        durationMs: estimateTimelineDurationMs(item),
      }));

    if (normalized.length > 0) {
      pendingTimelineRef.current = normalized;
    }
  }, [animationTimeline]);

  const startTimelinePlayback = useCallback(() => {
    if (!isMovementEnabled) {
      pendingTimelineRef.current = [];
      return false;
    }
    const pending = [...pendingTimelineRef.current];
    if (!pending || pending.length === 0) {
      return false;
    }

    pending.sort((a, b) => {
      const aStart = a.directive.startTime;
      const bStart = b.directive.startTime;
      if (Number.isFinite(aStart) && Number.isFinite(bStart)) {
        return aStart - bStart;
      }
      return 0;
    });

    const queueItems = pending.map((item, index) => ({
      animation: item.directive,
      durationMs: item.durationMs,
      onComplete:
        index === pending.length - 1
          ? () => {
              hasActiveTimelineRef.current = false;
            }
          : undefined,
    }));

    hasActiveTimelineRef.current = true;
    replace(queueItems);
    pendingTimelineRef.current = [];
    return true;
  }, [replace, isMovementEnabled]);

  useEffect(() => {
    if (!isPlayingAudio || hasActiveTimelineRef.current || !isMovementEnabled) {
      return;
    }
    if (pendingTimelineRef.current.length > 0) {
      startTimelinePlayback();
    }
  }, [animationTimeline, isPlayingAudio, startTimelinePlayback, isMovementEnabled]);

  // Map pipeline state to animation state — flushes queue on each state change
  useEffect(() => {
    // Skip if still in greeting sequence
    if (!hasGreetedRef.current) {
      return;
    }

    if (!isMovementEnabled) {
      pendingTimelineRef.current = [];
      hasActiveTimelineRef.current = false;
      flush('idle');
      return;
    }

    // If audio is playing, keep speaking animation regardless of pipeline state
    if (isPlayingAudio) {
      if (!hasActiveTimelineRef.current) {
        const started = startTimelinePlayback();
        if (!started) {
          flush('speaking');
        }
      }
      return;
    }

    const animationMap = {
      idle: 'idle',
      thinking: 'thinking',
      speaking: 'idle',
      error: 'idle',
    };

    flush(animationMap[pipelineState] || 'idle');
  }, [pipelineState, isPlayingAudio, flush, startTimelinePlayback, isMovementEnabled]);

  const handleModelLoaded = () => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      hasGreetedRef.current = true;
      flush('idle');
      onAnimationComplete?.();
    }

    onModelLoaded?.();
  };

  // --- AUDIO PRELOADING BUFFER ---
  const audioQueueRef = useRef([]);
  const queuedAudioIdsRef = useRef(new Set());
  const currentAudioItemRef = useRef(null);
  const audioElementRef = useRef(null);
  const isProcessingQueueRef = useRef(false);
  const playNextReadyAudioRef = useRef(() => false);
  const handlePlaybackEndedRef = useRef(() => {});
  const handlePlaybackErrorRef = useRef(() => {});

  const releaseAudioItem = useCallback((item) => {
    if (!item) {
      return;
    }

    if (item.playTimeoutId) {
      clearTimeout(item.playTimeoutId);
      item.playTimeoutId = null;
    }

    if (item.audio) {
      item.audio.onended = null;
      item.audio.onerror = null;
      item.audio.onplaying = null;
      item.audio.pause();
      item.audio.removeAttribute('src');
      item.audio.load();
      if (audioElementRef.current === item.audio) {
        audioElementRef.current = null;
      }
      if (audioRef.current === item.audio) {
        audioRef.current = null;
      }
      item.audio = null;
    }

    if (item.blobUrl) {
      try {
        URL.revokeObjectURL(item.blobUrl);
      } catch {
        // Ignore revoke failures.
      }
      item.blobUrl = null;
    }
  }, []);

  const destroyAudioElement = useCallback(() => {
    const audio = audioElementRef.current;
    if (!audio) {
      audioRef.current = null;
      return;
    }

    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audioElementRef.current = null;
    audioRef.current = null;
  }, []);

  const handlePlaybackEnded = useCallback(() => {
    const endedItem = currentAudioItemRef.current;
    currentAudioItemRef.current = null;

    const startedNext = playNextReadyAudioRef.current();
    releaseAudioItem(endedItem);

    if (startedNext) {
      return;
    }

    destroyAudioElement();
    setIsPlayingAudio(false);

    const hasPendingChunks = audioQueueRef.current.some(
      (item) => item.status === 'pending' || item.status === 'loading'
    );
    if (!hasPendingChunks) {
      hasActiveTimelineRef.current = false;
      pendingTimelineRef.current = [];
      flush('idle');
    }
  }, [destroyAudioElement, flush, releaseAudioItem]);

  const handlePlaybackError = useCallback(
    (err) => {
      console.error('[AvatarController] Audio play failed:', err);
      const failedItem = currentAudioItemRef.current;
      currentAudioItemRef.current = null;
      releaseAudioItem(failedItem);

      if (!playNextReadyAudioRef.current()) {
        destroyAudioElement();
        setIsPlayingAudio(false);
      }

      onError?.(err instanceof Error ? err : new Error('Audio playback failed'));
    },
    [destroyAudioElement, onError, releaseAudioItem]
  );

  handlePlaybackEndedRef.current = handlePlaybackEnded;
  handlePlaybackErrorRef.current = handlePlaybackError;

  const createPreloadingAudio = useCallback(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    return audio;
  }, []);

  const loadBufferedAudio = useCallback((audio, blobUrl) => {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        audio.removeEventListener('canplaythrough', handleReady);
        audio.removeEventListener('canplay', handleReady);
        audio.removeEventListener('loadeddata', handleReady);
        audio.removeEventListener('error', handleError);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      function handleReady() {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(audio);
      }

      function handleError() {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(audio.error || new Error('Audio buffering failed'));
      }

      audio.src = blobUrl;
      audio.addEventListener('canplaythrough', handleReady, { once: true });
      audio.addEventListener('canplay', handleReady, { once: true });
      audio.addEventListener('loadeddata', handleReady, { once: true });
      audio.addEventListener('error', handleError, { once: true });
      timeoutId = setTimeout(handleReady, AUDIO_BUFFER_READY_TIMEOUT_MS);
      audio.load();

      if (audio.readyState >= HTML_MEDIA_HAVE_FUTURE_DATA) {
        handleReady();
      }
    });
  }, []);

  const startAudioItem = useCallback(
    (item, delayMs = 0) => {
      const audio = item?.audio;
      if (!audio) {
        return false;
      }

      currentAudioItemRef.current = item;
      audioElementRef.current = audio;
      audioRef.current = audio;
      audio.onended = () => handlePlaybackEndedRef.current();
      audio.onerror = () =>
        handlePlaybackErrorRef.current(audio.error || new Error('Audio playback failed'));
      audio.onplaying = () => setIsPlayingAudio(true);

      const doPlay = () => {
        if (item.cancelled) return;
        const playPromise = audio.play();
        if (playPromise?.catch) {
          playPromise.catch((err) => handlePlaybackErrorRef.current(err));
        }
        setAudioGeneration((generation) => generation + 1);
      };

      if (delayMs > 0) {
        item.playTimeoutId = setTimeout(doPlay, delayMs);
      } else {
        doPlay();
      }

      return true;
    },
    []
  );

  const playNextReadyAudio = useCallback(() => {
    if (currentAudioItemRef.current) {
      return false;
    }

    while (audioQueueRef.current.length > 0) {
      const nextItem = audioQueueRef.current[0];
      if (nextItem.status === 'ready') {
        audioQueueRef.current.shift();
        
        // SMART PRE-BUFFER: Delay chunk 0 to absorb generation latency of chunk 1
        const isFirstChunk = 
          (typeof nextItem.id === 'string' && nextItem.id.endsWith('_0')) || 
          (typeof nextItem.messageId === 'string' && nextItem.messageId.endsWith('_0')) ||
          (typeof nextItem.sourceUrl === 'string' && nextItem.sourceUrl.includes('_0.mp3'));
          
        const delayMs = isFirstChunk ? 600 : 0;
        
        return startAudioItem(nextItem, delayMs);
      }
      if (nextItem.status === 'failed' || nextItem.cancelled) {
        audioQueueRef.current.shift();
        releaseAudioItem(nextItem);
        continue;
      }
      break;
    }

    return false;
  }, [releaseAudioItem, startAudioItem]);

  playNextReadyAudioRef.current = playNextReadyAudio;

  const stopAudioQueue = useCallback(
    ({ resetAnimation = false, updateState = true } = {}) => {
      audioQueueRef.current.forEach((item) => {
        item.cancelled = true;
        releaseAudioItem(item);
      });
      audioQueueRef.current = [];

      if (currentAudioItemRef.current) {
        currentAudioItemRef.current.cancelled = true;
        releaseAudioItem(currentAudioItemRef.current);
        currentAudioItemRef.current = null;
      }

      destroyAudioElement();

      if (updateState) {
        setIsPlayingAudio(false);
      }

      if (resetAnimation) {
        pendingTimelineRef.current = [];
        hasActiveTimelineRef.current = false;
        flush('idle');
      }
    },
    [destroyAudioElement, flush, releaseAudioItem]
  );

  const processAudioQueue = useCallback(() => {
    if (isProcessingQueueRef.current) {
      return;
    }
    isProcessingQueueRef.current = true;

    // 1. Start fetching pending items in the background
    audioQueueRef.current.forEach((item) => {
      if (item.status === 'pending') {
        item.status = 'loading';
        const requestUrl = normalizeAudioRequestUrl(item.sourceUrl);
        if (!requestUrl) {
          item.status = 'failed';
          return;
        }
        if (!item.audio) {
          item.audio = createPreloadingAudio();
        }

        apiClient
          .get(requestUrl, { responseType: 'blob' })
          .then(({ data: blob }) => {
            if (!blob) {
              throw new Error('Received empty blob');
            }
            const blobUrl = URL.createObjectURL(blob);
            if (item.cancelled) {
              URL.revokeObjectURL(blobUrl);
              return;
            }
            item.blobUrl = blobUrl;
            return loadBufferedAudio(item.audio, blobUrl);
          })
          .then((audio) => {
            if (!audio) {
              return;
            }
            if (item.cancelled) {
              audio.pause();
              audio.removeAttribute('src');
              audio.load();
              releaseAudioItem(item);
              return;
            }
            item.audio = audio;
            item.status = 'ready';
            processAudioQueue();
          })
          .catch((err) => {
            console.error('[AvatarController] Audio preload failed:', err);
            item.status = 'failed';
            processAudioQueue();
          });
      }
    });

    // 2. Play the next ready item if nothing is currently playing.
    if (!currentAudioItemRef.current) {
      playNextReadyAudio();
    }

    isProcessingQueueRef.current = false;
  }, [createPreloadingAudio, loadBufferedAudio, playNextReadyAudio, releaseAudioItem]);

  const enqueueAudioItem = useCallback(
    (item) => {
      const sourceUrl = item?.url || item?.sourceUrl;
      if (!sourceUrl) {
        return;
      }

      const id = String(item.id || item.messageId || sourceUrl);
      if (queuedAudioIdsRef.current.has(id)) {
        return;
      }
      queuedAudioIdsRef.current.add(id);

      const audio = createPreloadingAudio();
      audioQueueRef.current.push({
        id,
        messageId: item.messageId || null,
        durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
        sourceUrl,
        status: 'pending',
        blobUrl: null,
        audio,
      });

      processAudioQueue();
    },
    [createPreloadingAudio, processAudioQueue]
  );

  const usesStructuredAudioItems = Array.isArray(audioItems);

  useEffect(() => {
    queuedAudioIdsRef.current.clear();
    stopAudioQueue({ resetAnimation: true });
  }, [audioQueueResetToken, stopAudioQueue]);

  // --- Stage 1: Sync incoming ordered audio items into the Queue ---
  useEffect(() => {
    if (!usesStructuredAudioItems) {
      return;
    }

    audioItems.forEach((item) => {
      enqueueAudioItem({
        id: item.id || item.messageId || item.url,
        messageId: item.messageId || null,
        durationMs: item.durationMs,
        url: item.url,
      });
    });
  }, [audioItems, enqueueAudioItem, usesStructuredAudioItems]);

  // Legacy single-URL path for callers that have not moved to audioItems.
  useEffect(() => {
    if (usesStructuredAudioItems) {
      return;
    }

    if (!audioUrl) {
      queuedAudioIdsRef.current.clear();
      stopAudioQueue({ resetAnimation: true });
      return;
    }

    enqueueAudioItem({
      id: ++audioRequestIdRef.current,
      url: audioUrl,
    });
  }, [audioUrl, enqueueAudioItem, stopAudioQueue, usesStructuredAudioItems]);

  useEffect(() => {
    return () => {
      stopAudioQueue({ updateState: false });
    };
  }, [stopAudioQueue]);

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
        currentAnimation={currentAnimation}
        morphTargetsRef={morphTargetsRef}
        onModelLoaded={handleModelLoaded}
        onError={onError}
        audioRef={audioRef}
        mouthCues={mouthCues}
        isPlaying={isPlayingAudio}
        emotionData={emotionData}
        currentIntents={intents}
        isMovementEnabled={isMovementEnabled}
        audioGeneration={audioGeneration}
      />
    </Suspense>
  );
}
