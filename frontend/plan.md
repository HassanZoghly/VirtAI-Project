# Surgical Implementation Plan

## Phase 1: Plan
- **Suspected Source:** The robotic standing posture during/after movement is caused by two compounding factors: 
  1) `retargetClipToSpace` mathematically twists `Talk_1`'s upper arms by ~39° on the Y-axis due to flawed `premultiply(delta)` logic applied to misaligned Mixamo/GLB axes.
  2) The native Mixamo FBX baseline holds the arms at ~80° (abducted T-pose width).
- **Target Files:** `src/features/avatar/components/useAvatarAnimations.ts`
- **Runtime Checks:**
  1. Measure `LeftArm`/`RightArm` runtime rotations during `Idle`.
  2. Measure `LeftArm`/`RightArm` runtime rotations during `Talk_1` (movement ON).
  3. Verify transitions do not snap or warp spatially.
- **Success Criteria:** 
  - Arms must be closer to the torso (e.g. ~60° X-axis instead of 80° X-axis).
  - No unnatural Y-axis twists (clavicle tension eliminated).
  - Transitions remain stable and smooth.
- **Rollback Path:** Revert `useAvatarAnimations.ts` to its exact prior state.

## Phase 2: Isolate
- I will first eliminate the destructive `retargetClipToSpace` that twists `Talk_1`.
- I will introduce a `relaxArmPosture(clip)` function that applies a pure, local X-axis rotation (-15° to -20°) strictly to the `LeftArm` and `RightArm` tracks.
- This isolates the fix to *only* the specific joints causing the "arms too far from torso" problem, without affecting the spine, hips, or the mixer logic.

## Phase 3: Implement Minimal Change
1. Remove `retargetClipToSpace(talk1, talk1Space, glbSpace)` call.
2. Add `relaxArmPosture(clip)` which modifies only the `*Arm.quaternion` tracks with a `-15°` local X-axis offset.
3. Apply `relaxArmPosture` to `idle` and `talk1` so they share the exact same relaxed base pose, ensuring perfectly stable transitions.

## Phase 4: Review Change
- Check diff to ensure no stable mixer logic or state management was touched.
- Ensure the math is a pure `premultiply` of a clean local rotation (which was proven safe by `test_drop_arms.js`).

## Phase 5: Verify in App
- I will write a Puppeteer script or use DevTools to inject a listener at `http://localhost:3000/classroom/` that logs the runtime Euler angles of the `LeftArm` bone while `Idle` and `Talk_1` play, proving the arms rest closer to the torso and are untwisted.
