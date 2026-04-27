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
      const sessions = clampSessionCount([fresh, ...saved]);
      return { sessions, currentSessionId: fresh.id };
    }
    // Find the newest session by timestamp
    const latest = [...saved].sort((a, b) => {
      const aTime = a.messages?.[a.messages.length - 1]?.timestamp || a.createdAt || 0;
      const bTime = b.messages?.[b.messages.length - 1]?.timestamp || b.createdAt || 0;
      return bTime - aTime;
    })[0];
    return { sessions: saved, currentSessionId: latest.id };
  }

  const fresh = createSession();
  return { sessions: [fresh], currentSessionId: fresh.id };
}

export default function useSessionManager() {
  const initialState = useMemo(() => initializeSessionState(), []);
  const [sessions, setSessions] = useState(() => initialState.sessions);
  const [currentSessionId, setCurrentSessionId] = useState(() => initialState.currentSessionId);

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
      return clampSessionCount([s, ...prev]);
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

      if (remaining.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return clampSessionCount([fresh]);
      }
      
      if (deletedActive) {
        const latest = [...remaining].sort((a, b) => {
          const aTime = a.messages?.[a.messages.length - 1]?.timestamp || a.createdAt || 0;
          const bTime = b.messages?.[b.messages.length - 1]?.timestamp || b.createdAt || 0;
          return bTime - aTime;
        })[0];
        setActiveSessionId(latest.id);
      }

      return remaining;
    });
  }, [setActiveSessionId]);

  const renameSession = useCallback((sessionId, newTitle) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
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
    createNewSession,
    startNewConversation,
    switchSession,
    deleteSession,
    renameSession,
    addUserMessage,
    addAssistantMessage,
  };
}
