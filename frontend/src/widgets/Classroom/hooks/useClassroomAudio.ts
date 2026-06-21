import { useRef, useCallback, useState } from 'react';
import { useGaplessAudioQueue, Viseme } from '@/features/voice/hooks/useGaplessAudioQueue';

export function useClassroomAudio() {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  // GC Mitigation: Decoupled rapid-stream buffers
  const pendingVisemesRef = useRef<Record<string, Viseme[]>>({});
  const mouthCuesRef = useRef<Viseme[]>([]);
  const playedAudioIdsRef = useRef<Set<string>>(new Set());

  const { enqueueAudioUrl, flushQueue, getAudioContext, playbackStartTimeRef } = useGaplessAudioQueue();

  const handleTtsReady = useCallback((messageId: string | undefined, url: string) => {
    setAudioUrl(url);
    
    // Resume context if suspended due to autoplay policy
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const pairedCues = messageId && pendingVisemesRef.current[messageId] 
      ? pendingVisemesRef.current[messageId] 
      : [];

    enqueueAudioUrl(url, pairedCues, mouthCuesRef);
  }, [enqueueAudioUrl, getAudioContext]);

  const handleVisemesReady = useCallback((messageId: string, cues: Viseme[]) => {
    console.log("Extracted Visemes:", cues.length);
    pendingVisemesRef.current[messageId] = cues;
    // Note: If tts.ready was already processed before visemes.ready, the cues would be missed here.
    // However, depending on backend order, storing them handles visemes arriving first.
    // A robust fix would retroactively append them if the audio queue has the same message playing.
  }, []);

  const resetAvatarAudio = useCallback(() => {
    setAudioUrl(null);
    pendingVisemesRef.current = {};
    mouthCuesRef.current = [];
    flushQueue();
    playedAudioIdsRef.current.clear();
  }, [flushQueue]);

  return {
    audioUrl,
    mouthCuesRef,
    getAudioContext,
    playbackStartTimeRef,
    handleTtsReady,
    handleVisemesReady,
    resetAvatarAudio,
    flushQueue,
    playedAudioIdsRef
  };
}
