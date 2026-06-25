export type Locale = 'en' | 'ar';

export const QUIZ_I18N = {
  en: {
    takeQuiz: "Start Quiz",
    noDocuments: "Please upload syllabus or reference materials before starting a knowledge check.",
    loading: "Synthesizing course materials and generating quiz questions...",
    whyIsThisWrong: "Why is this wrong?",
    correct: "Correct!",
    incorrect: "Incorrect",
    nextQuestion: "Proceed to Next Question",
    finishQuiz: "Complete Knowledge Check",
    score: "Assessment Complete: You answered {score} out of {total} questions correctly.",
  },
  ar: {
    takeQuiz: "ابدأ الاختبار",
    noDocuments: "قم برفع مستند أولاً لبدء الاختبار",
    loading: "جاري إنشاء الاختبار...",
    whyIsThisWrong: "لماذا هذه الإجابة خاطئة؟",
    correct: "صحيح!",
    incorrect: "غير صحيح",
    nextQuestion: "السؤال التالي",
    finishQuiz: "إنهاء الاختبار",
    score: "نتيجتك: {score}/{total}",
  }
};

export function getQuizTranslations(locale: Locale = 'en') {
  return QUIZ_I18N[locale] || QUIZ_I18N.en;
}
