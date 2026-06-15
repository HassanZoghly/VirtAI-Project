import { logger as defaultLogger } from '@/shared/utils/logger';

export const FIRST_FRAME_VALIDATION_ACTIONS = {
  SUCCESS: 'success',
  REQUEST_RESCUE: 'request-rescue',
  FAILURE: 'failure',
};

export const AVATAR_VISIBILITY_FAILURE_REASONS = {
  BBOX_INVALID: 'BBOX_INVALID',
  OUT_OF_FRUSTUM: 'OUT_OF_FRUSTUM',
  NO_PIXELS: 'NO_PIXELS',
  RESCUE_FAILED: 'RESCUE_FAILED',
  NAN: 'NAN',
  UNKNOWN: 'UNKNOWN',
};

function normalizeDebugFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export function isAvatarDebugEnabled(env = import.meta.env) {
  const envFlag = env?.DEBUG_AVATAR ?? env?.VITE_DEBUG_AVATAR;
  const windowFlag =
    typeof window !== 'undefined'
      ? window.DEBUG_AVATAR ?? window.VITE_DEBUG_AVATAR
      : undefined;

  return normalizeDebugFlag(envFlag) || normalizeDebugFlag(windowFlag);
}

export function evaluateAvatarFirstFrameValidation({
  isWorldBoxEmpty,
  visibleMeshes,
  hasNaN,
  isInFrustum,
  rescueAttempted,
  hasRenderedPixels = true,
}) {
  if (isWorldBoxEmpty) {
    return {
      action: FIRST_FRAME_VALIDATION_ACTIONS.FAILURE,
      reason: 'World bounding box is empty',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.BBOX_INVALID,
    };
  }

  if (visibleMeshes === 0) {
    return {
      action: FIRST_FRAME_VALIDATION_ACTIONS.FAILURE,
      reason: 'No visible meshes found',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.BBOX_INVALID,
    };
  }

  if (hasNaN) {
    return {
      action: FIRST_FRAME_VALIDATION_ACTIONS.FAILURE,
      reason: 'NaN values detected in bone transforms',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.NAN,
    };
  }

  if (!isInFrustum) {
    if (!rescueAttempted) {
      return {
        action: FIRST_FRAME_VALIDATION_ACTIONS.REQUEST_RESCUE,
        reason: 'Avatar is outside camera frustum',
        failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.OUT_OF_FRUSTUM,
      };
    }

    return {
      action: FIRST_FRAME_VALIDATION_ACTIONS.FAILURE,
      reason: 'Avatar is outside camera frustum (rescue fit failed)',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.RESCUE_FAILED,
    };
  }

  if (!hasRenderedPixels) {
    if (!rescueAttempted) {
      return {
        action: FIRST_FRAME_VALIDATION_ACTIONS.REQUEST_RESCUE,
        reason: 'Avatar canvas rendered no visible pixels',
        failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.NO_PIXELS,
      };
    }
    return {
      action: FIRST_FRAME_VALIDATION_ACTIONS.FAILURE,
      reason: 'Avatar canvas rendered no visible pixels after rescue',
      failureReason: AVATAR_VISIBILITY_FAILURE_REASONS.NO_PIXELS,
    };
  }

  return { action: FIRST_FRAME_VALIDATION_ACTIONS.SUCCESS };
}

export function createAvatarVisibilityTelemetry({
  avatarId = null,
  lifecycleState = null,
  bboxValid = null,
  bboxSize = null,
  inFrustum = null,
  pixelVisible = null,
  rescueAttempted = false,
  rescueSucceeded = false,
  avatarScale = null,
  avatarPosition = null,
  cameraPosition = null,
  cameraTarget = null,
  cameraNear = null,
  cameraFar = null,
  fov = null,
  frameCountAtDecision = null,
  failureReason = null,
  timestamp = new Date().toISOString(),
} = {}) {
  return {
    avatarId,
    lifecycleState,
    bboxValid,
    bboxSize,
    inFrustum,
    pixelVisible,
    rescueAttempted,
    rescueSucceeded,
    avatarScale,
    avatarPosition,
    cameraPosition,
    cameraTarget,
    cameraNear,
    cameraFar,
    fov,
    frameCountAtDecision,
    failureReason,
    timestamp,
  };
}

export function emitAvatarVisibilityTelemetry(payload, {
  env = import.meta.env,
  logger = defaultLogger,
  target = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!isAvatarDebugEnabled(env)) {
    return null;
  }

  const record = createAvatarVisibilityTelemetry(payload);
  if (target) {
    target.__VIRTAI_AVATAR_DEBUG__ = target.__VIRTAI_AVATAR_DEBUG__ || {};
    target.__VIRTAI_AVATAR_DEBUG__.visibilityTelemetry =
      target.__VIRTAI_AVATAR_DEBUG__.visibilityTelemetry || [];
    target.__VIRTAI_AVATAR_DEBUG__.visibilityTelemetry.push(record);
  }

  logger.info('[AvatarVisibilityTelemetry]', record);
  return record;
}

export function captureAvatarFailureScreenshot(renderer, {
  env = import.meta.env,
  logger = defaultLogger,
} = {}) {
  if (!isAvatarDebugEnabled(env)) {
    return null;
  }

  const canvas = renderer?.domElement || renderer?.canvas;
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    return null;
  }

  try {
    return canvas.toDataURL('image/png');
  } catch (error) {
    logger.warn('[AvatarVisibilityTelemetry] Failed to capture failure screenshot', error);
    return null;
  }
}

export function emitAvatarFailureScreenshot({
  avatarId = null,
  failureReason = AVATAR_VISIBILITY_FAILURE_REASONS.UNKNOWN,
  screenshotDataUrl = null,
  timestamp = new Date().toISOString(),
} = {}, {
  env = import.meta.env,
  logger = defaultLogger,
  target = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (!isAvatarDebugEnabled(env) || !screenshotDataUrl) {
    return null;
  }

  const artifact = {
    avatarId,
    failureReason,
    screenshotDataUrl,
    timestamp,
  };

  if (target) {
    target.__VIRTAI_AVATAR_DEBUG__ = target.__VIRTAI_AVATAR_DEBUG__ || {};
    target.__VIRTAI_AVATAR_DEBUG__.failureScreenshots =
      target.__VIRTAI_AVATAR_DEBUG__.failureScreenshots || [];
    target.__VIRTAI_AVATAR_DEBUG__.failureScreenshots.push(artifact);
  }

  logger.info('[AvatarVisibilityFailureScreenshot]', artifact);
  return artifact;
}

function resolveFramebufferSource(rendererOrContext) {
  if (!rendererOrContext) {
    return null;
  }

  const context =
    typeof rendererOrContext.readPixels === 'function'
      ? rendererOrContext
      : rendererOrContext.getContext?.();

  if (!context || typeof context.readPixels !== 'function') {
    return null;
  }

  const canvas = rendererOrContext.domElement || rendererOrContext.canvas || context.canvas;

  return {
    context,
    width:
      rendererOrContext.drawingBufferWidth ||
      context.drawingBufferWidth ||
      canvas?.width ||
      0,
    height:
      rendererOrContext.drawingBufferHeight ||
      context.drawingBufferHeight ||
      canvas?.height ||
      0,
  };
}

export function hasVisibleFramebufferPixels(rendererOrContext, { gridSize = 7, alphaThreshold = 8 } = {}) {
  const source = resolveFramebufferSource(rendererOrContext);
  if (!source) {
    return false;
  }

  const { context, width, height } = source;
  if (width <= 0 || height <= 0) {
    return false;
  }

  const pixel = new Uint8Array(4);
  const steps = Math.max(2, gridSize - 1);

  for (let yIndex = 1; yIndex < gridSize - 1; yIndex += 1) {
    for (let xIndex = 1; xIndex < gridSize - 1; xIndex += 1) {
      const x = Math.min(width - 1, Math.max(0, Math.round((width * xIndex) / steps)));
      const y = Math.min(height - 1, Math.max(0, Math.round((height * yIndex) / steps)));
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      if (pixel[3] > alphaThreshold) {
        return true;
      }
    }
  }

  return false;
}

export function computeAvatarCameraFit({
  worldCenter,
  worldSize,
  fovDeg,
  aspect,
  margin = 1.15,
  verticalAimRatio = 0.18,
}) {
  const safeFov = Number.isFinite(fovDeg) && fovDeg > 0 ? fovDeg : 30;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const fovRad = safeFov * (Math.PI / 180);
  const halfFovTan = Math.tan(fovRad / 2);

  const height = Math.max(Number(worldSize?.[1]) || 0, 0.001);
  const width = Math.max(Number(worldSize?.[0]) || 0, 0.001);
  const depth = Math.max(Number(worldSize?.[2]) || 0, 0);
  const centerX = Number(worldCenter?.[0]) || 0;
  const centerY = Number(worldCenter?.[1]) || 0;
  const centerZ = Number(worldCenter?.[2]) || 0;
  const targetY = centerY + height * verticalAimRatio;

  const heightDistance = height / (2 * halfFovTan);
  const widthDistance = width / (2 * halfFovTan * safeAspect);
  const distance = Math.max(heightDistance, widthDistance, depth) * margin;

  return {
    target: [centerX, targetY, centerZ],
    position: [centerX, targetY, centerZ + distance],
    distance,
  };
}
