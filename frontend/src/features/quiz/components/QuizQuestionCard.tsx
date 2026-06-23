import React, { useState, Suspense, lazy } from 'react';
import { QuizQuestion } from '../api/quizApi';
import { getQuizTranslations, Locale } from '../i18n';
import './QuizQuestionCard.css';

const PdfPageViewer = lazy(() => import('./PdfPageViewer'));

interface QuizQuestionCardProps {
  question: QuizQuestion;
  documentId: string;
  selectedOptionIndex?: number;
  onSelectOption: (index: number) => void;
  locale?: Locale;
}

export function QuizQuestionCard({
  question,
  documentId,
  selectedOptionIndex,
  onSelectOption,
  locale = 'en'
}: QuizQuestionCardProps) {
  const t = getQuizTranslations(locale);
  const [showExplanation, setShowExplanation] = useState(false);

  const hasAnswered = selectedOptionIndex !== undefined;
  const isCorrect = hasAnswered && selectedOptionIndex === question.correct_option_index;

  const handleToggleExplanation = () => setShowExplanation(!showExplanation);

  return (
    <div className="quiz-question-card">
      <h3 className="quiz-question-text">{question.question_text}</h3>
      <div className="quiz-options">
        {question.options.map((opt, idx) => {
          let className = 'quiz-option-btn';
          if (hasAnswered) {
            if (idx === question.correct_option_index) {
              className += ' correct';
            } else if (idx === selectedOptionIndex) {
              className += ' incorrect';
            } else {
              className += ' disabled';
            }
          }

          return (
            <button
              key={idx}
              className={className}
              onClick={() => !hasAnswered && onSelectOption(idx)}
              disabled={hasAnswered}
            >
              <span className="quiz-option-label">{String.fromCharCode(65 + idx)}</span>
              <span className="quiz-option-text">{opt}</span>
            </button>
          );
        })}
      </div>

      {hasAnswered && (
        <div className="quiz-feedback">
          <div className={`quiz-feedback-banner ${isCorrect ? 'correct' : 'incorrect'}`}>
            {isCorrect ? t.correct : t.incorrect}
          </div>
          
          <button className="quiz-why-btn" onClick={handleToggleExplanation}>
            {t.whyIsThisWrong} {showExplanation ? '▲' : '▼'}
          </button>

          {showExplanation && (
            <div className="quiz-explanation-box">
              <p className="quiz-explanation-text">{question.explanation}</p>
              {question.citations && question.citations.length > 0 && (
                <Suspense fallback={<div className="pdf-viewer-skeleton">Loading document viewer...</div>}>
                  <PdfPageViewer documentId={documentId} citations={question.citations} />
                </Suspense>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QuizQuestionSkeleton() {
  return (
    <div className="quiz-question-card skeleton">
      <div className="skeleton-title"></div>
      <div className="quiz-options">
        <div className="skeleton-option"></div>
        <div className="skeleton-option"></div>
        <div className="skeleton-option"></div>
        <div className="skeleton-option"></div>
      </div>
    </div>
  );
}
