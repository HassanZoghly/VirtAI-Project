import React, { useState, useCallback, useRef } from 'react';
import { FiImage, FiLoader } from 'react-icons/fi';
import { getVisualization } from '../api/visualizationApi';
import { getVisualizationTranslations, Locale } from '../i18n/visualizationI18n';
import { toast } from '@/shared/utils/toast';
import './VisualizeButton.css';

interface VisualizeButtonProps {
  messageId: string;
  locale?: Locale;
}

export function VisualizeButton({ messageId, locale = 'en' }: VisualizeButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isHidden, setIsHidden] = useState(false);
  const lastRequestTime = useRef<number>(0);

  const t = getVisualizationTranslations(locale);

  const handleVisualize = useCallback(async () => {
    // Client-side debounce of at least 5 seconds
    const now = Date.now();
    if (now - lastRequestTime.current < 5000) {
      toast.warning('Please Wait', 'Please wait a few seconds before requesting another visualization.');
      return;
    }
    
    lastRequestTime.current = now;
    setIsLoading(true);

    try {
      const response = await getVisualization(messageId);
      
      if (response.unavailable) {
        if (response.reason === 'not_configured') {
          setIsHidden(true);
        } else if (response.reason === 'quota_exceeded') {
          toast.error('Visualization Failed', t.quota_exceeded);
        } else if (response.reason === 'timeout') {
          toast.error('Visualization Failed', t.timeout);
        } else {
          toast.error('Visualization Failed', t.unknown_error);
        }
      } else if (response.image_url) {
        setImageUrl(response.image_url);
      }
    } catch (err) {
      console.error(err);
      toast.error('Error', t.unknown_error);
    } finally {
      setIsLoading(false);
    }
  }, [messageId, t]);

  if (isHidden) return null;

  if (imageUrl) {
    return (
      <div className="visualize-result mt-2">
        <img src={imageUrl} alt="Message Visualization" className="visualize-image rounded-md border border-white/10 max-w-full" />
      </div>
    );
  }

  return (
    <button
      className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-all duration-200 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={handleVisualize}
      disabled={isLoading}
      title={t.visualize}
      aria-label={t.visualize}
    >
      {isLoading ? <FiLoader className="animate-spin" size={14} /> : <FiImage size={14} />}
      <span>{isLoading ? t.generating : t.visualize}</span>
    </button>
  );
}
