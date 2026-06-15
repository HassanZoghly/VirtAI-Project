import { describe, expect, it } from 'vitest';
import { resolveAvatarPanelPresentationState } from './AvatarPanel';

describe('AvatarPanel presentation state', () => {
  it('keeps scene-ready in loading state until visible is emitted', () => {
    expect(resolveAvatarPanelPresentationState('scene-ready')).toEqual({
      isLoaded: false,
      isFailed: false,
      isLoading: true,
    });
  });

  it('marks visible as loaded', () => {
    expect(resolveAvatarPanelPresentationState('visible')).toEqual({
      isLoaded: true,
      isFailed: false,
      isLoading: false,
    });
  });

  it('marks failed as failed without loading', () => {
    expect(resolveAvatarPanelPresentationState('failed')).toEqual({
      isLoaded: false,
      isFailed: true,
      isLoading: false,
    });
  });
});
