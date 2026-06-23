import React from 'react';
import { FiMonitor } from 'react-icons/fi';
import './ExplainButton.css';

interface ExplainButtonProps {
  onClick: () => void;
  isVisible: boolean;
}

export function ExplainButton({ onClick, isVisible }: ExplainButtonProps) {
  if (!isVisible) return null;

  return (
    <div className="explain-btn-wrapper" title="Start slide-by-slide presentation">
      <button
        className="explain-action-btn"
        onClick={onClick}
        aria-label="Start Presentation"
      >
        <FiMonitor />
        <span className="explain-btn-text">Explain</span>
      </button>
    </div>
  );
}
