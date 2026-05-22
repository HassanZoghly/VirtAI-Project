import { describe, it, expect, beforeEach } from 'vitest';
import { AvatarFaceController } from './AvatarFaceController';

describe('AvatarFaceController', () => {
  let controller;

  beforeEach(() => {
    controller = new AvatarFaceController();
  });

  it('should transition emotion values over time', () => {
    // Note: Happy has mouthSmileLeft: 0.8
    controller.setEmotion('happy', 1.0, 500);

    // Initially zero (if starting from neutral)
    expect(controller._emotionValues.mouthSmileLeft || 0).toBe(0);

    // Update by some time (e.g. 0.2s)
    controller.update(0.2);
    const midValue = controller._emotionValues.mouthSmileLeft;
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(0.8);

    // Update to completion (total 0.6s > 500ms)
    controller.update(0.4);
    expect(controller._emotionValues.mouthSmileLeft).toBeCloseTo(0.8, 2);
    expect(controller._transitioning).toBe(false);
  });

  it('should handle neutral correctly', () => {
    controller.setEmotion('happy', 1.0, 100);
    controller.update(0.2);
    expect(controller._emotionValues.mouthSmileLeft).toBeCloseTo(0.8, 2);

    controller.setEmotion('neutral', 1.0, 100);
    controller.update(0.2);
    expect(controller._emotionValues.mouthSmileLeft || 0).toBe(0);
  });

  it('should handle intensity correctly', () => {
    controller.setEmotion('happy', 0.5, 100);
    controller.update(0.2);
    expect(controller._emotionValues.mouthSmileLeft).toBeCloseTo(0.4, 2);
  });
});
