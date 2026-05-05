import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore, selectIsAuthenticated } from '@/features/auth/store/authStore';
import { eventBus } from '../../../shared/hooks/useEventBus';
import { SESSION_TITLE_MAX_LENGTH } from '../constants';
import * as sessionService from '../services/sessionService';
import { consumeStartNewConversationFlag } from '../services/sessionStorage';
import {
  normalizeAndSortSessions,
  normalizeSession,
  resolveInitialSessionId,
  sortSessionsByRecency,
} from '../utils/sessionState';

export default function useSessionManager(urlSessionId, navigate) {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isAuthInitialized = useAuthStore((s) => s.isInitialized);

  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const isInitializingRef = useRef(false);
  const hasInitialized = useRef(false);

  const setActiveSessionId = useCallback((id) => {
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
  }, []);

  /**
   * Single Async Initialization
   */
  useEffect(() => {
    if (
      !isAuthInitialized ||
      !isAuthenticated ||
      hasInitialized.current ||
      isInitializingRef.current
    ) {
      return;
    }

    let isMounted = true;
    isInitializingRef.current = true;

    async function initializeSessions() {
      setStatus('loading');
      try {
        const shouldForceNew = consumeStartNewConversationFlag();
        const fetchedSessions = await sessionService.fetchSessions();
        const initialSessions = normalizeAndSortSessions(fetchedSessions);

        if (shouldForceNew || initialSessions.length === 0) {
          try {
            const newSession = await sessionService.createSession();
            const createdSession = normalizeSession({
              ...newSession,
              messages: [],
              messages_loaded: true,
            });

            if (!createdSession.id) {
              throw new Error('Created session is missing an id');
            }

            setSessions(shouldForceNew ? [createdSession, ...initialSessions] : [createdSession]);
            setActiveSessionId(createdSession.id);
            setStatus('success');

            if (navigate) {
              navigate(`/classroom/${createdSession.id}`, { replace: true });
            }
          } catch (createError) {
            console.error('Failed to auto-create session, falling back to empty state:', createError);
            setSessions(initialSessions);
            const targetId = resolveInitialSessionId(initialSessions, urlSessionId);
            setActiveSessionId(targetId);
            setStatus('success');
          }
          return;
        }

        const targetId = resolveInitialSessionId(initialSessions, urlSessionId);
        if (!targetId) {
          throw new Error('Failed to resolve initial session id');
        }

        setSessions(initialSessions);
        setActiveSessionId(targetId);
        setStatus('success');
        if (navigate && targetId && targetId !== urlSessionId) {
          navigate(`/classroom/${targetId}`, { replace: true });
        }
      } catch (error) {
        console.error('Session initialization failed:', error);
        setStatus('error');
      } finally {
        isInitializingRef.current = false;
        hasInitialized.current = true;
        setStatus((prev) => (prev === 'loading' ? 'success' : prev));
      }
    }

    initializeSessions();

    return () => {
      isMounted = false;
    };
  }, [isAuthInitialized, isAuthenticated, urlSessionId, setActiveSessionId, navigate]);

  /**
   * Fetch messages for the current session if they aren't loaded yet.
   */
  useEffect(() => {
    if (status !== 'success' || !currentSessionId) {
      return;
    }

    const session = sessions.find((s) => s.id === currentSessionId || s._id === currentSessionId);
    if (!session) {
      return;
    }

    const abortController = new AbortController();
    const targetId = currentSessionId;

    async function loadMessages() {
      setIsLoadingMessages(true);
      try {
        const fetchedMessages = await sessionService.fetchSessionMessages(targetId, {
          signal: abortController.signal,
        });

        if (!abortController.signal.aborted) {
          setSessions((prevSessions) =>
            prevSessions.map((sessionItem) =>
              sessionItem.id === targetId || sessionItem._id === targetId
                ? { ...sessionItem, messages: fetchedMessages, messages_loaded: true }
                : sessionItem
            )
          );
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('Failed to fetch messages:', error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    }

    if (!session.messages_loaded && (session.message_count || 0) > 0) {
      loadMessages();

      return () => {
        abortController.abort();
      };
    } else if (!session.messages_loaded) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId || s._id === currentSessionId
            ? { ...s, messages: s.messages || [], messages_loaded: true }
            : s
        )
      );
    }
  }, [currentSessionId, status, sessions]);

  const currentSession = useMemo(() => {
    const s =
      sessions.find((sessionItem) => sessionItem.id === currentSessionId) || sessions[0];
    if (!s) {return { id: null, title: '', messages: [], messages_loaded: true };}
    return { ...s, messages: s.messages || [], messages_loaded: s.messages_loaded || false };
  }, [sessions, currentSessionId]);

  const createNewSession = useCallback(async () => {
    if (status !== 'success') {return null;}

    const emptySession = sessions.find((s) => (s.message_count || 0) === 0);

    if (emptySession) {
      setActiveSessionId(emptySession.id);
      if (navigate) {navigate(`/classroom/${emptySession.id}`);}
      return emptySession.id;
    }

    try {
      const newSession = await sessionService.createSession();
      const sessionWithDefaults = normalizeSession({
        ...newSession,
        messages: [],
        messages_loaded: true,
      });
      if (!sessionWithDefaults.id) {return null;}

      setSessions((prev) => [sessionWithDefaults, ...prev]);
      setActiveSessionId(sessionWithDefaults.id);
      if (navigate) {navigate(`/classroom/${sessionWithDefaults.id}`);}
      return sessionWithDefaults.id;
    } catch (error) {
      console.error('Failed to create session:', error);
      return null;
    }
  }, [sessions, status, setActiveSessionId, navigate]);

  const switchSession = useCallback(
    (id) => {
      const previousId = currentSessionIdRef.current;
      setActiveSessionId(id);
      eventBus.emit('session:switched', { sessionId: id });
      if (navigate && id !== previousId) {
        navigate(`/classroom/${id}`);
      }
    },
    [setActiveSessionId, navigate]
  );

  const deleteSession = useCallback(
    async (sessionId) => {
      try {
        await sessionService.deleteSession(sessionId);
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== sessionId);
          if (remaining.length === 0) {
            if (navigate) {navigate('/classroom', { replace: true });}
            return [];
          }
          if (sessionId === currentSessionIdRef.current) {
            // Guarantee we pick the newest remaining session
            const sortedRemaining = sortSessionsByRecency(remaining);
            const nextId = sortedRemaining[0].id;
            setActiveSessionId(nextId);
            if (navigate) {
              navigate(`/classroom/${nextId}`, { replace: true });
            }
          }
          return remaining;
        });
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    },
    [setActiveSessionId, navigate]
  );

  const renameSession = useCallback((sessionId, newTitle) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)));
  }, []);

  const addUserMessage = useCallback((message, text) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionIdRef.current) {return s;}
        const existingMessages = s.messages || [];
        const isDuplicate = existingMessages.some((m) => m.id === message.id);
        if (isDuplicate) {return s;}

        return {
          ...s,
          messages: [...existingMessages, message],
          message_count: (s.message_count || 0) + 1,
          title:
            (s.message_count || 0) === 0
              ? text.slice(0, SESSION_TITLE_MAX_LENGTH) +
                (text.length > SESSION_TITLE_MAX_LENGTH ? '…' : '')
              : s.title,
        };
      })
    );
  }, []);

  const addAssistantMessage = useCallback((messageId, text) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionIdRef.current) {return s;}
        const existingMessages = s.messages || [];
        const isDuplicate = existingMessages.some((m) => m.id === messageId);
        if (isDuplicate) {return s;}

        return {
          ...s,
          messages: [
            ...existingMessages,
            { id: messageId, role: 'assistant', content: text, timestamp: Date.now() },
          ],
          message_count: (s.message_count || 0) + 1,
        };
      })
    );
  }, []);

  return {
    sessions,
    currentSessionId,
    currentSession,
    status,
    isLoadingMessages,
    createNewSession,
    switchSession,
    deleteSession,
    renameSession,
    addUserMessage,
    addAssistantMessage,
  };
}
