import { useState, useCallback } from 'react';
import { generateQuiz, getQuiz, QuizData } from '../api/quizApi';
import { Locale } from '../i18n';
import { toast } from '@/shared/utils/toast';

export type QuizState = 'idle' | 'generating' | 'active' | 'finished';

export function useQuizSession() {
  const [quizState, setQuizState] = useState<QuizState>('idle');
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const startQuiz = useCallback(async (documentId: string, locale: Locale = 'en') => {
    setQuizState('generating');
    setQuizData(null);
    setCurrentIndex(0);
    setScore(0);
    setAnswers({});

    try {
      const quizId = await generateQuiz(documentId, 5, locale);
      const data = await getQuiz(quizId);
      setQuizData(data);
      setQuizState('active');
    } catch (error) {
      setQuizState('idle');
      toast.error('Quiz Error', 'Failed to generate the quiz. Please try again.');
    }
  }, []);

  const submitAnswer = useCallback((questionId: string, selectedOptionIndex: number) => {
    if (!quizData) return;
    const question = quizData.questions.find(q => q.id === questionId);
    if (!question) return;

    setAnswers(prev => ({ ...prev, [questionId]: selectedOptionIndex }));
    
    if (question.correct_option_index === selectedOptionIndex) {
      setScore(prev => prev + 1);
    }
  }, [quizData]);

  const nextQuestion = useCallback(() => {
    if (!quizData) return;
    if (currentIndex < quizData.questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setQuizState('finished');
    }
  }, [currentIndex, quizData]);

  const resetQuiz = useCallback(() => {
    setQuizState('idle');
    setQuizData(null);
    setCurrentIndex(0);
    setScore(0);
    setAnswers({});
  }, []);

  return {
    quizState,
    quizData,
    currentIndex,
    score,
    answers,
    startQuiz,
    submitAnswer,
    nextQuestion,
    resetQuiz
  };
}
