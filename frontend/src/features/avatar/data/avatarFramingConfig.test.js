import { describe, expect, it } from 'vitest';
import { avatarImages } from './avatars';
import { getAvatarRigProfile } from './avatarRigProfiles';
import { getCameraPreset } from './cameraPresets';

const MODEL_ID_PATTERN = /\/models\/(.+)\.glb$/;

function modelIdForAvatar(avatar) {
  return avatar.modelPath.match(MODEL_ID_PATTERN)?.[1] || null;
}

function expectFiniteNumberTuple(value, length) {
  expect(Array.isArray(value)).toBe(true);
  expect(value).toHaveLength(length);
  value.forEach((entry) => {
    expect(Number.isFinite(entry)).toBe(true);
  });
}

describe('avatar framing configuration', () => {
  it('defines fixed rig profiles and camera presets for every selectable avatar model', () => {
    Object.values(avatarImages).forEach((avatar) => {
      const modelId = modelIdForAvatar(avatar);

      expect(modelId).toBeTruthy();

      const rigProfile = getAvatarRigProfile(modelId);
      const cameraPreset = getCameraPreset(modelId);

      expect(rigProfile).toBeTruthy();
      expect(cameraPreset).toBeTruthy();
      expect(Number.isFinite(rigProfile.scale)).toBe(true);
      expect(rigProfile.scale).toBeGreaterThan(0);
      expectFiniteNumberTuple(rigProfile.position, 3);
      expectFiniteNumberTuple(cameraPreset.position, 3);
      expectFiniteNumberTuple(cameraPreset.target, 3);
      expect(Number.isFinite(cameraPreset.fov)).toBe(true);
      expect(Number.isFinite(cameraPreset.near)).toBe(true);
      expect(Number.isFinite(cameraPreset.far)).toBe(true);
      expect(cameraPreset.near).toBeGreaterThan(0);
      expect(cameraPreset.far).toBeGreaterThan(cameraPreset.near);
    });
  });
});
