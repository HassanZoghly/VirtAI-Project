import React from 'react';
import { FiEdit3 } from 'react-icons/fi';
import { getQuizTranslations, Locale } from '../i18n';
import './QuizButton.css';

interface QuizButtonProps {
  onClick: () => void;
  disabled?: boolean;
  locale?: Locale;
}

export function QuizButton({ onClick, disabled, locale = 'en' }: QuizButtonProps) {
  const t = getQuizTranslations(locale);

  return (
    <div className="quiz-btn-wrapper" title={disabled ? t.noDocuments : t.takeQuiz}>
      <button
        className="quiz-action-btn"
        onClick={onClick}
        disabled={disabled}
        aria-label={t.takeQuiz}
      >
        <FiEdit3 />
        <span className="quiz-btn-text">{t.takeQuiz}</span>
      </button>
    </div>
  );
}
