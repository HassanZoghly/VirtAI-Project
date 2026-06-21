import { useRef, useCallback, useEffect } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';

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
        node.stop(0);
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

  return {
    enqueueAudioUrl,
    flushQueue,
    getAudioContext,
    playbackStartTimeRef: visemeBaseStartTimeRef,
  };
}
