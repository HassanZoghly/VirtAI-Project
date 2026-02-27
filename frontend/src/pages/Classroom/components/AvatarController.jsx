import { useEffect, useRef, useState } from 'react';
import AvatarScene from './AvatarScene';
import { useAudioDrivenLipSync } from '../../../hooks/useAudioDrivenLipSync';

/**
 * AvatarController - Orchestrates avatar animations, audio playback, and lip sync
 *
 * This component maps pipeline state to animation state, handles audio playback,
 * and drives lip sync from mouthCues timeline by updating morph targets.
 *
 * Props:
 * - pipelineState: Current pipeline state ('idle', 'thinking', 'speaking', 'error')
 * - audioUrl: URL to audio file (when TTS is ready)
 * - mouthCues: Array of {start, end, value} for lip sync timeline
 * - modelPath: Path to GLB model file
 * - onModelLoaded: Callback when model is loaded
 * - onError: Callback for errors
 * - onAnimationComplete: Callback when animation completes (optional)
 */
export default function AvatarController({
  pipelineState = 'idle',
  audioUrl = null,
  mouthCues = [],
  modelPath,
  onModelLoaded,
  onError,
  onAnimationComplete,
}) {
  const [currentAnimation, setCurrentAnimation] = useState('idle'); // Start with idle, not greeting
  const audioRef = useRef(null);
  const hasGreetedRef = useRef(false);
  const hasInitializedRef = useRef(false); // Track if we've initialized
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Use enhanced audio-driven lip sync hook to get morph targets and body motion
  const { morphTargets, bodyMotion } = useAudioDrivenLipSync(audioRef, mouthCues, isPlayingAudio);

  // Map pipeline state to animation state
  useEffect(() => {
    // Skip if still in greeting animation
    if (!hasGreetedRef.current) {
      return;
    }

    // If audio is playing, keep speaking animation regardless of pipeline state
    // This fixes the "stands still" bug where avatar stops moving before audio ends
    if (isPlayingAudio) {
      setCurrentAnimation('speaking');
      return;
    }

    const animationMap = {
      idle: 'idle',
      thinking: 'thinking',
      speaking: 'speaking',
      error: 'idle',
    };

    const newAnimation = animationMap[pipelineState] || 'idle';
    setCurrentAnimation(newAnimation);
  }, [pipelineState, isPlayingAudio]);

  // Handle model loaded - play greeting animation ONCE on first load only
  const handleModelLoaded = () => {
    // Only play greeting on the very first load
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      setCurrentAnimation('greeting');

      // After greeting animation (approximately 3 seconds), switch to idle
      setTimeout(() => {
        hasGreetedRef.current = true;
        setCurrentAnimation('idle');
        onAnimationComplete?.();
      }, 3000);
    }

    onModelLoaded?.();
  };

  // Handle audio playback when audioUrl is provided
  useEffect(() => {
    if (!audioUrl) {
      // No audio, stop playing
      setIsPlayingAudio(false);
      return;
    }

    // Create and play audio
    const audio = new Audio(audioUrl);
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

    // When audio ends, return to idle
    audio.onended = () => {
      setIsPlayingAudio(false);
      setCurrentAnimation('idle');
    };

    // Cleanup
    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
        setIsPlayingAudio(false);
      }
    };
  }, [audioUrl, onError]);

  return (
    <AvatarScene
      modelPath={modelPath}
      currentAnimation={currentAnimation}
      morphTargets={morphTargets}
      bodyMotion={bodyMotion}
      onModelLoaded={handleModelLoaded}
      onError={onError}
    />
  );
}
