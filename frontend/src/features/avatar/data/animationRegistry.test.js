import { describe, expect, it } from 'vitest';
import {
  REQUIRED_TALK_ANIMATION_NAMES,
  formatMissingTalkAnimationsWarning,
  getMissingTalkAnimationNames,
} from './animationRegistry';

describe('animation registry diagnostics', () => {
  it('tracks Talk_1 and Talk_2 as required talk animations', () => {
    expect(REQUIRED_TALK_ANIMATION_NAMES).toEqual(['Talk_1', 'Talk_2']);
  });

  it('reports missing required talk animations by explicit clip name', () => {
    const missing = getMissingTalkAnimationNames({
      Talk_1: {
        name: 'Talk_1',
        type: 'talk',
        path: '/models/animations/Talk/Talk_1.fbx',
      },
    });

    expect(missing).toEqual(['Talk_2']);
  });

  it('formats missing talk animation warnings with the expected clip names', () => {
    expect(formatMissingTalkAnimationsWarning(['Talk_1', 'Talk_2'])).toBe(
      'Talk_1 missing; Talk_2 missing'
    );
  });
});
