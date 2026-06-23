import React from 'react';
import { FiShare2 } from 'react-icons/fi';
import './DiagramButton.css';

interface DiagramButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function DiagramButton({ onClick, disabled }: DiagramButtonProps) {
  return (
    <div className="diagram-btn-wrapper" title={disabled ? "Upload a document first to generate a diagram" : "Generate Diagram"}>
      <button
        className="diagram-action-btn"
        onClick={onClick}
        disabled={disabled}
        aria-label="Generate Diagram"
      >
        <FiShare2 />
        <span className="diagram-btn-text">Diagram</span>
      </button>
    </div>
  );
}
