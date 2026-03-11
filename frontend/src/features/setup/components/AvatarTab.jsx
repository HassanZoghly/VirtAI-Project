import { avatarImages } from '@/features/avatar/data/avatars';
import { AnimatePresence, motion } from 'motion/react';
import { FiCheck } from 'react-icons/fi';

const avatarList = Object.values(avatarImages);

export default function AvatarTab({ selected, onSelect }) {
  return (
    <div>
      <h2 className="setup-section-title">Choose Your Avatar</h2>
      <p className="setup-section-subtitle">Select the avatar that will be your AI assistant</p>

      <div className="avatar-grid">
        {avatarList.map((avatar, idx) => {
          const isSelected = selected?.id === avatar.id;
          return (
            <motion.div
              key={avatar.id}
              className={`avatar-card${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(avatar)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              whileHover={{ y: -3 }}
              role="radio"
              aria-checked={isSelected}
              aria-label={avatar.name}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(avatar);
                }
              }}
            >
              <img
                className="avatar-card-img"
                src={avatar.image}
                alt={avatar.name}
                width={200}
                height={200}
                draggable={false}
                loading="lazy"
                decoding="async"
              />
              <span className="avatar-card-name">{avatar.name}</span>
              <span className="avatar-card-desc">{avatar.description}</span>

              <AnimatePresence>
                {isSelected && (
                  <motion.span
                    className="avatar-card-check"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <FiCheck size={13} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
