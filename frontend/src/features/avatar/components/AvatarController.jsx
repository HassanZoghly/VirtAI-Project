import apiClient from '@/shared/services/apiClient';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAudioDrivenLipSync } from '../hooks/useAudioDrivenLipSync';
import { WebAudioQueue } from '../utils/WebAudioQueue';
import { ConversationalStateMachine, CONVERSATION_STATES } from '../utils/ConversationalStateMachine';

const AvatarScene = React.lazy(() => import('./AvatarScene'));

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

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { enqueue, flush, replace };
}

/**
 * AvatarController - Orchestrates avatar animations, audio playback, and lip sync.
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
  const [conversationState, setConversationState] = useState(CONVERSATION_STATES.IDLE);

  const audioRef = useRef(null);
  const stateMachineRef = useRef(new ConversationalStateMachine());
  
  const hasGreetedRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const isPlayingAudioRef = useRef(false);
  const pendingTimelineRef = useRef([]);
  const hasActiveTimelineRef = useRef(false);
  const audioRequestIdRef = useRef(0);
  const [audioGeneration, setAudioGeneration] = useState(0);

  // Sync state machine changes to React state for UI/props
  useEffect(() => {
    stateMachineRef.current.onStateChange((newState) => {
      setConversationState(newState);
      if (isMovementEnabled) {
        // Only drive animation changes via state machine if we have no active explicit timeline
        if (!hasActiveTimelineRef.current) {
          const anim = stateMachineRef.current.getAnimationForState();
          setCurrentAnimation(anim);
        }
      }
    });
  }, [isMovementEnabled]);

  const { flush, replace } = useAnimationQueue(setCurrentAnimation, () => {
    hasActiveTimelineRef.current = false;
    if (isPlayingAudioRef.current) {
      setCurrentAnimation('speaking');
    } else {
      setCurrentAnimation(stateMachineRef.current.getAnimationForState());
    }
  });

  // Use enhanced audio-driven lip sync hook
  const { morphTargetsRef, speechFeaturesRef, updateLipSync } = useAudioDrivenLipSync(
    audioRef,
    mouthCues,
    isPlayingAudio
  );

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
              setCurrentAnimation(stateMachineRef.current.getAnimationForState());
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

  // Map pipeline state to Conversational State Machine
  useEffect(() => {
    if (!hasGreetedRef.current) return;

    if (pipelineState === 'thinking') {
      stateMachineRef.current.onThinkingStart();
    } else if (pipelineState === 'idle') {
      if (!isPlayingAudioRef.current) {
         // Don't force idle if we just finished speaking (let it ReturnToIdle naturally)
         if (!stateMachineRef.current.isTransitioning) {
            stateMachineRef.current.forceIdle();
         }
      }
    }
  }, [pipelineState]);

  const handleModelLoaded = () => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      hasGreetedRef.current = true;
      flush('idle');
      onAnimationComplete?.();
    }
    onModelLoaded?.();
  };

  // --- AUDIO PRELOADING BUFFER via WebAudioQueue ---
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
      stateMachineRef.current.onAudioStart();
    };
    
    queue.onEnded = () => {
      setIsPlayingAudio(false);
      currentAudioItemRef.current = null;

      const hasPendingChunks = audioQueueRef.current.some(
        (item) => item.status === 'pending' || item.status === 'loading'
      );
      
      if (!hasPendingChunks) {
        stateMachineRef.current?.onAudioEnd?.();
        hasActiveTimelineRef.current = false;
        pendingTimelineRef.current = [];
      } else {
        // Technically onEnded shouldn't fire if pending chunks > 0 with our new WebAudioQueue, 
        // but just in case it does due to a long timeout:
        stateMachineRef.current?.onAudioChunkEnd?.();
      }
    };

    return () => {
      queue.dispose();
      webAudioQueueRef.current = null;
    };
  }, []);

  // Tell state machine & queue about pending chunks to prevent premature starvation
  const updatePendingChunksCount = useCallback(() => {
    const pendingCount = audioQueueRef.current.filter(
      (item) => item.status === 'pending' || item.status === 'loading'
    ).length;
    
    if (webAudioQueueRef.current) {
      webAudioQueueRef.current.setPendingChunkCount(pendingCount);
    }
    stateMachineRef.current.setPendingAudioChunks(pendingCount);
  }, []);

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
        setAudioGeneration((gen) => gen + 1);
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

  const stopAudioQueue = useCallback(
    ({ resetAnimation = false, updateState = true } = {}) => {
      audioQueueRef.current.forEach((item) => {
        item.cancelled = true;
      });
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
      stateMachineRef.current.forceIdle();

      if (resetAnimation) {
        pendingTimelineRef.current = [];
        hasActiveTimelineRef.current = false;
        flush('idle');
      }
    },
    [flush, updatePendingChunksCount]
  );

  const processAudioQueue = useCallback(() => {
    if (!webAudioQueueRef.current) {
      return;
    }

    // Process all pending -> loading concurrently
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
            // Recursively flush when a buffer finishes decoding
            flushReadyBuffersToQueue();
          })
          .catch((err) => {
            console.error('[AvatarController] Audio preload failed:', err);
            item.status = 'failed';
            flushReadyBuffersToQueue();
          });
      }
    });

    if (startedLoading) {
      updatePendingChunksCount();
    }

    // Flush any already-ready buffers (e.g. from cache)
    flushReadyBuffersToQueue();
    
  }, [flushReadyBuffersToQueue, updatePendingChunksCount]);

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

  const usesStructuredAudioItems = Array.isArray(audioItems);

  useEffect(() => {
    queuedAudioIdsRef.current.clear();
    stopAudioQueue({ resetAnimation: true });
  }, [audioQueueResetToken, stopAudioQueue]);

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

  // Removed legacy onAudioPlaying effect; ConversationalStateMachine now updates deterministically in AvatarScene's useFrame.

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
        conversationState={conversationState}
        stateMachineRef={stateMachineRef}
        morphTargetsRef={morphTargetsRef}
        speechFeaturesRef={speechFeaturesRef}
        updateLipSync={updateLipSync}
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
