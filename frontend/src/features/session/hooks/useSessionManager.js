import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../../../shared/hooks/useEventBus';
import { SESSION_TITLE_MAX_LENGTH, MAX_SESSIONS } from '../constants';
import { loadFromStorage, saveToStorage } from '../services/sessionStorage';

function createSession(title = 'New chat') {
  return { id: crypto.randomUUID(), title, messages: [], createdAt: Date.now() };
}

export default function useSessionManager() {
  const [sessions, setSessions] = useState(() => {
    const saved = loadFromStorage();
    if (saved && saved.length > 0) return saved;
    return [createSession()];
  });

  const [currentSessionId, setCurrentSessionId] = useState(() => sessions[0].id);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState(null);

  // Stable ref so addUserMessage / addAssistantMessage never change identity
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  // Debounced save — persist sessions to localStorage on every change
  const saveTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToStorage(sessions), 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [sessions]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || sessions[0],
    [sessions, currentSessionId]
  );

  const createNewSession = useCallback(() => {
    const s = createSession();
    setSessions((prev) => {
      const next = [...prev, s];
      // Prune oldest sessions beyond limit
      if (next.length > MAX_SESSIONS) {
        return next.slice(next.length - MAX_SESSIONS);
      }
      return next;
    });
    setCurrentSessionId(s.id);
  }, []);

  const switchSession = useCallback((id) => {
    setCurrentSessionId(id);
    eventBus.emit('session:switched', { sessionId: id });
  }, []);

  const deleteSession = useCallback((sessionId) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        return [createSession()];
      }
      if (sessionId === currentSessionIdRef.current) {
        setCurrentSessionId(next[0].id);
      }
      return next;
    });
  }, []);

  const openRenameModal = useCallback(
    (sessionId) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        setSessionToRename(session);
        setIsRenameModalOpen(true);
      }
    },
    [sessions]
  );

  const handleRenameConfirm = useCallback(
    (newTitle) => {
      if (sessionToRename) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionToRename.id ? { ...s, title: newTitle } : s))
        );
        setIsRenameModalOpen(false);
        setSessionToRename(null);
      }
    },
    [sessionToRename]
  );

  const handleRenameCancel = useCallback(() => {
    setIsRenameModalOpen(false);
    setSessionToRename(null);
  }, []);

  /** Append a user message to the active session (also auto-titles if first message). */
  const addUserMessage = useCallback((message, text) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionIdRef.current
          ? {
              ...s,
              messages: [...s.messages, message],
              title:
                s.messages.length === 0
                  ? text.slice(0, SESSION_TITLE_MAX_LENGTH) +
                    (text.length > SESSION_TITLE_MAX_LENGTH ? '…' : '')
                  : s.title,
            }
          : s
      )
    );
  }, []);

  /** Append an assistant message to the active session. */
  const addAssistantMessage = useCallback((messageId, text) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionIdRef.current
          ? {
              ...s,
              messages: [
                ...s.messages,
                { id: messageId, role: 'assistant', content: text, timestamp: Date.now() },
              ],
            }
          : s
      )
    );
  }, []);

  return {
    sessions,
    currentSessionId,
    currentSession,
    isRenameModalOpen,
    sessionToRename,
    createNewSession,
    switchSession,
    deleteSession,
    openRenameModal,
    handleRenameConfirm,
    handleRenameCancel,
    addUserMessage,
    addAssistantMessage,
  };
}
