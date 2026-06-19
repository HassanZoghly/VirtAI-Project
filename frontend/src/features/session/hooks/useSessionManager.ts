import { selectIsAuthenticated, useAuthStore } from '@/features/auth/store/authStore';
import { toast } from '@/shared/utils/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as sessionService from '../services/sessionService';
import { IMessage, ISession } from '../types';
import {
  normalizeAndSortSessions
} from '../utils/sessionState';

export default function useSessionManager(urlSessionId?: string, navigate?: any) {
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [sessionMessages, setSessionMessages] = useState<Record<string, IMessage[]>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isAuthInitialized = useAuthStore((s) => s.isInitialized);

  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const isInitializingRef = useRef(false);
  const hasInitialized = useRef(false);

  /**
   * Mutex: prevents double-firing of handleFirstMessage when the user
   * rapid-clicks "Send" or hits Enter twice before the first API call resolves.
   */
  const isCreatingRef = useRef(false);

  const setActiveSessionId = useCallback((id: string | null) => {
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
  }, []);

  /**
   * Reset state on logout
   */
  useEffect(() => {
    if (!isAuthenticated && isAuthInitialized) {
      hasInitialized.current = false;
      isInitializingRef.current = false;
      setSessions([]);
      setSessionMessages({});
      setActiveSessionId(null);
    }
  }, [isAuthenticated, isAuthInitialized, setActiveSessionId]);

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

    isInitializingRef.current = true;

    async function initializeSessions() {
      setStatus('loading');
      try {
        const fetchedSessions = await sessionService.fetchSessions();
        const initialSessions = normalizeAndSortSessions(fetchedSessions);

        if (initialSessions.length === 0) {
          // No sessions from backend, stay in Draft state
          setSessions([]);
          setActiveSessionId(null);
          setStatus('success');
          return;
        }

        if (urlSessionId) {
          const match = initialSessions.find((s) => s.id === urlSessionId);
          if (match) {
            setSessions(initialSessions);
            setActiveSessionId(match.id);
            setStatus('success');
            return;
          }
        }

        // If no url session id or match, stay in Draft state on /classroom
        setSessions(initialSessions);
        if (urlSessionId) {
          // If we had a URL ID but no match, redirect to draft state
          if (navigate) {
            navigate('/classroom', { replace: true });
          }
        }
        setActiveSessionId(null);
        setStatus('success');

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
  }, [isAuthInitialized, isAuthenticated, urlSessionId, setActiveSessionId, navigate]);

  const fetchTriggeredRef = useRef<Set<string>>(new Set());
  const titleGenerationTriggeredRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /**
   * Fetch messages for the current session if they aren't loaded yet.
   */
  useEffect(() => {
    if (status !== 'success' || !currentSessionId) {
      return;
    }

    const session = sessionsRef.current.find((s) => s.id === currentSessionId);
    if (!session || session.messages_loaded) {
      return;
    }

    if (fetchTriggeredRef.current.has(currentSessionId)) {
      return;
    }

    const abortController = new AbortController();
    const targetId = currentSessionId;

    async function loadMessages() {
      setIsLoadingMessages(true);
      fetchTriggeredRef.current.add(targetId);
      try {
        const fetchedMessages = await sessionService.fetchSessionMessages(targetId, {
          signal: abortController.signal,
        });

        if (!abortController.signal.aborted) {
          setSessionMessages((prev) => ({ ...prev, [targetId]: fetchedMessages }));
          setSessions((prevSessions) =>
            prevSessions.map((sessionItem) =>
              sessionItem.id === targetId
                ? { ...sessionItem, messages_loaded: true }
                : sessionItem
            )
          );
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('Failed to fetch messages:', error);
          fetchTriggeredRef.current.delete(targetId);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadMessages();

    return () => {
      abortController.abort();
    };
  }, [currentSessionId, status]);

  const currentSession = useMemo(() => {
    if (!currentSessionId) {
      return { id: null, title: 'New chat', messages: [], messages_loaded: true };
    }
    const s = sessions.find((sessionItem) => sessionItem.id === currentSessionId);
    if (!s) {
      return { id: null, title: '', messages: [], messages_loaded: true };
    }
    return { ...s, messages: sessionMessages[currentSessionId] || [], messages_loaded: s.messages_loaded || false };
  }, [sessions, currentSessionId, sessionMessages]);

  const switchSession = useCallback(
    (id: string | null) => {
      const previousId = currentSessionIdRef.current;
      setActiveSessionId(id);

      if (navigate && id !== previousId) {
        if (id) {
          navigate(`/classroom/${id}`);
        } else {
          navigate(`/classroom`);
        }
      }
    },
    [setActiveSessionId, navigate]
  );

  const createNewSession = useCallback(async () => {
    switchSession(null);
    return null;
  }, [switchSession]);

  const createPersistedSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionIdRef.current) {
      return currentSessionIdRef.current;
    }
    if (isCreatingRef.current) {
      return null;
    }
    isCreatingRef.current = true;

    try {
      const newSession = await sessionService.createSession();
      const createdSession: ISession = {
        ...newSession,
        messages_loaded: true,
      };

      if (!createdSession.id) {
        throw new Error('Created session missing id');
      }

      setSessions((prev) => [createdSession, ...prev]);
      setSessionMessages((prev) => ({ ...prev, [createdSession.id]: [] }));
      setActiveSessionId(createdSession.id);

      if (navigate) {
        navigate(`/classroom/${createdSession.id}`, { replace: true });
      }

      return createdSession.id;
    } catch (error) {
      console.error('Failed to create persisted session', error);
      return null;
    } finally {
      isCreatingRef.current = false;
    }
  }, [navigate, setActiveSessionId]);

  const generateTitleForSession = useCallback((sessionId: string, text: string) => {
    if (!sessionId || !text.trim()) {
      return;
    }
    if (titleGenerationTriggeredRef.current.has(sessionId)) {
      return;
    }
    titleGenerationTriggeredRef.current.add(sessionId);

    sessionService.generateSmartTitle(sessionId, text).then((generatedTitle) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) {
            return s;
          }
          if (s.title !== 'New chat' && s.title !== 'New Chat') {
            return s;
          }
          return { ...s, title: generatedTitle };
        })
      );
    }).catch(() => {
      titleGenerationTriggeredRef.current.delete(sessionId);
    });
  }, []);

  /**
   * Explicitly handle the mutation sequence for the first message.
   * - Mutex guard: if a creation is already in-flight, immediately return null
   *   to prevent double-sends from rapid-clicks or double Enter key presses.
   * - Await createSession()
   * - Set active in state and URL
   * - Fire title generation in background (with stale-title guard)
   * - Return new ID so caller can dispatch message
   */
  const handleFirstMessage = useCallback(async (text: string): Promise<string | null> => {
    // --- Concurrency lock: prevent double-send ---
    if (isCreatingRef.current) {
      return null;
    }
    isCreatingRef.current = true;

    try {
      const newSession = await sessionService.createSession();
      const createdSession: ISession = {
        ...newSession,
        messages_loaded: true,
      };

      if (!createdSession.id) {
        throw new Error('Created session missing id');
      }

      setSessions((prev) => [createdSession, ...prev]);
      setSessionMessages((prev) => ({ ...prev, [createdSession.id]: [] }));
      setActiveSessionId(createdSession.id);

      if (navigate) {
        navigate(`/classroom/${createdSession.id}`, { replace: true });
      }

      // Fire title generation in the background asynchronously.
      // Race-condition guard: only apply the generated title if the session
      // title is still the server-assigned default "New chat". If the user
      // has manually renamed the session while the API was pending, we abort
      // the update to respect their explicit intent.
      generateTitleForSession(createdSession.id, text);

      return createdSession.id;
    } catch (e) {
      console.error('Failed to create session for first message', e);
      return null;
    } finally {
      // Always release the lock, even on error
      isCreatingRef.current = false;
    }
  }, [navigate, setActiveSessionId, generateTitleForSession]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const wasActive = sessionId === currentSessionIdRef.current;
      const snapshotSessions = sessionsRef.current;
      const snapshotMessages = { ...sessionMessages };

      // Optimistic delete
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSessionMessages((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });

      if (wasActive) {
        setActiveSessionId(null);
        if (navigate) {
          navigate('/classroom', { replace: true });
        }
      }

      try {
        await sessionService.deleteSession(sessionId);
      } catch (error) {
        // Rollback
        setSessions(snapshotSessions);
        setSessionMessages(snapshotMessages);
        if (wasActive) {
          setActiveSessionId(sessionId);
        }
        toast.error('Delete Failed', 'Failed to delete chat session');
        console.error('Failed to delete session:', error);
      }
    },
    [setActiveSessionId, navigate, sessionMessages]
  );

  const clearAllSessions = useCallback(async () => {
    try {
      await sessionService.deleteAllSessions();
      setSessionMessages({});
      setSessions([]);
      createNewSession();
    } catch (error) {
      console.error('Failed to clear all sessions:', error);
    }
  }, [createNewSession]);

  const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
    const previousTitle = sessionsRef.current.find((s) => s.id === sessionId)?.title;

    // Optimistic update
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)));

    try {
      await sessionService.renameSession(sessionId, newTitle);
    } catch (error) {
      // Rollback on error
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: previousTitle ?? s.title } : s))
      );
      toast.error('Rename Failed', 'Failed to rename chat session');
      console.error('Failed to rename session:', error);
    }
  }, []);

  const addUserMessage = useCallback((message: IMessage, explicitSessionId?: string) => {
    const id = explicitSessionId || currentSessionIdRef.current;
    if (!id) return;
    setSessionMessages((prev) => {
      const existingMessages = prev[id] || [];
      const isDuplicate = existingMessages.some((m) => m.id === message.id);
      if (isDuplicate) {
        return prev;
      }
      return {
        ...prev,
        [id]: [...existingMessages, message],
      };
    });
  }, []);

  const addAssistantMessage = useCallback((messageId: string, text: string, explicitSessionId?: string) => {
    const id = explicitSessionId || currentSessionIdRef.current;
    if (!id) return;
    setSessionMessages((prev) => {
      const existingMessages = prev[id] || [];
      const isDuplicate = existingMessages.some((m) => m.id === messageId);
      if (isDuplicate) {
        return prev;
      }
      return {
        ...prev,
        [id]: [
          ...existingMessages,
          { id: messageId, role: 'assistant' as const, content: text, timestamp: Date.now() },
        ],
      };
    });
  }, []);

  return {
    sessions,
    currentSessionId,
    currentSession,
    status,
    isLoadingMessages,
    createNewSession,
    createPersistedSession,
    switchSession,
    deleteSession,
    clearAllSessions,
    renameSession,
    addUserMessage,
    addAssistantMessage,
    handleFirstMessage,
    generateTitleForSession,
  };
}
