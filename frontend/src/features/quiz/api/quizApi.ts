import apiClient from '@/core/api/apiClient';

export interface QuizQuestion {
  id: string;
  question_text: string;
  options: string[];
  correct_option_index: number;
  explanation: string;
  citations: string[];
}

export interface QuizData {
  id: string;
  document_id: string;
  created_at: string | null;
  questions: QuizQuestion[];
}

export const generateQuiz = async (documentId: string, numQuestions: number = 5, locale: string = 'en'): Promise<string> => {
  const response = await apiClient.post<{ quiz_id: string }>(`/v1/rag/quiz/${documentId}?num_questions=${numQuestions}&locale=${locale}`);
  return response.data.quiz_id;
};

export const getQuiz = async (quizId: string): Promise<QuizData> => {
  const response = await apiClient.get<QuizData>(`/v1/rag/quiz/${quizId}`);
  return response.data;
};
