import { describe, expect, it } from 'vitest';
import {
  AVATAR_VISIBILITY_FAILURE_REASONS,
  FIRST_FRAME_VALIDATION_ACTIONS,
  captureAvatarFailureScreenshot,
  computeAvatarCameraFit,
  createAvatarVisibilityTelemetry,
  emitAvatarFailureScreenshot,
  emitAvatarVisibilityTelemetry,
  evaluateAvatarFirstFrameValidation,
  hasVisibleFramebufferPixels,
} from './avatarFirstFrameValidation';

describe('avatar first-frame validation', () => {
  it('fails when the world bounding box is empty', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: true,
      visibleMeshes: 1,
      hasNaN: false,
      isInFrustum: true,
      rescueAttempted: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.FAILURE);
    expect(result.reason).toBe('World bounding box is empty');
  });

  it('fails when there are no visible meshes', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 0,
      hasNaN: false,
      isInFrustum: true,
      rescueAttempted: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.FAILURE);
    expect(result.reason).toBe('No visible meshes found');
  });

  it('fails when NaN transforms are detected', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 1,
      hasNaN: true,
      isInFrustum: true,
      rescueAttempted: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.FAILURE);
    expect(result.reason).toBe('NaN values detected in bone transforms');
  });

  it('requests one rescue when the avatar is outside the frustum before rescue', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 1,
      hasNaN: false,
      isInFrustum: false,
      rescueAttempted: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.REQUEST_RESCUE);
  });

  it('fails when the avatar remains outside the frustum after rescue', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 1,
      hasNaN: false,
      isInFrustum: false,
      rescueAttempted: true,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.FAILURE);
    expect(result.reason).toBe('Avatar is outside camera frustum (rescue fit failed)');
  });

  it('succeeds when bbox, meshes, transforms, and frustum are valid', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 1,
      hasNaN: false,
      isInFrustum: true,
      rescueAttempted: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.SUCCESS);
  });

  it('fails with NO_PIXELS reason when canvas is blank after geometric validation', () => {
    const result = evaluateAvatarFirstFrameValidation({
      isWorldBoxEmpty: false,
      visibleMeshes: 1,
      hasNaN: false,
      isInFrustum: true,
      rescueAttempted: false,
      hasRenderedPixels: false,
    });

    expect(result.action).toBe(FIRST_FRAME_VALIDATION_ACTIONS.FAILURE);
    expect(result.reason).toBe('Avatar canvas rendered no visible pixels');
    expect(result.failureReason).toBe(AVATAR_VISIBILITY_FAILURE_REASONS.NO_PIXELS);
  });
});

describe('avatar camera fit', () => {
  it('frames the avatar from the positive z axis with an upper-body target', () => {
    const result = computeAvatarCameraFit({
      worldCenter: [0, 0.25, 0.05],
      worldSize: [1.3, 2.3, 0.45],
      fovDeg: 30,
      aspect: 511 / 720,
    });

    expect(result.target[0]).toBeCloseTo(0);
    expect(result.target[1]).toBeGreaterThan(0.25);
    expect(result.target[2]).toBeCloseTo(0.05);
    expect(result.position[2]).toBeGreaterThan(result.target[2]);
    expect(result.distance).toBeGreaterThan(0);
  });
});

describe('avatar framebuffer pixel detection', () => {
  it('reads visible pixels from a Three.js WebGLRenderer context', () => {
    const context = {
      RGBA: 'RGBA',
      UNSIGNED_BYTE: 'UNSIGNED_BYTE',
      drawingBufferWidth: 9,
      drawingBufferHeight: 9,
      readPixels: (x, y, _width, _height, _format, _type, pixel) => {
        if (x === 5 && y === 5) {
          pixel[3] = 255;
        }
      },
    };
    const renderer = {
      domElement: { width: 9, height: 9 },
      getContext: () => context,
    };

    expect(hasVisibleFramebufferPixels(renderer, { gridSize: 3 })).toBe(true);
  });
});

describe('avatar visibility telemetry', () => {
  const basePayload = {
    avatarId: 'avatar1',
    lifecycleState: 'scene-mounted',
    bboxValid: true,
    bboxSize: [1, 2, 0.5],
    inFrustum: true,
    pixelVisible: false,
    rescueAttempted: false,
    rescueSucceeded: false,
    avatarScale: 1.25,
    avatarPosition: [0, -0.9, 0],
    cameraPosition: [0, 1.5, 2.5],
    cameraTarget: [0, 1.1, 0],
    cameraNear: 0.01,
    cameraFar: 100,
    fov: 30,
    frameCountAtDecision: 12,
    failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.NO_PIXELS,
    timestamp: '2026-06-15T00:00:00.000Z',
  };

  it('creates the exact structured payload required by the visibility plan', () => {
    const record = createAvatarVisibilityTelemetry(basePayload);

    expect(record).toEqual(basePayload);
  });

  it('routes telemetry through the supplied logger only when DEBUG_AVATAR is enabled', () => {
    const emitted = [];
    const logger = {
      info: (...args) => emitted.push(args),
    };
    const target = {};

    const disabled = emitAvatarVisibilityTelemetry(basePayload, {
      env: { DEBUG_AVATAR: 'false' },
      logger,
      target,
    });
    const enabled = emitAvatarVisibilityTelemetry(basePayload, {
      env: { DEBUG_AVATAR: 'true' },
      logger,
      target,
    });

    expect(disabled).toBeNull();
    expect(enabled).toEqual(basePayload);
    expect(target.__VIRTAI_AVATAR_DEBUG__.visibilityTelemetry).toEqual([basePayload]);
    expect(emitted).toEqual([['[AvatarVisibilityTelemetry]', basePayload]]);
  });

  it('captures failure screenshots only in avatar debug mode', () => {
    const renderer = {
      domElement: {
        toDataURL: () => 'data:image/png;base64,avatar',
      },
    };

    expect(captureAvatarFailureScreenshot(renderer, { env: { DEBUG_AVATAR: 'false' } })).toBeNull();
    expect(captureAvatarFailureScreenshot(renderer, { env: { DEBUG_AVATAR: 'true' } })).toBe(
      'data:image/png;base64,avatar'
    );
  });

  it('stores and logs failure screenshots only in avatar debug mode', () => {
    const emitted = [];
    const logger = {
      info: (...args) => emitted.push(args),
    };
    const target = {};
    const payload = {
      avatarId: 'avatar1',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.NO_PIXELS,
      screenshotDataUrl: 'data:image/png;base64,avatar',
      timestamp: '2026-06-15T00:00:00.000Z',
    };

    expect(
      emitAvatarFailureScreenshot(payload, {
        env: { DEBUG_AVATAR: 'false' },
        logger,
        target,
      })
    ).toBeNull();

    const artifact = emitAvatarFailureScreenshot(payload, {
      env: { DEBUG_AVATAR: 'true' },
      logger,
      target,
    });

    expect(artifact).toEqual(payload);
    expect(target.__VIRTAI_AVATAR_DEBUG__.failureScreenshots).toEqual([payload]);
    expect(emitted).toEqual([['[AvatarVisibilityFailureScreenshot]', payload]]);
  });
});
