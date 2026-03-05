/**
 * Bone mapping from CC_Base (Character Creator) to Mixamo skeleton
 * This mapping is used for retargeting non-Mixamo animations to Mixamo-style avatars
 */

export const CC_BASE_TO_MIXAMO = {
  // Core
  CC_Base_Hip: 'Hips',
  CC_Base_Pelvis: 'Spine',
  CC_Base_Waist: 'Spine1',
  CC_Base_Spine01: 'Spine2',
  CC_Base_Spine02: 'Spine2', // Some rigs have extra spine
  CC_Base_NeckTwist01: 'Neck',
  CC_Base_NeckTwist02: 'Neck', // Fallback
  CC_Base_Head: 'Head',
  
  // Left Arm
  CC_Base_L_Clavicle: 'LeftShoulder',
  CC_Base_L_Upperarm: 'LeftArm',
  CC_Base_L_Forearm: 'LeftForeArm',
  CC_Base_L_Hand: 'LeftHand',
  
  // Left Hand Fingers
  CC_Base_L_Thumb1: 'LeftHandThumb1',
  CC_Base_L_Thumb2: 'LeftHandThumb2',
  CC_Base_L_Thumb3: 'LeftHandThumb3',
  CC_Base_L_Index1: 'LeftHandIndex1',
  CC_Base_L_Index2: 'LeftHandIndex2',
  CC_Base_L_Index3: 'LeftHandIndex3',
  CC_Base_L_Mid1: 'LeftHandMiddle1',
  CC_Base_L_Mid2: 'LeftHandMiddle2',
  CC_Base_L_Mid3: 'LeftHandMiddle3',
  CC_Base_L_Ring1: 'LeftHandRing1',
  CC_Base_L_Ring2: 'LeftHandRing2',
  CC_Base_L_Ring3: 'LeftHandRing3',
  CC_Base_L_Pinky1: 'LeftHandPinky1',
  CC_Base_L_Pinky2: 'LeftHandPinky2',
  CC_Base_L_Pinky3: 'LeftHandPinky3',
  
  // Right Arm
  CC_Base_R_Clavicle: 'RightShoulder',
  CC_Base_R_Upperarm: 'RightArm',
  CC_Base_R_Forearm: 'RightForeArm',
  CC_Base_R_Hand: 'RightHand',
  
  // Right Hand Fingers
  CC_Base_R_Thumb1: 'RightHandThumb1',
  CC_Base_R_Thumb2: 'RightHandThumb2',
  CC_Base_R_Thumb3: 'RightHandThumb3',
  CC_Base_R_Index1: 'RightHandIndex1',
  CC_Base_R_Index2: 'RightHandIndex2',
  CC_Base_R_Index3: 'RightHandIndex3',
  CC_Base_R_Mid1: 'RightHandMiddle1',
  CC_Base_R_Mid2: 'RightHandMiddle2',
  CC_Base_R_Mid3: 'RightHandMiddle3',
  CC_Base_R_Ring1: 'RightHandRing1',
  CC_Base_R_Ring2: 'RightHandRing2',
  CC_Base_R_Ring3: 'RightHandRing3',
  CC_Base_R_Pinky1: 'RightHandPinky1',
  CC_Base_R_Pinky2: 'RightHandPinky2',
  CC_Base_R_Pinky3: 'RightHandPinky3',
  
  // Left Leg
  CC_Base_L_Thigh: 'LeftUpLeg',
  CC_Base_L_Calf: 'LeftLeg',
  CC_Base_L_Foot: 'LeftFoot',
  CC_Base_L_ToeBase: 'LeftToeBase',
  
  // Right Leg
  CC_Base_R_Thigh: 'RightUpLeg',
  CC_Base_R_Calf: 'RightLeg',
  CC_Base_R_Foot: 'RightFoot',
  CC_Base_R_ToeBase: 'RightToeBase',
};

/**
 * Required bones for a valid humanoid mapping
 * At minimum, we need these bones mapped for animation to work
 */
export const REQUIRED_BONES = [
  'Hips',
  'Spine',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

/**
 * Validate that a bone mapping covers the required bones
 * @param {Object} mapping - Bone name mapping
 * @param {Set<string>} targetBones - Available bones in target skeleton
 * @returns {Object} - { valid: boolean, coverage: number, missing: string[] }
 */
export function validateMapping(mapping, targetBones) {
  const mappedTargetBones = new Set(Object.values(mapping));
  const missing = [];
  let covered = 0;

  for (const requiredBone of REQUIRED_BONES) {
    if (mappedTargetBones.has(requiredBone) && targetBones.has(requiredBone)) {
      covered++;
    } else {
      missing.push(requiredBone);
    }
  }

  const coverage = covered / REQUIRED_BONES.length;
  const valid = coverage >= 0.8; // At least 80% coverage

  return { valid, coverage, missing };
}

/**
 * Calculate overlap ratio between source and target bone names
 * @param {Set<string>} sourceBones - Bone names from source animation
 * @param {Set<string>} targetBones - Bone names from target skeleton
 * @returns {number} - Overlap ratio (0-1)
 */
export function calculateBoneOverlap(sourceBones, targetBones) {
  let matches = 0;
  for (const bone of sourceBones) {
    if (targetBones.has(bone)) {
      matches++;
    }
  }
  return sourceBones.size > 0 ? matches / sourceBones.size : 0;
}
