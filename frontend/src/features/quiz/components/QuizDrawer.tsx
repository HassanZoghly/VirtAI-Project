import React, { useState, useEffect } from 'react';
import SlideDrawer from '@/shared/components/SlideDrawer';
import { useQuizSession } from '../hooks/useQuizSession';
import { QuizQuestionCard, QuizQuestionSkeleton } from './QuizQuestionCard';
import { getQuizTranslations, Locale } from '../i18n';
import { motion } from 'framer-motion';
import './QuizDrawer.css';

interface QuizDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string | null;
  quizSession: ReturnType<typeof useQuizSession>;
  locale?: Locale;
}

function ConfettiEffect() {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; color: string; delay: number; scale: number; angle: number }>>([]);

  useEffect(() => {
    const colors = ['#B4AB8B', '#C9C0A0', '#9B0827', '#FF1744', '#ffffff'];
    const newParticles = Array.from({ length: 45 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100, // horizontal start position percentage
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 1.2, // staggered delay
      scale: Math.random() * 0.7 + 0.3,
      angle: Math.random() * 360,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
      {particles.map((p) => (
        <span
          key={p.id}
          className="animate-confetti-fall"
          style={{
            left: `${p.x}%`,
            top: `-20px`,
            backgroundColor: p.color,
            transform: `scale(${p.scale}) rotate(${p.angle}deg)`,
            animationDelay: `${p.delay}s`,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

export function QuizDrawer({ isOpen, onClose, documentId, quizSession, locale = 'en' }: QuizDrawerProps) {
  const t = getQuizTranslations(locale);
  const { quizState, quizData, currentIndex, score, answers, submitAnswer, nextQuestion, resetQuiz } = quizSession;

  const handleClose = () => {
    onClose();
    if (quizState === 'finished') {
      resetQuiz();
    }
  };

  const renderContent = () => {
    if (quizState === 'generating') {
      return (
        <div className="quiz-drawer-body">
          <div className="quiz-loading-header">
            <div className="spinner"></div>
            <p>{t.loading}</p>
          </div>
          <QuizQuestionSkeleton />
        </div>
      );
    }

    if (quizState === 'active' && quizData) {
      const question = quizData.questions[currentIndex];
      const hasAnswered = answers[question.id] !== undefined;

      return (
        <div className="quiz-drawer-body">
          <div className="quiz-progress">
            Question {currentIndex + 1} of {quizData.questions.length}
          </div>
          
          <QuizQuestionCard
            question={question}
            documentId={quizData.document_id}
            selectedOptionIndex={answers[question.id]}
            onSelectOption={(idx) => submitAnswer(question.id, idx)}
            locale={locale}
          />

          {hasAnswered && (
            <div className="quiz-actions">
              <button className="btn-primary quiz-next-btn" onClick={nextQuestion}>
                {currentIndex < quizData.questions.length - 1 ? t.nextQuestion : t.finishQuiz}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (quizState === 'finished' && quizData) {
      return (
        <div className="quiz-drawer-body finished-state relative">
          <ConfettiEffect />
          
          <motion.div 
            className="quiz-score-circle"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 100, delay: 0.15 }}
          >
            <span className="quiz-score-number">{score}</span>
            <span className="quiz-score-total">/ {quizData.questions.length}</span>
          </motion.div>
          
          <motion.h2 
            className="quiz-score-title"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
          >
            {t.score.replace('{score}', score.toString()).replace('{total}', quizData.questions.length.toString())}
          </motion.h2>
          
          <motion.button 
            className="btn-primary" 
            onClick={handleClose}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
          >
            Close Assessment
          </motion.button>
        </div>
      );
    }

    return null;
  };

  return (
    <SlideDrawer
      title="Knowledge Check"
      description="Evaluate comprehension of classroom materials"
      isOpen={isOpen}
      onClose={handleClose}
      contentClassName="quiz-drawer-content"
      zIndex={1000}
    >
      {renderContent()}
    </SlideDrawer>
  );
}
