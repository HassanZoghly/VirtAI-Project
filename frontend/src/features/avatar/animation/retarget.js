/**
 * Animation retargeting utilities
 * Handles retargeting animations from CC_Base skeleton to Mixamo skeleton
 */

import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CC_BASE_TO_MIXAMO, validateMapping } from './boneMapping';

/**
 * Extract all bone names from a skeleton or object hierarchy
 * @param {THREE.Object3D} root - Root object to traverse
 * @returns {Set<string>} - Set of bone names
 */
export function extractBoneNames(root) {
  const boneNames = new Set();
  
  root.traverse((obj) => {
    if (obj.isBone || obj.type === 'Bone') {
      boneNames.add(obj.name);
    }
  });
  
  return boneNames;
}

/**
 * Filter animation tracks to remove invalid bone references
 * This prevents PropertyBinding errors for bones that don't exist in target skeleton
 * 
 * @param {THREE.AnimationClip} clip - Animation clip to filter
 * @param {Set<string>} targetBones - Valid bone names in target skeleton
 * @returns {THREE.AnimationClip} - Filtered clip
 */
export function filterInvalidTracks(clip, targetBones) {
  const validTracks = [];
  const removedTracks = [];
  
  for (const track of clip.tracks) {
    // Extract bone name from track name (format: "boneName.property")
    const boneName = track.name.split('.')[0];
    
    if (targetBones.has(boneName)) {
      validTracks.push(track);
    } else {
      removedTracks.push(boneName);
    }
  }
  
  if (removedTracks.length > 0 && import.meta.env.DEV) {
    console.debug(`[Retarget] Filtered ${removedTracks.length} invalid tracks`);
    const uniqueRemoved = [...new Set(removedTracks)];
    console.debug(`[Retarget] Removed bones: ${uniqueRemoved.slice(0, 10).join(', ')}${uniqueRemoved.length > 10 ? '...' : ''}`);
  }
  
  // Create new clip with only valid tracks
  const filteredClip = clip.clone();
  filteredClip.tracks = validTracks;
  
  return filteredClip;
}

/**
 * Create a renamed clone of a skeleton hierarchy for retargeting
 * This is a version-agnostic approach that works with any Three.js version
 * 
 * @param {THREE.Object3D} sourceRoot - Source rig root
 * @param {Object} boneMapping - Mapping from source bone names to target bone names
 * @returns {THREE.Object3D} - Cloned and renamed hierarchy
 */
export function createRenamedProxy(sourceRoot, boneMapping) {
  const clone = sourceRoot.clone(true);
  
  let renamedCount = 0;
  
  // Traverse and rename bones according to mapping
  clone.traverse((obj) => {
    if (obj.isBone || obj.type === 'Bone') {
      const mappedName = boneMapping[obj.name];
      if (mappedName) {
        if (import.meta.env.DEV) {
          console.debug(`[Retarget] Renaming bone: ${obj.name} → ${mappedName}`);
        }
        obj.name = mappedName;
        renamedCount++;
      }
    }
  });
  
  if (import.meta.env.DEV) {
    console.debug(`[Retarget] Renamed ${renamedCount} bones`);
  }
  
  return clone;
}

/**
 * Retarget an animation clip from source skeleton to target skeleton
 * 
 * @param {THREE.Object3D} targetAvatar - Target avatar with Mixamo skeleton
 * @param {THREE.Object3D} sourceRoot - Source rig root (from FBX)
 * @param {THREE.AnimationClip} sourceClip - Source animation clip
 * @param {Object} boneMapping - Bone name mapping (CC_Base → Mixamo)
 * @param {Set<string>} targetBones - Valid bone names in target skeleton
 * @returns {THREE.AnimationClip|null} - Retargeted clip or null on failure
 */
export function retargetClip(targetAvatar, sourceRoot, sourceClip, boneMapping, targetBones) {
  try {
    // Create renamed proxy of source rig
    const renamedProxy = createRenamedProxy(sourceRoot, boneMapping);
    
    // Options for retargeting
    const options = {
      useFirstFramePosition: true,
      preserveHipPosition: true,
      preservePosition: false,
    };
    
    // Attempt retargeting using SkeletonUtils
    const retargetedClip = SkeletonUtils.retargetClip(
      targetAvatar,
      renamedProxy,
      sourceClip,
      options
    );
    
    if (!retargetedClip) {
      console.warn('[Retarget] SkeletonUtils.retargetClip returned null');
      return null;
    }
    
    // Preserve original clip name
    retargetedClip.name = sourceClip.name;
    
    // Filter out invalid tracks to prevent PropertyBinding errors
    const filteredClip = filterInvalidTracks(retargetedClip, targetBones);
    
    if (import.meta.env.DEV) {
      console.debug(`[Retarget] ✓ Successfully retargeted clip: ${sourceClip.name}`);
      console.debug(`[Retarget]   Duration: ${filteredClip.duration.toFixed(2)}s`);
      console.debug(`[Retarget]   Tracks: ${filteredClip.tracks.length} (filtered from ${retargetedClip.tracks.length})`);
    }
    
    return filteredClip;
    
  } catch (error) {
    console.error('[Retarget] Failed to retarget clip:', error.message);
    return null;
  }
}

/**
 * Determine if retargeting is needed by comparing bone name overlap
 * 
 * @param {Set<string>} sourceBones - Bone names from source animation
 * @param {Set<string>} targetBones - Bone names from target skeleton
 * @param {number} threshold - Overlap threshold (default 0.6 = 60%)
 * @returns {boolean} - True if retargeting is needed
 */
export function needsRetargeting(sourceBones, targetBones, threshold = 0.6) {
  let matches = 0;
  
  for (const bone of sourceBones) {
    if (targetBones.has(bone)) {
      matches++;
    }
  }
  
  const overlap = sourceBones.size > 0 ? matches / sourceBones.size : 0;
  
  if (import.meta.env.DEV) {
    console.debug(`[Retarget] Bone overlap: ${(overlap * 100).toFixed(1)}% (${matches}/${sourceBones.size})`);
    console.debug(`[Retarget] Needs retargeting: ${overlap < threshold}`);
  }
  
  return overlap < threshold;
}

/**
 * Build bone mapping from JSON metadata
 * 
 * @param {Object} jsonData - JSON metadata from companion file
 * @param {Set<string>} targetBones - Available bones in target skeleton
 * @returns {Object|null} - Bone mapping or null if invalid
 */
export function buildMappingFromJSON(jsonData, targetBones) {
  try {
    // Check if JSON contains CC_Base bones
    const bones = jsonData.bones || jsonData.skeleton?.bones || [];
    const hasCCBase = bones.some(bone => 
      bone.name && bone.name.startsWith('CC_Base_')
    );
    
    if (!hasCCBase) {
      if (import.meta.env.DEV) {
        console.debug('[Retarget] JSON does not contain CC_Base bones, using default mapping');
      }
    }
    
    // Use default CC_Base mapping
    const mapping = { ...CC_BASE_TO_MIXAMO };
    
    // Validate mapping coverage
    const validation = validateMapping(mapping, targetBones);
    
    if (import.meta.env.DEV) {
      console.debug(`[Retarget] Mapping coverage: ${(validation.coverage * 100).toFixed(1)}%`);
      if (validation.missing.length > 0) {
        console.debug(`[Retarget] Missing bones: ${validation.missing.join(', ')}`);
      }
    }
    
    if (!validation.valid) {
      console.warn('[Retarget] Mapping coverage too low, may result in poor animation quality');
    }
    
    return mapping;
    
  } catch (error) {
    console.error('[Retarget] Failed to build mapping from JSON:', error.message);
    return null;
  }
}
