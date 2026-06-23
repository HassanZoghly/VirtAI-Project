import React from 'react';
import SlideDrawer from '@/shared/components/SlideDrawer';
import { useQuizSession } from '../hooks/useQuizSession';
import { QuizQuestionCard, QuizQuestionSkeleton } from './QuizQuestionCard';
import { getQuizTranslations, Locale } from '../i18n';
import './QuizDrawer.css';

interface QuizDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string | null;
  quizSession: ReturnType<typeof useQuizSession>;
  locale?: Locale;
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
        <div className="quiz-drawer-body finished-state">
          <div className="quiz-score-circle">
            <span className="quiz-score-number">{score}</span>
            <span className="quiz-score-total">/ {quizData.questions.length}</span>
          </div>
          <h2 className="quiz-score-title">
            {t.score.replace('{score}', score.toString()).replace('{total}', quizData.questions.length.toString())}
          </h2>
          <button className="btn-primary" onClick={handleClose}>
            Done
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <SlideDrawer
      title="Knowledge Check"
      description="Test your understanding"
      isOpen={isOpen}
      onClose={handleClose}
      contentClassName="quiz-drawer-content"
      zIndex={1000}
    >
      {renderContent()}
    </SlideDrawer>
  );
}
