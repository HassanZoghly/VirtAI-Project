import React, { useEffect, useState } from 'react';

/**
 * AvatarDiagnostics — Dev-only diagnostic overlay for tracking audio buffers, 
 * conversational states, and procedural motion layers.
 * 
 * Usage: Render <AvatarDiagnostics queueRef={audioRef} state={conversationState} />
 * in development builds.
 */
export const AvatarDiagnostics = ({ 
  audioRef, 
  conversationState,
  speechFeatures,
  proceduralData = {}
}) => {
  const [stats, setStats] = useState({
    bufferAheadSeconds: 0,
    queueDepth: 0,
    isPlaying: false
  });

  useEffect(() => {
    if (import.meta.env.PROD) return;

    let rafId;
    const updateStats = () => {
      if (audioRef?.current) {
        setStats({
          bufferAheadSeconds: audioRef.current.bufferLeadTimeSeconds || 0,
          queueDepth: audioRef.current.queueDepth || 0,
          isPlaying: audioRef.current.isPlaying || false
        });
      }
      rafId = requestAnimationFrame(updateStats);
    };
    rafId = requestAnimationFrame(updateStats);
    return () => cancelAnimationFrame(rafId);
  }, [audioRef]);

  if (import.meta.env.PROD) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#00ff00',
      fontFamily: 'monospace',
      fontSize: '11px',
      padding: '10px',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: 9999,
      lineHeight: '1.4'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#fff' }}>AVATAR DIAGNOSTICS</div>
      
      <div style={{ color: '#aaa', marginTop: '5px' }}>CONVERSATION STATE</div>
      <div>State: <span style={{ color: '#00ffff' }}>{conversationState}</span></div>
      
      <div style={{ color: '#aaa', marginTop: '5px' }}>AUDIO QUEUE</div>
      <div>Playing: {stats.isPlaying ? 'YES' : 'NO'}</div>
      <div>Queue Depth: {stats.queueDepth} chunks</div>
      <div>Buffer Ahead: {stats.bufferAheadSeconds.toFixed(2)}s</div>
      {stats.bufferAheadSeconds < 0.2 && stats.isPlaying && (
        <div style={{ color: '#ff0000', fontWeight: 'bold' }}>STARVATION WARNING!</div>
      )}

      <div style={{ color: '#aaa', marginTop: '5px' }}>SPEECH FEATURES</div>
      <div>Energy: {(speechFeatures?.energy || 0).toFixed(3)}</div>
      <div>Silent Gap: {speechFeatures?.isSilentGap ? 'YES' : 'NO'}</div>
    </div>
  );
};
