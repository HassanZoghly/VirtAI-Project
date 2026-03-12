import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Modal dialog for renaming a chat session.
 * @param {object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {string} props.sessionTitle - Current session title (pre-fills input)
 * @param {(newTitle: string) => void} props.onConfirm - Confirm callback with trimmed title
 * @param {() => void} props.onCancel - Cancel/close callback
 */
export default function RenameModal({ isOpen, sessionTitle, onConfirm, onCancel }) {
  const [inputValue, setInputValue] = useState(sessionTitle || '');
  const modalRef = useRef(null);

  useEffect(() => {
    setInputValue(sessionTitle || '');
  }, [sessionTitle]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  // Focus trap
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') {
      return;
    }
    const modal = modalRef.current;
    if (!modal) {
      return;
    }
    const focusable = modal.querySelectorAll(
      'input, button, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onConfirm(inputValue.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-modal-title"
        ref={modalRef}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id="rename-modal-title">Rename chat</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="modal-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter new chat name"
            aria-label="New chat name"
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="modal-btn cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-btn confirm">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
