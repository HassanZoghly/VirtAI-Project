import { describe, expect, it } from 'vitest';
import {
  AVATAR_LIFECYCLE_EVENTS,
  AVATAR_STATUS,
  createAvatarLifecycleTelemetry,
  emitAvatarLifecycleTelemetry,
  installAvatarLifecycleDebugControls,
  resolveAvatarLifecycleTransition,
} from './avatarLifecycle';

describe('avatar lifecycle transitions', () => {
  it('does not promote scene-mounted directly to scene-ready', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.LOADING,
      AVATAR_LIFECYCLE_EVENTS.SCENE_MOUNTED
    );

    expect(result.status).toBe(AVATAR_STATUS.SCENE_MOUNTED);
    expect(result.changed).toBe(true);
  });

  it('promotes first-frame validation from loading to scene-ready', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.LOADING,
      AVATAR_LIFECYCLE_EVENTS.FIRST_FRAME_VALIDATED
    );

    expect(result.status).toBe(AVATAR_STATUS.SCENE_READY);
    expect(result.changed).toBe(true);
  });

  it('promotes first-frame validation from scene-mounted to scene-ready', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.SCENE_MOUNTED,
      AVATAR_LIFECYCLE_EVENTS.FIRST_FRAME_VALIDATED
    );

    expect(result.status).toBe(AVATAR_STATUS.SCENE_READY);
    expect(result.changed).toBe(true);
  });

  it('promotes scene-ready to visible only after the visible event', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.SCENE_READY,
      AVATAR_LIFECYCLE_EVENTS.VISIBLE
    );

    expect(result.status).toBe(AVATAR_STATUS.VISIBLE);
    expect(result.changed).toBe(true);
  });

  it('rejects visible before scene-ready', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.SCENE_MOUNTED,
      AVATAR_LIFECYCLE_EVENTS.VISIBLE
    );

    expect(result.status).toBe(AVATAR_STATUS.SCENE_MOUNTED);
    expect(result.changed).toBe(false);
    expect(result.rejected).toBe(true);
  });

  it('ignores stale scene-mounted events after scene-ready', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.SCENE_READY,
      AVATAR_LIFECYCLE_EVENTS.SCENE_MOUNTED
    );

    expect(result.status).toBe(AVATAR_STATUS.SCENE_READY);
    expect(result.changed).toBe(false);
    expect(result.stale).toBe(true);
  });

  it('ignores stale validation events after visible', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.VISIBLE,
      AVATAR_LIFECYCLE_EVENTS.FIRST_FRAME_VALIDATED
    );

    expect(result.status).toBe(AVATAR_STATUS.VISIBLE);
    expect(result.changed).toBe(false);
    expect(result.stale).toBe(true);
  });

  it('resets to loading on retry', () => {
    const result = resolveAvatarLifecycleTransition(
      AVATAR_STATUS.FAILED,
      AVATAR_LIFECYCLE_EVENTS.RETRY
    );

    expect(result.status).toBe(AVATAR_STATUS.LOADING);
    expect(result.changed).toBe(true);
  });
});

describe('avatar lifecycle telemetry', () => {
  const transitionPayload = {
    avatarId: 'avatar1',
    lifecycleState: AVATAR_STATUS.SCENE_MOUNTED,
    event: AVATAR_LIFECYCLE_EVENTS.FIRST_FRAME_VALIDATED,
    source: 'handleAvatarFirstFrameValidated',
    previousStatus: AVATAR_STATUS.SCENE_MOUNTED,
    nextStatus: AVATAR_STATUS.SCENE_READY,
    changed: true,
    rejected: false,
    stale: false,
    failureReason: null,
    timestamp: '2026-06-15T00:00:00.000Z',
  };

  it('creates a structured lifecycle transition payload', () => {
    expect(createAvatarLifecycleTelemetry(transitionPayload)).toEqual(transitionPayload);
  });

  it('routes lifecycle telemetry through the supplied logger only when DEBUG_AVATAR is enabled', () => {
    const emitted = [];
    const logger = {
      info: (...args) => emitted.push(args),
    };
    const target = {};

    const disabled = emitAvatarLifecycleTelemetry(transitionPayload, {
      env: { DEBUG_AVATAR: 'false' },
      logger,
      target,
    });
    const enabled = emitAvatarLifecycleTelemetry(transitionPayload, {
      env: { DEBUG_AVATAR: 'true' },
      logger,
      target,
    });

    expect(disabled).toBeNull();
    expect(enabled).toEqual(transitionPayload);
    expect(target.__VIRTAI_AVATAR_DEBUG__.lifecycleTelemetry).toEqual([transitionPayload]);
    expect(emitted).toEqual([['[AvatarLifecycleTelemetry]', transitionPayload]]);
  });

  it('exposes and cleans up retry controls only in avatar debug mode', () => {
    const retry = () => {};
    const target = {};

    expect(
      installAvatarLifecycleDebugControls({
        onRetry: retry,
        env: { DEBUG_AVATAR: 'false' },
        target,
      })
    ).toBeNull();
    expect(target.__VIRTAI_AVATAR_DEBUG__).toBeUndefined();

    const cleanup = installAvatarLifecycleDebugControls({
      onRetry: retry,
      env: { DEBUG_AVATAR: 'true' },
      target,
    });

    expect(target.__VIRTAI_AVATAR_DEBUG__.retry).toBe(retry);
    cleanup();
    expect(target.__VIRTAI_AVATAR_DEBUG__.retry).toBeUndefined();
  });
});
