import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { FiCheck, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { HiOutlineSparkles, HiOutlineSpeakerWave, HiOutlineUser } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';

import '@/pages/Setup/Setup.css';
import { cn } from '@/shared/utils/cn';
import CircuitBoardBackground from '@/widgets/Overview/CircuitBoardBackground';
import AllSetTab from './AllSetTab';
import AvatarPreview from './AvatarPreview';
import AvatarTab from './AvatarTab';
import VoiceTab from './VoiceTab';
import { loadSetup } from '../services/setupStorage';
import { avatarImages } from '@/features/avatar/data/avatars';
import { voices as VOICES } from '../data/voices';

const TABS = [
  { key: 'avatar', label: 'Avatar', icon: HiOutlineUser },
  { key: 'voice', label: 'Voice', icon: HiOutlineSpeakerWave },
  { key: 'allset', label: 'All Set', icon: HiOutlineSparkles },
];

export default function SetupPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState(null);

  useEffect(() => {
    const saved = loadSetup();
    if (saved) {
      const AVATARS = Object.values(avatarImages);
      if (saved.avatarId && AVATARS) {
        const a = AVATARS.find((av) => av.id === saved.avatarId);
        if (a) {
          setSelectedAvatar(a);
        }
      }
      if (saved.voiceId && VOICES) {
        const v = VOICES.find((vo) => vo.id === saved.voiceId);
        if (v) {
          setSelectedVoice(v);
        }
      }
    }
  }, []);

  // Clear voice selection when avatar gender changes
  const handleAvatarSelect = useCallback(
    (avatar) => {
      if (selectedAvatar && avatar.gender !== selectedAvatar.gender) {
        setSelectedVoice(null);
      }
      setSelectedAvatar(avatar);
    },
    [selectedAvatar]
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [direction, setDirection] = useState(1);
  const audioRef = useRef(null);
  const tabRefs = useRef([]);

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

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  const playPreview = useCallback(
    (url) => {
      stopAudio();
      if (!url) {
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener('ended', () => setIsPlaying(false));
      audio.addEventListener('error', () => setIsPlaying(false));
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    },
    [stopAudio]
  );

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
                  'step-dot',
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
                    ref={(el) => (tabRefs.current[idx] = el)}
                    role="tab"
                    aria-selected={activeTab === idx}
                    aria-controls={`panel-${tab.key}`}
                    className={`setup-tab${activeTab === idx ? ' active' : ''}`}
                    onClick={() => goTo(idx)}
                  >
                    {complete ? (
                      <span className="tab-check">
                        <FiCheck />
                      </span>
                    ) : (
                      <Icon size={16} />
                    )}
                    {tab.label}
                  </button>
                );
              })}

              {/* Sliding underline */}
              {tabRefs.current[activeTab] && (
                <motion.div
                  className="setup-tab-underline"
                  layoutId="tab-underline"
                  style={{
                    left: tabRefs.current[activeTab]?.offsetLeft ?? 0,
                    width: tabRefs.current[activeTab]?.offsetWidth ?? 0,
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
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
                    />
                  )}
                  {activeTab === 2 && <AllSetTab avatar={selectedAvatar} voice={selectedVoice} />}
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
              isPlaying={isPlaying}
              onPlayPreview={playPreview}
              onStopPreview={stopAudio}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
