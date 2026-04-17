import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../../../shared/hooks/useEventBus';
import { SESSION_TITLE_MAX_LENGTH, MAX_SESSIONS } from '../constants';
import {
  consumeStartNewConversationFlag,
  loadFromStorage,
  saveToStorage,
} from '../services/sessionStorage';

function createSession(title = 'New chat') {
  return { id: crypto.randomUUID(), title, messages: [], createdAt: Date.now() };
}

function clampSessionCount(items) {
  if (items.length > MAX_SESSIONS) {
    return items.slice(items.length - MAX_SESSIONS);
  }
  return items;
}

function initializeSessionState() {
  const saved = loadFromStorage();
  const shouldStartFresh = consumeStartNewConversationFlag();

  if (saved && saved.length > 0) {
    if (shouldStartFresh) {
      const fresh = createSession();
      const sessions = clampSessionCount([...saved, fresh]);
      return { sessions, currentSessionId: fresh.id };
    }
    return { sessions: saved, currentSessionId: saved[0].id };
  }

  const fresh = createSession();
  return { sessions: [fresh], currentSessionId: fresh.id };
}

export default function useSessionManager() {
  const initialState = useMemo(() => initializeSessionState(), []);
  const [sessions, setSessions] = useState(() => initialState.sessions);
  const [currentSessionId, setCurrentSessionId] = useState(() => initialState.currentSessionId);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState(null);

  // Stable ref so addUserMessage / addAssistantMessage never change identity
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const setActiveSessionId = useCallback((id) => {
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
  }, []);

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
      return clampSessionCount([...prev, s]);
    });
    setActiveSessionId(s.id);
  }, [setActiveSessionId]);

  const startNewConversation = useCallback(() => {
    createNewSession();
  }, [createNewSession]);

  const switchSession = useCallback((id) => {
    setActiveSessionId(id);
    eventBus.emit('session:switched', { sessionId: id });
  }, [setActiveSessionId]);

  const deleteSession = useCallback((sessionId) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      const deletedActive = sessionId === currentSessionIdRef.current;

      if (remaining.length === 0 || deletedActive) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return clampSessionCount([...remaining, fresh]);
      }

      return remaining;
    });
  }, [setActiveSessionId]);

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
              messages: s.messages.some((m) => m.id === message.id)
                ? s.messages
                : [...s.messages, message],
              title:
                s.messages.length === 0 && !s.messages.some((m) => m.id === message.id)
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
              messages: s.messages.some((m) => m.id === messageId)
                ? s.messages
                : [...s.messages, { id: messageId, role: 'assistant', content: text, timestamp: Date.now() }],
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
    startNewConversation,
    switchSession,
    deleteSession,
    openRenameModal,
    handleRenameConfirm,
    handleRenameCancel,
    addUserMessage,
    addAssistantMessage,
  };
}
