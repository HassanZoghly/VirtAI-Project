import React from 'react';
import { FiShare2 } from 'react-icons/fi';
import './DiagramButton.css';

interface DiagramButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function DiagramButton({ onClick, disabled }: DiagramButtonProps) {
  return (
    <button
      className="classroom-action-btn"
      data-variant="diagram"
      onClick={onClick}
      disabled={disabled}
      aria-label="Generate Diagram"
      title={disabled ? "Upload a document first to generate a diagram" : "Generate Diagram"}
    >
      <FiShare2 />
      <span>Diagram</span>
    </button>
  );
}
