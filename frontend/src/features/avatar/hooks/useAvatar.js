import { useCallback, useEffect, useState } from 'react';
import { eventBus, useEventBus } from '../../../shared/hooks/useEventBus';

/**
 * Composite avatar hook — owns avatar media state + WS subscriptions.
 *
 * Encapsulates audioUrl, mouthCues, loaded/error state and the
 * tts.ready / visemes.ready WS message wiring that ClassroomShell
 * previously handled inline.
 *
 * @param {{ onMessage: Function }} wsClient
 * @returns {{
 *   audioUrl: string|null,
 *   mouthCues: Array,
 *   avatarLoaded: boolean,
 *   avatarError: boolean,
 *   onModelLoaded: () => void,
 *   onError: () => void
 * }}
 */
export function useAvatar(wsClient) {
  const { onMessage } = wsClient;

  const [audioUrl, setAudioUrl] = useState(null);
  const [mouthCues, setMouthCues] = useState([]);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Subscribe to avatar-related WS messages
  useEffect(() => {
    const unsubs = [
      onMessage('tts.ready', (d) => {
        setAudioUrl(d.audio.url);
        eventBus.emit('avatar:start-talking', { audioUrl: d.audio.url, mouthCues: d.mouthCues });
      }),
      onMessage('visemes.ready', (d) => setMouthCues(d.mouthCues)),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage]);

  // Session switched → reset avatar media state so old audio doesn't play
  useEventBus('session:switched', () => {
    setAudioUrl(null);
    setMouthCues([]);
  });

  const onModelLoaded = useCallback(() => setAvatarLoaded(true), []);
  const onError = useCallback(() => setAvatarError(true), []);

  return {
    audioUrl,
    mouthCues,
    avatarLoaded,
    avatarError,
    onModelLoaded,
    onError,
  };
}

export default useAvatar;
