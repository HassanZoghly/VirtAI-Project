import { GREETING_DURATION_MS } from '@/widgets/Classroom/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioDrivenLipSync } from '../hooks/useAudioDrivenLipSync';
import AvatarScene from './AvatarScene';

/** Mandatory silence between consecutive spoken responses (ms). */
const INTER_RESPONSE_PAUSE_MS = 2500;

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
 */
function useAnimationQueue(setAnimation) {
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const processingRef = useRef(false);

  const processNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      processingRef.current = false;
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
  }, [setAnimation]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { enqueue, flush };
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
 * @param {string} props.modelPath - Path to GLB model file
 * @param {() => void} [props.onModelLoaded] - Callback when model is loaded
 * @param {(err: Error) => void} [props.onError] - Callback for errors
 * @param {() => void} [props.onAnimationComplete] - Callback when animation completes
 */
export default function AvatarController({
  pipelineState = 'idle',
  audioUrl = null,
  mouthCues = [],
  modelPath,
  onModelLoaded,
  onError,
  onAnimationComplete,
  emotionData,
}) {
  const [currentAnimation, setCurrentAnimation] = useState('idle');
  const audioRef = useRef(null);
  const hasGreetedRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // --- Inter-response pause state ---
  // Decoupled from the prop so incoming URLs can be queued during the pause.
  const [currentPlayUrl, setCurrentPlayUrl] = useState(null);
  const isPausingRef = useRef(false); // true while the 2.5 s gap is active
  const pauseTimerRef = useRef(null);
  const pendingAudioUrlRef = useRef(null); // URL queued during a pause

  const { enqueue, flush } = useAnimationQueue(setCurrentAnimation);

  // Use enhanced audio-driven lip sync hook to get morph targets and body motion
  const { morphTargets, bodyMotion } = useAudioDrivenLipSync(audioRef, mouthCues, isPlayingAudio);

  // Map pipeline state to animation state — flushes queue on each state change
  useEffect(() => {
    // Skip if still in greeting sequence
    if (!hasGreetedRef.current) {
      return;
    }

    // If audio is playing, keep speaking animation regardless of pipeline state
    // This fixes the "stands still" bug where avatar stops moving before audio ends
    if (isPlayingAudio) {
      flush('speaking');
      return;
    }

    const animationMap = {
      idle: 'idle',
      thinking: 'thinking',
      speaking: 'speaking',
      error: 'idle',
    };

    flush(animationMap[pipelineState] || 'idle');
  }, [pipelineState, isPlayingAudio, flush]);

  // Handle model loaded — queue greeting → idle sequence
  const handleModelLoaded = () => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
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

    onModelLoaded?.();
  };

  // --- Stage 1: sync the incoming audioUrl prop into internal play state ---
  // When a new URL arrives during the post-speech pause, it is queued instead
  // of played immediately. Interruptions (new URL while audio is playing) are
  // forwarded directly so the avatar reacts without delay.
  useEffect(() => {
    if (!audioUrl) {
      // Stop everything and clear any pending state
      setCurrentPlayUrl(null);
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
      isPausingRef.current = false;
      pendingAudioUrlRef.current = null;
      return;
    }

    if (isPausingRef.current) {
      // Avatar just finished speaking — hold the URL until the pause expires
      pendingAudioUrlRef.current = audioUrl;
      return () => {
        pendingAudioUrlRef.current = null;
      };
    }

    setCurrentPlayUrl(audioUrl);
  }, [audioUrl]);

  // --- Stage 2: begin the mandatory 2.5 s silence after speech ends ---
  const beginPostSpeechPause = useCallback(() => {
    isPausingRef.current = true;
    flush('idle'); // return to natural idle while waiting

    clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      isPausingRef.current = false;
      pauseTimerRef.current = null;

      const pending = pendingAudioUrlRef.current;
      if (pending) {
        pendingAudioUrlRef.current = null;
        setCurrentPlayUrl(pending); // triggers Stage 3 to play the queued response
      }
    }, INTER_RESPONSE_PAUSE_MS);
  }, [flush]);

  // Cleanup pause timer on unmount
  useEffect(() => {
    return () => clearTimeout(pauseTimerRef.current);
  }, []);

  // --- Stage 3: actual audio playback (driven by currentPlayUrl, not the prop) ---
  useEffect(() => {
    if (!currentPlayUrl) {
      setIsPlayingAudio(false);
      return;
    }

    const audio = new Audio(currentPlayUrl);
    audioRef.current = audio;

    audio
      .play()
      .then(() => {
        setIsPlayingAudio(true);
      })
      .catch((err) => {
        console.error('[AvatarController] Audio play failed:', err);
        setIsPlayingAudio(false);
        onError?.(err);
      });

    // When speech finishes, start the inter-response pause instead of going
    // idle immediately — the pause itself transitions to idle via flush().
    audio.onended = () => {
      setIsPlayingAudio(false);
      beginPostSpeechPause();
    };

    return () => {
      audio.pause();
      audio.src = '';
      setIsPlayingAudio(false);
    };
  }, [currentPlayUrl, beginPostSpeechPause, onError]);

  return (
    <AvatarScene
      modelPath={modelPath}
      currentAnimation={currentAnimation}
      morphTargets={morphTargets}
      bodyMotion={bodyMotion}
      onModelLoaded={handleModelLoaded}
      onError={onError}
      audioRef={audioRef}
      mouthCues={mouthCues}
      isPlaying={isPlayingAudio}
      emotionData={emotionData}
    />
  );
}
