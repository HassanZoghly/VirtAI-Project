function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function extractCollection(data, keys = []) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  for (const key of keys) {
    const candidate = data[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (data.data && data.data !== data) {
    const nested = extractCollection(data.data, keys);
    if (nested.length > 0 || Array.isArray(data.data)) {
      return nested;
    }
  }

  return [];
}

export function getSessionTimeMs(session) {
  return new Date(
    session?.updated_at ||
      session?.updatedAt ||
      session?.created_at ||
      session?.createdAt ||
      0
  ).getTime();
}

export function sortSessionsByRecency(sessions) {
  return [...asArray(sessions)].sort((a, b) => getSessionTimeMs(b) - getSessionTimeMs(a));
}

export function normalizeSession(session) {
  const id = session?.id || session?._id || null;

  return {
    ...session,
    id,
    messages: Array.isArray(session?.messages) ? session.messages : undefined,
    messages_loaded: session?.messages_loaded === true,
  };
}

export function normalizeAndSortSessions(data) {
  const sessions = Array.isArray(data)
    ? data
    : extractCollection(data, ['sessions', 'messages', 'data', 'items']);

  return sortSessionsByRecency(sessions.map(normalizeSession).filter((session) => Boolean(session.id)));
}

export function selectSessionId(sessions, urlSessionId) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  if (urlSessionId) {
    const match = sessions.find((session) => session.id === urlSessionId);
    if (match) {
      return match.id;
    }
  }

  return sessions[0].id || null;
}

export function resolveInitialSessionId(sessions, urlSessionId) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  const normalizedSessions = sessions.map(normalizeSession).filter((session) => Boolean(session.id));
  if (normalizedSessions.length === 0) {
    return null;
  }

  if (urlSessionId) {
    const urlMatch = normalizedSessions.find((session) => session.id === urlSessionId);
    if (urlMatch) {
      return urlMatch.id;
    }
  }

  const existingEmptySession = normalizedSessions.find(
    (session) =>
      session?.message_count === 0 ||
      session?.messageCount === 0 ||
      (Array.isArray(session?.messages) && session.messages.length === 0)
  );

  if (existingEmptySession) {
    return existingEmptySession.id;
  }

  return normalizedSessions[0].id;
}

