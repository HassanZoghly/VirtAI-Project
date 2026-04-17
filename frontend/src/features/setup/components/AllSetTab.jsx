import { motion } from 'motion/react';
import { useState } from 'react';
import { FiCheck } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import { updateSetupStatus } from '@/features/auth/services/authApi';
import { useAuthStore } from '@/features/auth/store/authStore';
import { markStartNewConversation } from '@/features/session/services/sessionStorage';
import Toast from '@/shared/utils/toast';
import { saveSetup } from '../services/setupStorage';
import SuccessAnimation from './SuccessAnimation';

const toast = new Toast();

export default function AllSetTab({ avatar, voice }) {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!avatar || !voice || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const updatedUser = await updateSetupStatus(true);
      setUser(updatedUser);

      saveSetup({
        avatarId: avatar.id,
        voiceId: voice.id,
      });

      markStartNewConversation();
      navigate('/classroom');
    } catch {
      toast.show('error', 'Setup Save Failed', 'Could not persist setup status. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const isReady = !!avatar && !!voice;

  return (
    <div className="allset-container">
      <SuccessAnimation />

      <motion.h2
        className="setup-section-title"
        style={{ textAlign: 'center', marginTop: 20 }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        You&#39;re All Set!
      </motion.h2>

      <motion.p
        className="setup-section-subtitle"
        style={{ textAlign: 'center' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        Your AI avatar assistant is ready
      </motion.p>

      <motion.div
        className="allset-summary"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1 }}
      >
        <div className="allset-item">
          <FiCheck className="check-icon" />
          <span>Avatar:</span>
          <span className="item-value">{avatar?.name ?? '—'}</span>
        </div>
        <div className="allset-item">
          <FiCheck className="check-icon" />
          <span>Voice:</span>
          <span className="item-value">{voice?.name ?? '—'}</span>
        </div>
      </motion.div>

      <motion.button
        className="shiny-save-btn"
        onClick={handleSave}
        disabled={!isReady || isSaving}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.3, type: 'spring', stiffness: 300, damping: 20 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        style={!isReady || isSaving ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <span style={{ position: 'relative', zIndex: 1 }}>
          {isSaving ? 'Saving...' : 'Save & Continue to Classroom →'}
        </span>
      </motion.button>
    </div>
  );
}
