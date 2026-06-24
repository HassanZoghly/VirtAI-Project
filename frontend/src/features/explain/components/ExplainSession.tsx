import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FiStopCircle, FiPauseCircle } from 'react-icons/fi';
import { PresentationState } from '../hooks/useExplainWS';
import { SlideQuestionInput } from './SlideQuestionInput';
import './ExplainSession.css';

interface ExplainSessionProps {
  documentId: string;
  currentState: PresentationState;
  currentSlide: number;
  totalSlides: number;
  content: string;
  onQuestion: (text: string) => void;
  onContinue: () => void;
  onPauseOrStop: () => void;
  onClose: () => void;
}

export function ExplainSession({
  documentId,
  currentState,
  currentSlide,
  totalSlides,
  content,
  onQuestion,
  onContinue,
  onPauseOrStop,
  onClose
}: ExplainSessionProps) {
  // Auto-scroll to bottom of content
  const contentRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div className="explain-session-container">
      <div className="explain-header">
        <div className="explain-title">
          <div><span className="explain-pill-badge">Presentation Mode</span></div>
          <h2 className="explain-progress">
            Slide {currentSlide + 1} {totalSlides > 0 ? `of ${totalSlides}` : ''}
          </h2>
        </div>
        <div className="explain-header-actions">
          <button className="explain-ghost-btn" onClick={onClose} title="Stop Presentation">
            <FiStopCircle size={20} /> Stop
          </button>
        </div>
      </div>
      
      <div className="explain-progress-bar-container">
        <div 
          className="explain-progress-bar" 
          style={{ width: totalSlides > 0 ? `${((currentSlide + 1) / totalSlides) * 100}%` : '0%' }} 
        />
      </div>

      <div className="explain-content" ref={contentRef}>
        <div className="explain-content-wrapper">
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "Loading slide content..."}
            </ReactMarkdown>
            {currentState === 'EXPLAINING' && <span className="streaming-cursor">▊</span>}
          </div>
        </div>
      </div>

      <div className="explain-controls">
        <div className="explain-status-indicator">
          <span className={`status-dot ${currentState.toLowerCase()}`}></span>
          {currentState === 'EXPLAINING' && 'Explaining slide...'}
          {currentState === 'AWAITING' && 'Waiting for your input...'}
          {currentState === 'ANSWERING' && 'Answering question...'}
        </div>

        {currentState === 'AWAITING' ? (
          <SlideQuestionInput onQuestion={onQuestion} onContinue={onContinue} />
        ) : (
          <div className="explain-active-controls">
            <button className="explain-ghost-btn" onClick={onPauseOrStop} title="Pause / Interrupt">
              <FiPauseCircle size={20} /> Pause / Interrupt
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
