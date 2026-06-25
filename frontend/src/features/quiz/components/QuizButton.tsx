import React from 'react';
import { FiEdit3 } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { getQuizTranslations, Locale } from '../i18n';
import './QuizButton.css';

interface QuizButtonProps {
  disabled?: boolean;
  locale?: Locale;
}

export function QuizButton({ disabled, locale = 'en' }: QuizButtonProps) {
  const t = getQuizTranslations(locale);
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="classroom-action-btn"
      data-variant="quiz"
      onClick={disabled ? undefined : () => navigate('/quiz')}
      disabled={disabled}
      aria-label={t.takeQuiz}
      title={disabled ? t.noDocuments : t.takeQuiz}
    >
      <FiEdit3 />
      <span>{t.takeQuiz}</span>
    </button>
  );
}
