/**
 * Animation loader with automatic retargeting support
 * Handles both Mixamo (direct) and non-Mixamo (retargeted) animations
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { extractBoneNames, needsRetargeting, buildMappingFromJSON, retargetClip } from './retarget';
import { calculateBoneOverlap } from './boneMapping';

// Cache for loaded animations to avoid re-loading
const animationCache = new Map();

// Cache for JSON metadata
const jsonCache = new Map();

/**
 * Load JSON companion file for an animation
 * @param {string} jsonUrl - URL to JSON file
 * @returns {Promise<Object|null>} - JSON data or null if not found
 */
async function loadJSON(jsonUrl) {
  // Check cache first
  if (jsonCache.has(jsonUrl)) {
    return jsonCache.get(jsonUrl);
  }
  
  try {
    const response = await fetch(jsonUrl);
    
    if (!response.ok) {
      // JSON not found - this is normal for Mixamo animations
      if (import.meta.env.DEV) {
        console.debug(`[AnimLoader] No JSON companion found: ${jsonUrl}`);
      }
      jsonCache.set(jsonUrl, null);
      return null;
    }
    
    const jsonData = await response.json();
    jsonCache.set(jsonUrl, jsonData);
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] ✓ Loaded JSON companion: ${jsonUrl}`);
    }
    
    return jsonData;
    
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] Failed to load JSON: ${jsonUrl}`, error.message);
    }
    jsonCache.set(jsonUrl, null);
    return null;
  }
}

/**
 * Load FBX animation file
 * @param {string} fbxUrl - URL to FBX file
 * @returns {Promise<THREE.Group>} - Loaded FBX group
 */
async function loadFBX(fbxUrl) {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader();
    
    loader.load(
      fbxUrl,
      (fbx) => resolve(fbx),
      undefined,
      (error) => reject(error)
    );
  });
}

/**
 * Main animation loader with automatic retargeting
 * 
 * @param {string} name - Animation name (for caching and logging)
 * @param {string} urlFbx - URL to FBX file
 * @param {THREE.Object3D} targetAvatar - Target avatar with skeleton
 * @returns {Promise<THREE.AnimationClip|null>} - Loaded/retargeted clip or null on failure
 */
export async function loadAnimation(name, urlFbx, targetAvatar) {
  // Check cache first
  const cacheKey = `${name}:${urlFbx}`;
  if (animationCache.has(cacheKey)) {
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] ✓ Using cached animation: ${name}`);
    }
    return animationCache.get(cacheKey);
  }
  
  try {
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] Loading animation: ${name} from ${urlFbx}`);
    }
    
    // Step 1: Try to load JSON companion
    const jsonUrl = urlFbx.replace('.fbx', '.json');
    const jsonData = await loadJSON(jsonUrl);
    
    // Step 2: Load FBX
    const fbx = await loadFBX(urlFbx);
    
    // Step 3: Extract animation clip
    if (!fbx.animations || fbx.animations.length === 0) {
      console.error(`[AnimLoader] ✗ No animations found in FBX: ${name}`);
      animationCache.set(cacheKey, null);
      return null;
    }
    
    const sourceClip = fbx.animations[0];
    sourceClip.name = name; // Ensure clip has correct name
    
    // Step 4: Extract bone names from source and target
    const sourceBones = extractBoneNames(fbx);
    const targetBones = extractBoneNames(targetAvatar);
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] Clip: ${sourceClip.name}`);
      console.debug(`[AnimLoader]   Duration: ${sourceClip.duration.toFixed(2)}s`);
      console.debug(`[AnimLoader]   Tracks: ${sourceClip.tracks.length}`);
      console.debug(`[AnimLoader]   Source bones: ${sourceBones.size}`);
      console.debug(`[AnimLoader]   Sample bones: ${Array.from(sourceBones).slice(0, 5).join(', ')}...`);
    }
    
    // Step 5: Determine if retargeting is needed
    const overlap = calculateBoneOverlap(sourceBones, targetBones);
    const requiresRetarget = needsRetargeting(sourceBones, targetBones);
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader]   Overlap ratio: ${(overlap * 100).toFixed(1)}%`);
      console.debug(`[AnimLoader]   Requires retarget: ${requiresRetarget}`);
    }
    
    // Step 6: Apply retargeting if needed
    let finalClip = sourceClip;
    
    if (requiresRetarget) {
      if (!jsonData) {
        console.warn(`[AnimLoader] ⚠️ Retargeting needed but no JSON companion found for: ${name}`);
        console.warn(`[AnimLoader] Animation may not work correctly. Consider adding ${jsonUrl}`);
        // Try to use the clip anyway - might work if bone names are close enough
      }
      
      // Build bone mapping
      const boneMapping = jsonData 
        ? buildMappingFromJSON(jsonData, targetBones)
        : null;
      
      if (boneMapping) {
        if (import.meta.env.DEV) {
          console.debug(`[AnimLoader]   Applying retargeting with ${Object.keys(boneMapping).length} bone mappings...`);
        }
        
        const retargetedClip = retargetClip(targetAvatar, fbx, sourceClip, boneMapping);
        
        if (retargetedClip) {
          finalClip = retargetedClip;
          if (import.meta.env.DEV) {
            console.debug(`[AnimLoader] ✓ Retargeting successful`);
          }
        } else {
          console.warn(`[AnimLoader] ⚠️ Retargeting failed for: ${name}, using original clip`);
        }
      } else {
        console.warn(`[AnimLoader] ⚠️ Could not build bone mapping for: ${name}`);
      }
    } else {
      if (import.meta.env.DEV) {
        console.debug(`[AnimLoader] ✓ Direct Mixamo animation (no retargeting needed)`);
      }
    }
    
    // Step 7: Cache and return
    animationCache.set(cacheKey, finalClip);
    
    if (import.meta.env.DEV) {
      console.debug(`[AnimLoader] ✓ Animation loaded successfully: ${name}`);
    }
    
    return finalClip;
    
  } catch (error) {
    console.error(`[AnimLoader] ✗ Failed to load animation: ${name}`, error.message);
    animationCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Preload multiple animations
 * @param {Array<{name: string, url: string}>} animations - Array of animation configs
 * @param {THREE.Object3D} targetAvatar - Target avatar
 * @returns {Promise<Map<string, THREE.AnimationClip>>} - Map of loaded clips
 */
export async function preloadAnimations(animations, targetAvatar) {
  const results = new Map();
  
  if (import.meta.env.DEV) {
    console.debug(`[AnimLoader] Preloading ${animations.length} animations...`);
  }
  
  for (const { name, url } of animations) {
    const clip = await loadAnimation(name, url, targetAvatar);
    if (clip) {
      results.set(name, clip);
    }
  }
  
  if (import.meta.env.DEV) {
    console.debug(`[AnimLoader] ✓ Preloaded ${results.size}/${animations.length} animations`);
  }
  
  return results;
}

/**
 * Clear animation cache (useful for hot reload during development)
 */
export function clearAnimationCache() {
  animationCache.clear();
  jsonCache.clear();
  if (import.meta.env.DEV) {
    console.debug('[AnimLoader] Cache cleared');
  }
}
