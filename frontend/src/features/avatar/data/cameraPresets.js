/**
 * cameraPresets.js
 * Central registry for per-avatar camera configurations.
 */

export const CAMERA_PRESETS = {
  default: {
    position: [0, 1.5, 2.5],
    target: [0, 1.1, 0],
    fov: 30,
    near: 0.01,
    far: 100,
  },
  avatar1: {
    position: [0, 1.5, 2.5],
    target: [0, 1.1, 0],
    fov: 30,
    near: 0.01,
    far: 100,
  },
  avatar2: {
    position: [0, 1.5, 2.5],
    target: [0, 1.1, 0],
    fov: 30,
    near: 0.01,
    far: 100,
  },
  avatar3: {
    position: [0, 1.5, 2.5],
    target: [0, 1.1, 0],
    fov: 30,
    near: 0.01,
    far: 100,
  },
};

export function getCameraPreset(avatarId) {
  if (!avatarId) return CAMERA_PRESETS.default;
  return CAMERA_PRESETS[avatarId] || CAMERA_PRESETS.default;
}
