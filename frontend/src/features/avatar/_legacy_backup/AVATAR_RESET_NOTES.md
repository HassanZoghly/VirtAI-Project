# Avatar Reset Notes

## What was removed

During the ongoing Avatar system refactoring efforts, several legacy systems were removed because they added unnecessary complexity, conflicted with newer controllers, or were no longer used.

1. **Procedural Body Motion (`ProceduralLayers.js`)**: Removed to prevent conflicts with the explicit 3-state body animation FSM in `AvatarAnimationController.js`. The body is now driven entirely by explicit idle and talking clips.
2. **Animation Selector (`animationSelector.js`)**: The softmax/tag-based selection system was over-engineered and caused non-deterministic behavior. It was replaced with a simple round-robin selection in `AvatarAnimationController.js`.
3. **Complex State Machines (`ConversationalStateMachine.js`, `animationStateMachine.js`)**: The 9-state conversational FSM was collapsed into a much simpler 3-state body FSM (`IDLE`, `TALKING_MOVEMENT`, `TALKING_FACE_ONLY`).
4. **Face Compositor (`faceCompositor.js`)**: Dead code that was replaced by `AvatarLipSyncController.js`, which securely composites face and lip-sync morphs.
5. **Realism Enhancements (`useRealismEnhancements.js`)**: Extracted into `AvatarFaceController.js` which natively handles idle micro-expressions, blinks, and emotions.
6. **Avatar Rig Profiles (`avatarRigProfiles.js`)**: Unused mapping that over-complicated avatar loading.

## Current Source of Truth

- **Body Animation**: `AvatarAnimationController.js` owns the `AnimationMixer` and is the exclusive driver of body bones.
- **Facial Animation**: `AvatarLipSyncController.js` composites lip sync and emotion, writing strictly to face morph targets without altering body state.
- **Audio & Speech Continuity**: `AvatarController.jsx` orchestrates `WebAudioQueue` and provides response-level speech state to the animation system, avoiding sentence-by-sentence restarts.
- **Animation Clips**: `animationRegistry.js` is the single source of truth for all idle and talk FBX paths.
