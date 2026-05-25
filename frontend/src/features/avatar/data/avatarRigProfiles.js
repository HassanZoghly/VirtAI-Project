/**
 * avatarRigProfiles.js
 * Central registry for avatar-specific metadata, ensuring we only apply 
 * compatible animations to correctly rigged avatars, and standardizing scale/position.
 */

export const AVATAR_RIG_PROFILES = {
  default: {
    clipSet: 'standard_v1',
    headBone: 'Head',
    mouthMeshes: ['Wolf3D_Head', 'Wolf3D_Teeth'],
    scale: 1.25,
    position: [0, -1.25, 0],
    compatibleTags: ['rpm_v1', 'standard'],
  },
  // If we identify specific avatars (e.g. avatar1, avatar2) with differing rest poses
  // or scales, we map them here.
  avatar1: {
    clipSet: 'standard_v1',
    headBone: 'Head',
    mouthMeshes: ['Wolf3D_Head', 'Wolf3D_Teeth'],
    scale: 1.25,
    position: [0, -1.25, 0],
    compatibleTags: ['rpm_v1', 'standard'],
  },
};

export function getAvatarRigProfile(avatarId) {
  if (!avatarId) return AVATAR_RIG_PROFILES.default;
  return AVATAR_RIG_PROFILES[avatarId] || AVATAR_RIG_PROFILES.default;
}

export function isClipCompatible(clipMeta, rigProfile) {
  if (!clipMeta || !clipMeta.compatibleSets) return true; // Assume true if not specified
  return clipMeta.compatibleSets.includes(rigProfile.clipSet);
}
