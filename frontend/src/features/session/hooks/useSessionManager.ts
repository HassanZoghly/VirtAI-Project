import { selectIsAuthenticated, useAuthStore } from '@/features/auth/store/authStore';
import { isAxiosError } from 'axios';
import { toast } from '@/shared/utils/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as sessionService from '../services/sessionService';
import { IMessage, ISession } from '../types';
import { normalizeAndSortSessions } from '../utils/sessionState';

export default function useSessionManager(urlSessionId?: string, navigate?: any) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isAuthInitialized = useAuthStore((s) => s.isInitialized);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Sync urlSessionId
  useEffect(() => {
    if (urlSessionId) setCurrentSessionId(urlSessionId);
  }, [urlSessionId]);

  // Logout cleanup
  useEffect(() => {
    if (!isAuthenticated && isAuthInitialized) {
      setCurrentSessionId(null);
      queryClient.removeQueries();
    }
  }, [isAuthenticated, isAuthInitialized, queryClient]);

  // Fetch Sessions
  const { data: rawSessions = [], status: sessionsQueryStatus } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const fetched = await sessionService.fetchSessions();
      return normalizeAndSortSessions(fetched);
    },
    enabled: isAuthInitialized && isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });

  const status = sessionsQueryStatus === 'pending' ? 'loading' : sessionsQueryStatus === 'error' ? 'error' : sessionsQueryStatus === 'success' ? 'success' : 'idle';
  const sessions = rawSessions;

  // Handle URL mismatch
  useEffect(() => {
    if (status === 'success' && sessions.length > 0 && urlSessionId) {
      const match = sessions.find((s) => s.id === urlSessionId);
      if (!match && navigate) {
        navigate('/classroom', { replace: true });
        setCurrentSessionId(null);
      }
    }
  }, [status, sessions, urlSessionId, navigate]);

  // Fetch Session Messages
  const { data: sessionMessages = [], isFetching: isLoadingMessages } = useQuery({
    queryKey: ['sessionMessages', currentSessionId],
    queryFn: async ({ signal }) => {
      if (!currentSessionId) return [];
      return await sessionService.fetchSessionMessages(currentSessionId, { signal });
    },
    enabled: !!currentSessionId && status === 'success',
    staleTime: Infinity, // WebSocket will handle subsequent real-time updates
  });

  const currentSession = useMemo(() => {
    if (!currentSessionId) return { id: null, title: 'New chat', messages: [], messages_loaded: true };
    const s = sessions.find((item) => item.id === currentSessionId);
    if (!s) return { id: null, title: '', messages: [], messages_loaded: true };
    return { ...s, messages: sessionMessages, messages_loaded: true };
  }, [sessions, currentSessionId, sessionMessages]);

  const switchSession = useCallback(
    (id: string | null) => {
      setCurrentSessionId(id);
      if (navigate) {
        navigate(id ? `/classroom/${id}` : `/classroom`);
      }
    },
    [navigate]
  );

  // Mutations
  const createMutation = useMutation({
    mutationFn: sessionService.createSession,
    onSuccess: (newSession) => {
      const createdSession: ISession = { ...newSession, messages_loaded: true };
      queryClient.setQueryData(['sessions'], (old: ISession[] = []) => {
        if (old.some(s => s.id === createdSession.id)) return old;
        return [createdSession, ...old];
      });
      queryClient.setQueryData(['sessionMessages', createdSession.id], []);
    },
  });

  const isCreatingRef = useRef(false);

  const createNewSession = useCallback(async () => {
    const cachedSessions = queryClient.getQueryData<ISession[]>(['sessions']) || [];
    
    // Find the latest empty draft session using actual data
    const emptySession = cachedSessions.find((s) => {
      if (typeof s.message_count === 'number') {
        return s.message_count === 0;
      }
      if (s.messages_loaded) {
        return !s.messages || s.messages.length === 0;
      }
      return false;
    });
    
    if (emptySession) {
      setCurrentSessionId(emptySession.id);
      if (navigate) navigate(`/classroom/${emptySession.id}`, { replace: true });
      return emptySession.id;
    }

    if (isCreatingRef.current) return null;
    isCreatingRef.current = true;
    try {
      const newSession = await createMutation.mutateAsync();
      setCurrentSessionId(newSession.id);
      if (navigate) navigate(`/classroom/${newSession.id}`, { replace: true });
      return newSession.id;
    } catch (error: unknown) {
      const msg = isAxiosError(error) ? error.response?.data?.detail || error.message : error instanceof Error ? error.message : 'Failed to create new chat session';
      toast.error('Creation Failed', msg);
      return null;
    } finally {
      isCreatingRef.current = false;
    }
  }, [queryClient, createMutation, navigate]);

  const createPersistedSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionId) return currentSessionId;
    return createNewSession();
  }, [currentSessionId, createNewSession]);

  const titleGenAbortControllersRef = useRef<Record<string, AbortController>>({});

  const deleteMutation = useMutation({
    mutationFn: sessionService.deleteSession,
    onMutate: async (sessionId) => {
      // Abort in-flight title generation if any
      if (titleGenAbortControllersRef.current[sessionId]) {
        titleGenAbortControllersRef.current[sessionId].abort();
        delete titleGenAbortControllersRef.current[sessionId];
      }

      await queryClient.cancelQueries({ queryKey: ['sessions'] });
      const prevSessions = queryClient.getQueryData<ISession[]>(['sessions']);
      const prevMsgs = queryClient.getQueryData<IMessage[]>(['sessionMessages', sessionId]);

      queryClient.setQueryData(['sessions'], (old: ISession[] = []) => old.filter((s) => s.id !== sessionId));
      queryClient.removeQueries({ queryKey: ['sessionMessages', sessionId] });

      return { prevSessions, prevMsgs, sessionId };
    },
    onError: (err: unknown, sessionId, ctx) => {
      const msg = isAxiosError(err) ? err.response?.data?.detail || err.message : err instanceof Error ? err.message : 'Failed to delete chat session';
      toast.error('Delete Failed', msg);
      if (ctx?.prevSessions) queryClient.setQueryData(['sessions'], ctx.prevSessions);
      if (ctx?.prevMsgs) queryClient.setQueryData(['sessionMessages', ctx.sessionId], ctx.prevMsgs);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const deleteSession = useCallback((sessionId: string) => {
    const wasActive = sessionId === currentSessionId;
    if (wasActive) {
      setCurrentSessionId(null);
      if (navigate) navigate('/classroom', { replace: true });
    }
    deleteMutation.mutate(sessionId, {
      onError: () => {
        if (wasActive) setCurrentSessionId(sessionId);
      }
    });
  }, [currentSessionId, navigate, deleteMutation]);

  const clearAllMutation = useMutation({
    mutationFn: sessionService.deleteAllSessions,
    onSuccess: () => {
      queryClient.setQueryData(['sessions'], []);
      setCurrentSessionId(null);
      if (navigate) navigate('/classroom', { replace: true });
      void createNewSession();
    },
    onError: (err: unknown) => {
      const msg = isAxiosError(err) ? err.response?.data?.detail || err.message : err instanceof Error ? err.message : 'Failed to clear sessions';
      toast.error('Clear Failed', msg);
    },
  });

  const clearAllSessions = useCallback(() => clearAllMutation.mutate(), [clearAllMutation]);

  // Rename Debounce logic
  const renameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameOriginalRef = useRef<ISession[] | null>(null);

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => sessionService.renameSession(id, title),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const renameSession = useCallback((sessionId: string, newTitle: string) => {
    if (!renameTimeoutRef.current) {
      renameOriginalRef.current = queryClient.getQueryData<ISession[]>(['sessions']) || null;
    }

    queryClient.setQueryData(['sessions'], (old: ISession[] = []) =>
      old.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );

    if (renameTimeoutRef.current) clearTimeout(renameTimeoutRef.current);
    
    renameTimeoutRef.current = setTimeout(() => {
      const original = renameOriginalRef.current;
      renameOriginalRef.current = null;
      renameTimeoutRef.current = null;

      renameMutation.mutate(
        { id: sessionId, title: newTitle },
        {
          onError: (err: unknown) => {
            if (original) queryClient.setQueryData(['sessions'], original);
            const msg = isAxiosError(err) ? err.response?.data?.detail || err.message : err instanceof Error ? err.message : 'Failed to rename chat session';
            toast.error('Rename Failed', msg);
          }
        }
      );
    }, 500);
  }, [queryClient, renameMutation]);

  // Real-time message updaters
  const addUserMessage = useCallback((message: IMessage, explicitSessionId?: string) => {
    const id = explicitSessionId || currentSessionId;
    if (!id) return;
    let added = false;
    queryClient.setQueryData(['sessionMessages', id], (old: IMessage[] = []) => {
      if (old.some((m) => m.id === message.id)) return old;
      added = true;
      return [...old, message];
    });
    if (added) {
      queryClient.setQueryData(['sessions'], (old: ISession[] = []) => 
        old.map(s => s.id === id ? { ...s, message_count: (s.message_count || 0) + 1 } : s)
      );
    }
  }, [currentSessionId, queryClient]);

  const addAssistantMessage = useCallback((messageId: string, text: string, explicitSessionId?: string) => {
    const id = explicitSessionId || currentSessionId;
    if (!id) return;
    let added = false;
    queryClient.setQueryData(['sessionMessages', id], (old: IMessage[] = []) => {
      if (old.some((m) => m.id === messageId)) return old;
      added = true;
      return [...old, { id: messageId, role: 'assistant', content: text, timestamp: Date.now() }];
    });
    if (added) {
      queryClient.setQueryData(['sessions'], (old: ISession[] = []) => 
        old.map(s => s.id === id ? { ...s, message_count: (s.message_count || 0) + 1 } : s)
      );
    }
  }, [currentSessionId, queryClient]);

  // ---------------------------------------------------------------------------
  // We already defined titleGenAbortControllersRef above

  const generateTitleMutation = useMutation({
    mutationFn: ({ id, text, signal }: { id: string; text: string; signal: AbortSignal }) => 
      sessionService.generateSmartTitle(id, text, { signal }),
    onSuccess: (generatedTitle, { id }) => {
      queryClient.setQueryData(['sessions'], (old: ISession[] = []) =>
        old.map((s) => {
          if (s.id === id && (s.title === 'New chat' || s.title === 'New Chat')) {
            return { ...s, title: generatedTitle };
          }
          return s;
        })
      );
    },
  });

  const generateTitleForSession = useCallback((sessionId: string, text: string) => {
    if (!sessionId || !text.trim()) return;

    if (titleGenAbortControllersRef.current[sessionId]) {
      return; // Already generating
    }

    const abortController = new AbortController();
    titleGenAbortControllersRef.current[sessionId] = abortController;

    generateTitleMutation.mutate(
      { id: sessionId, text, signal: abortController.signal },
      {
        onSettled: () => {
          delete titleGenAbortControllersRef.current[sessionId];
        }
      }
    );
  }, [generateTitleMutation]);

  const handleFirstMessage = useCallback(async (text: string): Promise<string | null> => {
    if (isCreatingRef.current || currentSessionId) return null; // Prevent duplicate POSTs
    isCreatingRef.current = true;

    try {
      const newSession = await createMutation.mutateAsync();
      setCurrentSessionId(newSession.id);
      if (navigate) navigate(`/classroom/${newSession.id}`, { replace: true });

      // Generate title
      generateTitleForSession(newSession.id, text);

      return newSession.id;
    } catch (e: unknown) {
      const msg = isAxiosError(e) ? e.response?.data?.detail || e.message : e instanceof Error ? e.message : 'Failed to create session for first message';
      toast.error('Creation Failed', msg);
      return null;
    } finally {
      isCreatingRef.current = false;
    }
  }, [createMutation, navigate, generateTitleForSession, currentSessionId]);

  // Abort generating title if session deleted
  useEffect(() => {
    return () => {
      // Unmount cleanup: normally we could abort everything, but we only abort when deleted.
      // We can hook into deleteSession, but for now we'll do it manually.
    };
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
