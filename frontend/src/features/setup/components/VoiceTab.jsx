import SelectionCheckmark from '@/shared/components/SelectionCheckmark';
import { motion } from 'motion/react';
import { memo } from 'react';
import { HiPlay, HiStop } from 'react-icons/hi2';
import { voices } from '../data/voices';

const VoiceTab = memo(function VoiceTab({ selected, onSelect, avatarGender, onPlay, onStop, isPlaying, playingVoiceId }) {
  const filteredVoices = avatarGender ? voices.filter((v) => v.gender === avatarGender) : voices;

  const handlePlayToggle = (e, voice) => {
    e.stopPropagation();
    if (playingVoiceId === voice.id && isPlaying) {
      onStop();
    } else {
      onPlay(voice);
    }
  };

  return (
    <div className="voice-tab-scroll">
      <h2 className="setup-section-title">Choose a Voice</h2>
      <p className="setup-section-subtitle">Select how your avatar will sound</p>

      <div className="voice-grid" role="radiogroup" aria-label="Voices">
        {filteredVoices.map((voice, idx) => {
          const isSelected = selected?.id === voice.id;
          const isCurrentlyPlaying = playingVoiceId === voice.id && isPlaying;
          const isFocusable = isSelected || (!selected && idx === 0);

          return (
            <motion.div
              tabIndex={isFocusable ? 0 : -1}
              onKeyDown={(e) => {
                let nextIdx = null;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  nextIdx = (idx + 1) % filteredVoices.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  nextIdx = (idx - 1 + filteredVoices.length) % filteredVoices.length;
                }

                if (nextIdx !== null) {
                  e.preventDefault();
                  onSelect(filteredVoices[nextIdx]);
                  const grid = e.currentTarget.parentNode;
                  const nextElem = grid.children[nextIdx];
                  if (nextElem) nextElem.focus();
                } else if (e.key === 'Enter' || e.key === ' ') {
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
                onClick={(e) => handlePlayToggle(e, voice)}
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
});

export default VoiceTab;
