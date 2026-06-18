import { describe, expect, it } from 'vitest';
import { ISession } from '../types';
import {
  normalizeAndSortSessions,
  sortSessionsByRecency,
} from './sessionState';

describe('sessionState helpers', () => {
  it('sorts by most recent updated_at/created_at', () => {
    const sorted = normalizeAndSortSessions([
      { _id: 'old', created_at: '2026-05-01T08:00:00Z' },
      { id: 'newest', updated_at: '2026-05-01T12:00:00Z' },
      { id: 'middle', updated_at: '2026-05-01T10:00:00Z' },
    ]);

    expect(sorted.map((s: ISession) => s.id)).toEqual(['newest', 'middle', 'old']);
  });

  it('sortSessionsByRecency handles an empty array', () => {
    expect(sortSessionsByRecency([])).toEqual([]);
  });

  it('normalizeAndSortSessions filters out sessions without an id', () => {
    const result = normalizeAndSortSessions([
      { id: 'valid', updated_at: '2026-05-01T10:00:00Z' },
      { title: 'no-id', updated_at: '2026-05-01T11:00:00Z' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid');
  });

  it('normalizeAndSortSessions returns [] for non-array input', () => {
    expect(normalizeAndSortSessions(null as any)).toEqual([]);
    expect(normalizeAndSortSessions(undefined as any)).toEqual([]);
  });
});
