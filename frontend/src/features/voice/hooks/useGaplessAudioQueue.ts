import { useRef, useCallback, useEffect } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';

const IMMEDIATE_STOP_TIME = 0;
const WATCHDOG_TIMEOUT_MS = 2000;

export interface Viseme {
  start: number;
  end: number;
  value: string;
}

export function useGaplessAudioQueue() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);
  const scheduledNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const visemeBaseStartTimeRef = useRef<number | null>(null);
  const processingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const flushTokenRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController>(new AbortController());

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const flushQueue = useCallback(() => {
    flushTokenRef.current += 1;

    processingQueueRef.current = Promise.resolve();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
    }

    scheduledNodesRef.current.forEach((node) => {
      try {
        node.stop(IMMEDIATE_STOP_TIME);
        node.disconnect();
      } catch (e) {}
    });

    scheduledNodesRef.current = [];

    if (audioContextRef.current) {
      nextPlaybackTimeRef.current = audioContextRef.current.currentTime;
    } else {
      nextPlaybackTimeRef.current = 0;
    }

    visemeBaseStartTimeRef.current = null;
  }, []);

  const enqueueAudioUrl = useCallback(
    (url: string, visemes: Viseme[] = [], mouthCuesRef: React.MutableRefObject<Viseme[]> | null = null) => {
      const currentToken = flushTokenRef.current;

      processingQueueRef.current = processingQueueRef.current
        .then(async () => {
          if (currentToken !== flushTokenRef.current) return;

          const ctx = getAudioContext();
          const token = useAuthStore.getState().accessToken;
          const headers = token ? { Authorization: `Bearer ${token}` } : {};

          const response = await fetch(url, {
            headers,
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();

          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }

          if (currentToken !== flushTokenRef.current) return;

          if (ctx.currentTime >= nextPlaybackTimeRef.current) {
            visemeBaseStartTimeRef.current = null;
            if (mouthCuesRef) {
              mouthCuesRef.current = [];
            }
          }

          const scheduleTime = Math.max(ctx.currentTime, nextPlaybackTimeRef.current);
          if (visemeBaseStartTimeRef.current === null) {
            visemeBaseStartTimeRef.current = scheduleTime;
          }

          const chunkOffset = scheduleTime - visemeBaseStartTimeRef.current;

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          scheduledNodesRef.current.push(source);

          source.onended = () => {
            try {
              source.disconnect();
              // Defensive GC: Nullify buffer to prevent memory leaks from retained audio buffers
              // @ts-ignore - intentional memory release
              source.buffer = null;
            } catch (e) {}
            scheduledNodesRef.current = scheduledNodesRef.current.filter((n) => n !== source);
          };

          source.start(scheduleTime);
          nextPlaybackTimeRef.current = scheduleTime + audioBuffer.duration;

          if (visemes.length > 0 && mouthCuesRef) {
            const shiftedVisemes = visemes.map((v) => ({
              ...v,
              start: v.start + chunkOffset,
              end: v.end + chunkOffset,
            }));
            mouthCuesRef.current.push(...shiftedVisemes);
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          console.error('[GaplessAudio] Processing Queue failed:', err);
        });
    },
    [getAudioContext]
  );

  useEffect(() => {
    return () => flushQueue();
  }, [flushQueue]);

  useEffect(() => {
    // DEFENSIVE: Stalled Audio Queue Watchdog
    // Polls the AudioContext state. If suspended while nodes are scheduled, forces resume.
    // If playback is irreparably desynced (stuck 2000ms past intended end), flushes queue to recover.
    const watchdog = window.setInterval(() => {
      const ctx = audioContextRef.current;
      if (!ctx || scheduledNodesRef.current.length === 0) return;
      
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      } else if (ctx.state === 'running' && ctx.currentTime > nextPlaybackTimeRef.current + (WATCHDOG_TIMEOUT_MS / 1000)) {
        console.warn('[GaplessAudio] Watchdog triggered: Audio context stalled. Flushing queue.');
        flushQueue();
      }
    }, WATCHDOG_TIMEOUT_MS);

    return () => window.clearInterval(watchdog);
  }, [flushQueue]);

  return {
    enqueueAudioUrl,
    flushQueue,
    getAudioContext,
    playbackStartTimeRef: visemeBaseStartTimeRef,
  };
}
