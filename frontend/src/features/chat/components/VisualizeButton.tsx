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

  return (
    <div className="visualize-container">
      {imageUrl ? (
        <div className="visualize-result">
          <img src={imageUrl} alt="Message Visualization" className="visualize-image" />
        </div>
      ) : (
        <button
          className="visualize-btn"
          onClick={handleVisualize}
          disabled={isLoading}
          title={t.visualize}
          aria-label={t.visualize}
        >
          {isLoading ? <FiLoader className="visualize-spinner" /> : <FiImage />}
          <span className="visualize-text">{isLoading ? t.generating : t.visualize}</span>
        </button>
      )}
    </div>
  );
}
