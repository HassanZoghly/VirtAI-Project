import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HiPlay, HiStop } from 'react-icons/hi2';
import SelectionCheckmark from '@/shared/components/SelectionCheckmark';
import { voices } from '../data/voices';

export default function VoiceTab({ selected, onSelect, avatarGender, onPlay, onStop, isPlaying }) {
  const filteredVoices = avatarGender ? voices.filter((v) => v.gender === avatarGender) : voices;
  const [playingId, setPlayingId] = useState(null);
  const playingIdRef = useRef(null);

  // Keep ref in sync for event handlers
  useEffect(() => {
    playingIdRef.current = playingId;
  }, [playingId]);

  // Sync playingId with parent's isPlaying state during render
  if (!isPlaying && playingId) {
    setPlayingId(null);
  }

  const handlePlayToggle = useCallback(
    (voice) => {
      if (playingIdRef.current === voice.id) {
        onStop();
        setPlayingId(null);
      } else {
        setPlayingId(voice.id);
        onPlay(voice.previewUrl);
      }
    },
    [onPlay, onStop]
  );

  return (
    <div className="voice-tab-scroll">
      <h2 className="setup-section-title">Choose a Voice</h2>
      <p className="setup-section-subtitle">Select how your avatar will sound</p>

      <div className="voice-grid">
        {filteredVoices.map((voice, idx) => {
          const isSelected = selected?.id === voice.id;
          const isCurrentlyPlaying = playingId === voice.id && isPlaying;
          return (
            <motion.div
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(voice);
                }
              }}
              key={voice.id}
              className={`voice-card${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(voice)}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: idx * 0.06 }}
              role="radio"
              aria-checked={isSelected}
              aria-label={`${voice.name} — ${voice.desc}`}
            >
              <div className="voice-card-info">
                <div className="voice-card-name">
                  {voice.name}
                  <span className={`voice-gender-badge ${voice.gender}`}>{voice.gender}</span>
                  {isCurrentlyPlaying && (
                    <div className="mini-equalizer">
                      <span className="bar" />
                      <span className="bar" />
                      <span className="bar" />
                      <span className="bar" />
                    </div>
                  )}
                </div>
                <div className="voice-card-desc">{voice.desc}</div>
                <div className="voice-card-greeting">&ldquo;{voice.greeting}&rdquo;</div>
              </div>

              <button
                type="button"
                className={`voice-play-btn${isCurrentlyPlaying ? ' playing' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayToggle(voice);
                }}
                aria-label={
                  isCurrentlyPlaying ? `Stop ${voice.name} preview` : `Play ${voice.name} preview`
                }
              >
                {isCurrentlyPlaying ? <HiStop size={16} /> : <HiPlay size={16} />}
              </button>

              <SelectionCheckmark
                isSelected={isSelected}
                className="voice-card-check"
                size={12}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
