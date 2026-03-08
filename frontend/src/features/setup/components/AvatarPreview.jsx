import { AnimatePresence, motion } from 'motion/react';
import { HiOutlineUser, HiPlay, HiStop } from 'react-icons/hi2';
import SoundWaveAnimation from './SoundWaveAnimation';

export default function AvatarPreview({ avatar, voice, isPlaying, onPlayPreview, onStopPreview }) {
  const handlePlayToggle = () => {
    if (isPlaying) {
      onStopPreview();
    } else if (voice?.previewUrl) {
      onPlayPreview(voice.previewUrl);
    }
  };

  return (
    <div className="preview-panel">
      <span className="preview-label">Preview</span>

      <div className="preview-avatar-wrap">
        <AnimatePresence mode="wait">
          {avatar ? (
            <motion.img
              key={avatar.id}
              className="preview-avatar-img"
              src={avatar.image}
              alt={avatar.name}
              draggable={false}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.35 }}
            />
          ) : (
            <motion.div
              key="placeholder"
              className="preview-placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <HiOutlineUser size={28} />
              <span>Select avatar</span>
            </motion.div>
          )}
        </AnimatePresence>

        {isPlaying && <SoundWaveAnimation active={isPlaying} />}
      </div>

      <AnimatePresence mode="wait">
        {avatar && (
          <motion.span
            key={avatar.id}
            className="preview-name"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {avatar.name}
          </motion.span>
        )}
      </AnimatePresence>

      {voice && <span className="preview-voice">Voice: {voice.name}</span>}

      <button
        className="preview-voice-btn"
        onClick={handlePlayToggle}
        disabled={!voice}
        aria-label={isPlaying ? 'Stop voice preview' : 'Preview voice'}
      >
        {isPlaying ? <HiStop size={14} /> : <HiPlay size={14} />}
        {isPlaying ? 'Stop' : 'Preview Voice'}
      </button>
    </div>
  );
}
