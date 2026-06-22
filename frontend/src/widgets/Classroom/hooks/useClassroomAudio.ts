import { useRef, useCallback, useEffect } from 'react';
import { useGaplessAudioQueue, Viseme } from '@/features/voice/hooks/useGaplessAudioQueue';

const EMPTY_LENGTH = 0;

export function useClassroomAudio() {
  // DEFENSIVE: Use arrays to queue sequential streaming chunks for a single messageId
  // This solves the Race Condition (P0) where TTS and Visemes arrive out of order.
  const pendingTtsRef = useRef<Record<string, string[]>>({});
  const pendingVisemesRef = useRef<Record<string, Viseme[][]>>({});
  
  const mouthCuesRef = useRef<Viseme[]>([]);
  const playedAudioIdsRef = useRef<Set<string>>(new Set());

  // DEFENSIVE: Kill the "Late Chunk" Zombie. 
  // Store aborted message IDs to instantly drop late-arriving packets from the network.
  const abortedMessageIdsRef = useRef<Set<string>>(new Set());

  const { enqueueAudioUrl, flushQueue, getAudioContext, playbackStartTimeRef, getIsAudioPlaying, getNextPlaybackTime } = useGaplessAudioQueue();

  const tryPlayChunk = useCallback((messageId: string) => {
    if (abortedMessageIdsRef.current.has(messageId)) {
      delete pendingTtsRef.current[messageId];
      delete pendingVisemesRef.current[messageId];
      return;
    }
    
    const ttsList = pendingTtsRef.current[messageId] || [];
    const visemeList = pendingVisemesRef.current[messageId] || [];

    // DEFENSIVE: Synchronization Barrier. 
    // Do not enqueue audio until BOTH the audio binary and viseme array for this chunk are ready.
    while (ttsList.length > EMPTY_LENGTH && visemeList.length > EMPTY_LENGTH) {
      const url = ttsList.shift()!;
      const cues = visemeList.shift()!;
      
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      enqueueAudioUrl(url, cues, mouthCuesRef);
    }
  }, [getAudioContext, enqueueAudioUrl]);

  const handleTtsReady = useCallback((messageId: string | undefined, url: string) => {
    if (!messageId) return;
    if (abortedMessageIdsRef.current.has(messageId)) return;
    
    if (!pendingTtsRef.current[messageId]) pendingTtsRef.current[messageId] = [];
    pendingTtsRef.current[messageId].push(url);
    
    tryPlayChunk(messageId);
  }, [tryPlayChunk]);

  const handleVisemesReady = useCallback((messageId: string, cues: Viseme[]) => {
    if (abortedMessageIdsRef.current.has(messageId)) return;
    
    if (!pendingVisemesRef.current[messageId]) pendingVisemesRef.current[messageId] = [];
    pendingVisemesRef.current[messageId].push(cues);
    
    tryPlayChunk(messageId);
  }, [tryPlayChunk]);

  const resetAvatarAudio = useCallback((abortedMessageId?: string | null) => {
    if (abortedMessageId) {
      abortedMessageIdsRef.current.add(abortedMessageId);
    }
    pendingTtsRef.current = {};
    pendingVisemesRef.current = {};
    mouthCuesRef.current = [];
    flushQueue();
    playedAudioIdsRef.current.clear();
  }, [flushQueue]);

  return {
    mouthCuesRef,
    getAudioContext,
    playbackStartTimeRef,
    handleTtsReady,
    handleVisemesReady,
    resetAvatarAudio,
    flushQueue,
    playedAudioIdsRef,
    getIsAudioPlaying,
    getNextPlaybackTime
  };
}
