export type Locale = 'en' | 'ar';

export const QUIZ_I18N = {
  en: {
    takeQuiz: "Take Quiz",
    noDocuments: "Upload a document first to take a quiz",
    loading: "Generating your quiz...",
    whyIsThisWrong: "Why is this wrong?",
    correct: "Correct!",
    incorrect: "Incorrect",
    nextQuestion: "Next Question",
    finishQuiz: "Finish Quiz",
    score: "Your Score: {score}/{total}",
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
