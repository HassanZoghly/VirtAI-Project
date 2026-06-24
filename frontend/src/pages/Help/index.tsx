import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FeatureCard, Feature } from './FeatureCard';
import { FiChevronLeft, FiChevronRight, FiArrowLeft } from 'react-icons/fi';
import styles from './Help.module.css';

const features: Feature[] = [
  { id: 'chat', title: 'Chat with your tutor', videoSrc: '/help/chat.mp4', desc: 'Realtime voice and text chat with VirtAI.' },
  { id: 'explain', title: 'Presentation Mode', videoSrc: '/help/explain.mp4', desc: 'Slide-by-slide explanation of your document.' },
  { id: 'diagram', title: 'Generate Diagrams', videoSrc: '/help/diagram.mp4', desc: 'Generate mermaid diagrams from your context.' },
  { id: 'quiz', title: 'Take a Quiz', videoSrc: '/help/quiz.mp4', desc: 'Test your knowledge with auto-generated quizzes.' },
  { id: 'visualize', title: 'Visualize answers', videoSrc: '/help/visualize.mp4', desc: 'Generate images and visualizations inline.' },
  { id: 'setup', title: 'Avatar & System Setup', videoSrc: '/help/setup.mp4', desc: 'Configure your avatar and system preferences.' },
];

export default function HelpPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, features.length - 1));
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="classroom-shell" style={{ width: '100%', height: '100%', display: 'flex', backgroundColor: 'var(--bg-primary, #111111)', position: 'relative' }}>
      
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        
        <button 
          className={styles.backBtn}
          onClick={() => navigate('/classroom')}
          aria-label="Back to classroom"
        >
          <FiArrowLeft /> Back to classroom
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
          <div className={styles.helpContainer}>
            <div className={styles.helpHeader}>
              <h1 className={styles.helpTitle}>Features Tour</h1>
              <p className={styles.helpTagline}>Discover what you can do with VirtAI</p>
            </div>
            
            <div className={styles.contentRow}>
              <div className={styles.featureCardWrapper} key={currentStep}>
                <FeatureCard feature={features[currentStep]} />
              </div>
              
              <div className={styles.navControls}>
                <button 
                  className={styles.navBtn} 
                  onClick={handlePrev} 
                  disabled={currentStep === 0}
                  aria-label="Previous feature"
                >
                  <FiChevronLeft />
                </button>
                <button 
                  className={styles.navBtn} 
                  onClick={handleNext} 
                  disabled={currentStep === features.length - 1}
                  aria-label="Next feature"
                >
                  <FiChevronRight />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
