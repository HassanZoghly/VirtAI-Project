import { describe, expect, it } from 'vitest';
import { normalizeAndSortSessions, resolveInitialSessionId, selectSessionId } from './sessionState';

describe('sessionState helpers', () => {
  it('sorts by most recent updated_at/updatedAt/created_at/createdAt', () => {
    const sorted = normalizeAndSortSessions([
      { _id: 'old', createdAt: '2026-05-01T08:00:00Z' },
      { id: 'newest', updated_at: '2026-05-01T12:00:00Z' },
      { id: 'middle', updatedAt: '2026-05-01T10:00:00Z' },
    ]);

    expect(sorted.map((s) => s.id)).toEqual(['newest', 'middle', 'old']);
  });

  it('prefers urlSessionId when it exists, otherwise falls back to index 0', () => {
    const sessions = normalizeAndSortSessions([
      { id: 'first', updated_at: '2026-05-01T10:00:00Z' },
      { id: 'second', updated_at: '2026-05-01T09:00:00Z' },
    ]);

    expect(selectSessionId(sessions, 'second')).toBe('second');
    expect(selectSessionId(sessions, 'missing')).toBe('first');
    expect(selectSessionId([], 'missing')).toBeNull();
  });

  it('resolveInitialSessionId prefers URL match over any fallback', () => {
    const sessions = normalizeAndSortSessions([
      { id: 's1', updated_at: '2026-05-01T12:00:00Z', message_count: 0 },
      { id: 's2', updated_at: '2026-05-01T11:00:00Z', message_count: 5 },
    ]);

    expect(resolveInitialSessionId(sessions, 's2')).toBe('s2');
  });

  it('resolveInitialSessionId picks existing empty session when URL is missing/invalid', () => {
    const sessions = normalizeAndSortSessions([
      { id: 'newest', updated_at: '2026-05-01T12:00:00Z', message_count: 3 },
      { id: 'empty', updated_at: '2026-05-01T11:00:00Z', message_count: 0 },
      { id: 'loaded', updated_at: '2026-05-01T10:00:00Z', messages: ['x'] },
    ]);

    expect(resolveInitialSessionId(sessions, 'missing')).toBe('empty');
  });

  it('resolveInitialSessionId falls back to most recent when no empty session exists', () => {
    const sessions = normalizeAndSortSessions([
      { id: 'first', updated_at: '2026-05-01T12:00:00Z', message_count: 2 },
      { id: 'second', updated_at: '2026-05-01T11:00:00Z', message_count: 1 },
    ]);

    expect(resolveInitialSessionId(sessions)).toBe('first');
  });
});

