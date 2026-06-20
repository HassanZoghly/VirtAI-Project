import { ISession } from '../types';

export function getSessionTimeMs(session: Partial<ISession>): number {
  return new Date(
    session?.updated_at || session?.created_at || 0
  ).getTime();
}

export function sortSessionsByRecency(sessions: ISession[]): ISession[] {
  return [...sessions].sort((a, b) => getSessionTimeMs(b) - getSessionTimeMs(a));
}

export function normalizeSession(session: any): ISession {
  const id = session?.id || session?._id || null;

  return {
    ...session,
    id,
    title: session?.title || '',
    created_at: session?.created_at,
    updated_at: session?.updated_at,
    messages: Array.isArray(session?.messages) ? session.messages : undefined,
    messages_loaded: session?.messages_loaded === true,
    message_count: session?.message_count,
  };
}

export function normalizeAndSortSessions(data: any[]): ISession[] {
  const sessions = Array.isArray(data) ? data : [];

  return sortSessionsByRecency(
    sessions.map(normalizeSession).filter((session) => Boolean(session.id))
  );
}
