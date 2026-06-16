import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { FiCheck, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { HiOutlineSparkles, HiOutlineSpeakerWave, HiOutlineUser } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';

import { avatarImages } from '@/features/avatar/data/avatars';
import { cn } from '@/shared/utils/cn';
import CircuitBoardBackground from '@/widgets/Overview/CircuitBoardBackground';
import { voices as VOICES } from '../data/voices';
import { loadSetup } from '../services/setupStorage';
import AllSetTab from './AllSetTab';
import AvatarPreview from './AvatarPreview';
import AvatarTab from './AvatarTab';
import VoiceTab from './VoiceTab';

const TABS = [
  { key: 'avatar', label: 'Avatar', icon: HiOutlineUser },
  { key: 'voice', label: 'Voice', icon: HiOutlineSpeakerWave },
  { key: 'allset', label: 'All Set', icon: HiOutlineSparkles },
];

export default function SetupPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    const saved = loadSetup();
    if (!saved || !saved.avatarId) return null;
    return Object.values(avatarImages).find((av) => av.id === saved.avatarId) ?? null;
  });
  const [selectedVoice, setSelectedVoice] = useState(() => {
    const saved = loadSetup();
    if (!saved || !saved.voiceId) return null;
    const voice = VOICES.find((vo) => vo.id === saved.voiceId) ?? null;
    const avatar = saved.avatarId ? Object.values(avatarImages).find((av) => av.id === saved.avatarId) : null;
    if (avatar && voice && avatar.gender !== voice.gender) return null;
    return voice;
  });
  const [isMovementEnabled, setIsMovementEnabled] = useState(() => {
    const saved = loadSetup();
    if (saved && typeof saved.movementEnabled === 'boolean') {
      return saved.movementEnabled;
    }
    return false;
  });



  const [isPlaying, setIsPlaying] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState(null);
  const [direction, setDirection] = useState(1);
  const audioRef = useRef(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
    setPlayingVoiceId(null);
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => stopAudio();
  }, [stopAudio]);

  // Clear voice selection when avatar gender changes
  const handleAvatarSelect = useCallback(
    (avatar) => {
      if (selectedAvatar && avatar.gender !== selectedAvatar.gender) {
        setSelectedVoice(null);
        stopAudio();
      }
      setSelectedAvatar(avatar);
    },
    [selectedAvatar, stopAudio]
  );


  const isTabComplete = useCallback(
    (idx) => {
      if (idx === 0) {
        return !!selectedAvatar;
      }
      if (idx === 1) {
        return !!selectedVoice;
      }
      return false;
    },
    [selectedAvatar, selectedVoice]
  );

  const canAdvance = isTabComplete(activeTab);

  const goTo = useCallback(
    (idx) => {
      setDirection(idx > activeTab ? 1 : -1);
      setActiveTab(idx);
    },
    [activeTab]
  );

  const handleBack = () => {
    if (activeTab === 0) {
      navigate('/');
    } else {
      goTo(activeTab - 1);
    }
  };

  const handleNext = () => {
    if (activeTab < TABS.length - 1 && canAdvance) {
      goTo(activeTab + 1);
    }
  };

  const playPreview = useCallback((voice) => {
    stopAudio();
    if (!voice?.previewUrl) {
      return;
    }
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    const currentAudio = audio;

    currentAudio.addEventListener('ended', () => {
      if (audioRef.current === currentAudio) {
        setIsPlaying(false);
        setPlayingVoiceId(null);
      }
    });
    currentAudio.addEventListener('error', () => {
      if (audioRef.current === currentAudio) {
        setIsPlaying(false);
        setPlayingVoiceId(null);
      }
    });
    
    currentAudio
      .play()
      .then(() => {
        if (audioRef.current === currentAudio) {
          setIsPlaying(true);
          setPlayingVoiceId(voice.id);
        }
      })
      .catch(() => {
        if (audioRef.current === currentAudio) {
          setIsPlaying(false);
          setPlayingVoiceId(null);
        }
      });
  }, [stopAudio]);

  const slideVariants = {
    enter: (d) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <div className="setup-page">
      <Helmet>
        <title>Setup — VirtAI</title>
      </Helmet>

      <CircuitBoardBackground />

      <motion.div
        className="setup-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* Step indicator */}
        <div className="setup-step-indicator">
          <span className="step-text">
            Step <span>{activeTab + 1}</span> of {TABS.length} — {TABS[activeTab].label}
          </span>
          <div className="step-dots">
            {TABS.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  'step-dot aspect-square rounded-full flex-shrink-0',
                  isTabComplete(idx) && 'completed',
                  activeTab === idx && 'active'
                )}
              />
            ))}
          </div>
        </div>

        {/* Main content split */}
        <div className="setup-content">
          {/* LEFT: Tabs + content + nav */}
          <div className="setup-left">
            {/* Tab bar */}
            <div className="setup-tab-bar" role="tablist">
              {TABS.map((tab, idx) => {
                const Icon = tab.icon;
                const complete = isTabComplete(idx);
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={activeTab === idx}
                    aria-controls={`panel-${tab.key}`}
                    className={`setup-tab${activeTab === idx ? ' active' : ''}`}
                    onClick={() => goTo(idx)}
                    style={{ position: 'relative' }}
                  >
                    {complete ? (
                      <span className="tab-check">
                        <FiCheck />
                      </span>
                    ) : (
                      <Icon size={16} />
                    )}
                    {tab.label}
                    {activeTab === idx && (
                      <motion.div
                        className="setup-tab-underline"
                        layoutId="tab-underline"
                        style={{ position: 'absolute', bottom: -2, left: 0, right: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content with AnimatePresence */}
            <div className="setup-tab-content">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={activeTab}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  style={{ height: '100%' }}
                  role="tabpanel"
                  id={`panel-${TABS[activeTab].key}`}
                >
                  {activeTab === 0 && (
                    <AvatarTab selected={selectedAvatar} onSelect={handleAvatarSelect} />
                  )}
                  {activeTab === 1 && (
                    <VoiceTab
                      selected={selectedVoice}
                      onSelect={setSelectedVoice}
                      avatarGender={selectedAvatar?.gender}
                      onPlay={playPreview}
                      onStop={stopAudio}
                      isPlaying={isPlaying}
                      playingVoiceId={playingVoiceId}
                    />
                  )}
                  {activeTab === 2 && (
                    <AllSetTab
                      avatar={selectedAvatar}
                      voice={selectedVoice}
                      movementEnabled={isMovementEnabled}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation */}
            <div className="setup-nav">
              <button className="setup-nav-btn" onClick={handleBack}>
                <FiChevronLeft size={16} />
                {activeTab === 0 ? 'Overview' : 'Back'}
              </button>

              {activeTab < TABS.length - 1 && (
                <button
                  className="setup-nav-btn primary"
                  onClick={handleNext}
                  disabled={!canAdvance}
                >
                  Next
                  <FiChevronRight size={16} />
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: Avatar preview */}
          <div className="setup-right">
            <AvatarPreview
              avatar={selectedAvatar}
              voice={selectedVoice}
              isPlaying={isPlaying && selectedVoice?.id === playingVoiceId}
              onPlayPreview={() => playPreview(selectedVoice)}
              onStopPreview={stopAudio}
              movementEnabled={isMovementEnabled}
              onMovementToggle={setIsMovementEnabled}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
