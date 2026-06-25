export type Locale = 'en' | 'ar';

export const VISUALIZATION_I18N = {
  en: {
    visualize: "Visualize",
    generating: "Generating...",
    quota_exceeded: "Visualization quota exceeded. Please try again later.",
    timeout: "Visualization service timed out. Please try again.",
    not_configured: "Visualization service is not configured.",
    unknown_error: "An unknown error occurred while visualizing.",
  },
  ar: {
    visualize: "تصوير مرئي",
    generating: "جاري الإنشاء...",
    quota_exceeded: "تم تجاوز حصة التصوير المرئي. يرجى المحاولة مرة أخرى لاحقًا.",
    timeout: "انتهت مهلة خدمة التصوير المرئي. يرجى المحاولة مرة أخرى.",
    not_configured: "خدمة التصوير المرئي غير مهيأة.",
    unknown_error: "حدث خطأ غير معروف أثناء التصوير المرئي.",
  }
};

export function getVisualizationTranslations(locale: Locale = 'en') {
  return VISUALIZATION_I18N[locale] || VISUALIZATION_I18N.en;
}
