import apiClient from '@/shared/services/apiClient';
import { GREETING_DURATION_MS } from '@/widgets/Classroom/constants';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAudioDrivenLipSync } from '../hooks/useAudioDrivenLipSync';

const AvatarScene = React.lazy(() => import('./AvatarScene'));

/** Mandatory silence between consecutive spoken responses (ms). */
const INTER_RESPONSE_PAUSE_MS = 2500;
const START_WITH_IDLE_STANCE = true;
const TIMELINE_FPS = 30;

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
  mouthCues = [],
  animationTimeline = [],
  modelPath,
  onModelLoaded,
  onError,
  onAnimationComplete,
  emotionData,
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
  // Tracks whether we've started playback for the current audio URL.
  // Cleared when currentPlayUrl changes so the scene picks a fresh talk variant.
  const audioGenerationRef = useRef(0);

  // --- Inter-response pause state ---
  // Decoupled from the prop so incoming URLs can be queued during the pause.
  const [currentPlayUrl, setCurrentPlayUrl] = useState(null);
  const isPausingRef = useRef(false); // true while the 2.5 s gap is active
  const pauseTimerRef = useRef(null);
  const pendingAudioUrlRef = useRef(null); // URL queued during a pause

  const { enqueue, flush, replace } = useAnimationQueue(setCurrentAnimation, () => {
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

  // Handle model loaded — queue greeting → idle sequence
  const handleModelLoaded = () => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;

      if (START_WITH_IDLE_STANCE) {
        hasGreetedRef.current = true;
        flush('idle');
        onAnimationComplete?.();
      } else {
        enqueue([
          {
            animation: 'greeting',
            durationMs: GREETING_DURATION_MS,
            onComplete: () => {
              hasGreetedRef.current = true;
              onAnimationComplete?.();
            },
          },
          { animation: 'idle' },
        ]);
      }
    }

    onModelLoaded?.();
  };

  const loadSecureAudioUrl = useCallback(
    async (sourceUrl) => {
      const requestUrl = normalizeAudioRequestUrl(sourceUrl);
      if (!requestUrl) {
        return;
      }

      const requestId = ++audioRequestIdRef.current;

      try {
        const { data: blob } = await apiClient.get(requestUrl, { responseType: 'blob' });
        if (requestId !== audioRequestIdRef.current) {
          return;
        }

        const blobUrl = URL.createObjectURL(blob);
        setCurrentPlayUrl(blobUrl);
      } catch (err) {
        if (requestId !== audioRequestIdRef.current) {
          return;
        }

        console.error('[AvatarController] Secure audio fetch failed:', err);
        setIsPlayingAudio(false);
        setCurrentPlayUrl(null);
        onError?.(err);
      }
    },
    [onError]
  );

  // --- Stage 1: sync the incoming audioUrl prop into internal play state ---
  // When a new URL arrives during the post-speech pause, it is queued instead
  // of played immediately. Interruptions (new URL while audio is playing) are
  // forwarded directly so the avatar reacts without delay.
  useEffect(() => {
    if (!audioUrl) {
      // Stop everything and clear any pending state
      audioRequestIdRef.current += 1;
      setCurrentPlayUrl(null);
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
      isPausingRef.current = false;
      pendingAudioUrlRef.current = null;
      pendingTimelineRef.current = [];
      hasActiveTimelineRef.current = false;
      return;
    }

    if (isPausingRef.current) {
      // Avatar just finished speaking — hold the URL until the pause expires
      pendingAudioUrlRef.current = audioUrl;
      return () => {
        pendingAudioUrlRef.current = null;
      };
    }

    setCurrentPlayUrl(null);
    void loadSecureAudioUrl(audioUrl);
  }, [audioUrl, loadSecureAudioUrl]);

  // --- Stage 2: begin the mandatory 2.5 s silence after speech ends ---
  const beginPostSpeechPause = useCallback(() => {
    isPausingRef.current = true;
    hasActiveTimelineRef.current = false;
    pendingTimelineRef.current = [];
    flush('idle'); // return to natural idle while waiting

    clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      isPausingRef.current = false;
      pauseTimerRef.current = null;

      const pending = pendingAudioUrlRef.current;
      if (pending) {
        pendingAudioUrlRef.current = null;
        void loadSecureAudioUrl(pending); // triggers Stage 3 to play the queued response
      }
    }, INTER_RESPONSE_PAUSE_MS);
  }, [flush, loadSecureAudioUrl]);

  // Cleanup pause timer on unmount
  useEffect(() => {
    return () => clearTimeout(pauseTimerRef.current);
  }, []);

  // --- Stage 3: actual audio playback (driven by currentPlayUrl, not the prop) ---
  useEffect(() => {
    if (!currentPlayUrl) {
      audioRef.current = null;
      setIsPlayingAudio(false);
      return;
    }

    // Increment generation so AvatarScene knows this is a fresh response
    // and should pick a new talk variant instead of keeping the old one.
    audioGenerationRef.current += 1;

    const audio = new Audio(currentPlayUrl);
    audioRef.current = audio;
    audio.preload = 'auto';

    const handlePlay = () => {
      setIsPlayingAudio(true);
    };

    const handlePause = () => {
      setIsPlayingAudio(false);
    };

    const handleEnded = () => {
      setIsPlayingAudio(false);
      setCurrentPlayUrl(null);
      beginPostSpeechPause();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    audio.play().catch((err) => {
      console.error('[AvatarController] Audio play failed:', err);
      setIsPlayingAudio(false);
      setCurrentPlayUrl(null);
      onError?.(err);
    });

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audio.src = '';
      try {
        URL.revokeObjectURL(currentPlayUrl);
      } catch {
        // Ignore revoke failures.
      }
      audioRef.current = null;
      setIsPlayingAudio(false);
    };
  }, [currentPlayUrl, beginPostSpeechPause, onError]);

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
        audioGeneration={audioGenerationRef.current}
        isMovementEnabled={isMovementEnabled}
      />
    </Suspense>
  );
}
