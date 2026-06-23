import React, { useState } from 'react';
import { FiSend, FiPlay } from 'react-icons/fi';
import './SlideQuestionInput.css';

interface SlideQuestionInputProps {
  onQuestion: (text: string) => void;
  onContinue: () => void;
}

export function SlideQuestionInput({ onQuestion, onContinue }: SlideQuestionInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onQuestion(text.trim());
      setText('');
    }
  };

  return (
    <div className="slide-question-container">
      <div className="slide-question-prompt">
        <p>Any questions about this slide, or should we continue?</p>
      </div>
      <form className="slide-question-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="slide-question-input"
          placeholder="Ask a question..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="slide-question-submit"
          disabled={!text.trim()}
          title="Send Question"
        >
          <FiSend />
        </button>
      </form>
      <div className="slide-question-actions">
        <span className="slide-question-or">or</span>
        <button
          type="button"
          className="slide-continue-btn"
          onClick={onContinue}
        >
          <FiPlay /> Continue to next slide
        </button>
      </div>
    </div>
  );
}
