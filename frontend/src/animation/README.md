# Animation System with Retargeting

A robust animation loading system that supports both Mixamo and non-Mixamo animations with automatic retargeting.

## Features

- ✅ **Automatic retargeting** - Detects if animation needs retargeting based on bone name overlap
- ✅ **JSON companion support** - Loads metadata from `.json` files for non-Mixamo animations
- ✅ **Bone mapping** - CC_Base to Mixamo skeleton mapping
- ✅ **Caching** - Avoids re-loading animations
- ✅ **State management** - Smooth cross-fading between animation states
- ✅ **Fallback handling** - Gracefully falls back to Idle on errors
- ✅ **Production-ready** - Async loading, error handling, logging

## Architecture

```
animationLoader.js          - Main loader with retargeting logic
  ├─ retarget.js            - Retargeting utilities
  ├─ boneMapping.js         - CC_Base → Mixamo bone mappings
  └─ AnimationStateController.js - State machine with cross-fading
```

## Usage

### Basic Example

```javascript
import { loadAnimation } from './animation/animationLoader';
import { AnimationStateController, AnimationState } from './animation/AnimationStateController';

// Load animations
const idleClip = await loadAnimation('IDLE', '/models/animations/Idle/Idle.fbx', avatarScene);
const talkClip = await loadAnimation('TALK', '/models/animations/Talk/Talk.fbx', avatarScene);

// Create controller
const mixer = new THREE.AnimationMixer(avatarScene);
const clips = new Map([
  ['IDLE', idleClip],
  ['TALK', talkClip],
]);

const controller = new AnimationStateController(mixer, clips);
controller.start(); // Start with IDLE

// Transition to TALK when speaking
controller.transitionTo(AnimationState.TALK);

// Update in render loop
function animate(deltaTime) {
  controller.update(deltaTime);
}
```

### React Three Fiber Example

See `ExampleAvatarWithRetargeting.jsx` for a complete example.

## Animation Types

### Mixamo Animations (Direct)
- No JSON companion needed
- Bone names match directly (Hips, Spine, LeftArm, etc.)
- Example: Idle.fbx, Greeting.fbx

### Non-Mixamo Animations (Retargeted)
- Requires JSON companion file (same basename)
- Uses CC_Base bone names (CC_Base_Hip, CC_Base_L_Upperarm, etc.)
- Example: Talk.fbx + Talk.json

## File Structure

```
/models/animations/
  ├─ Idle/
  │   └─ Idle.fbx              (Mixamo - direct)
  ├─ Greeting/
  │   └─ Greeting.fbx          (Mixamo - direct)
  └─ Talk/
      ├─ Talk.fbx              (Non-Mixamo - needs retarget)
      └─ Talk.json             (Companion metadata)
```

## JSON Companion Format

```json
{
  "bones": [
    { "name": "CC_Base_Hip", "parent": -1 },
    { "name": "CC_Base_Pelvis", "parent": 0 },
    ...
  ],
  "skeleton": {
    "bones": [...]
  }
}
```

The JSON file should contain bone hierarchy information. The loader will detect CC_Base bones and apply the appropriate mapping.

## Bone Mapping

The system includes a comprehensive CC_Base → Mixamo mapping:

```javascript
CC_Base_Hip → Hips
CC_Base_Pelvis → Spine
CC_Base_L_Upperarm → LeftArm
CC_Base_R_Upperarm → RightArm
// ... and more
```

See `boneMapping.js` for the complete mapping.

## Retargeting Logic

1. **Load FBX** - Load animation file
2. **Check for JSON** - Look for companion `.json` file
3. **Extract bones** - Get bone names from source and target
4. **Calculate overlap** - Compare bone name similarity
5. **Decide retargeting**:
   - If overlap >= 60%: Use animation directly (Mixamo)
   - If overlap < 60%: Apply retargeting (non-Mixamo)
6. **Apply mapping** - Rename bones using CC_Base → Mixamo mapping
7. **Retarget clip** - Use SkeletonUtils.retargetClip
8. **Cache result** - Store for future use

## State Machine

```
IDLE ←→ TALK
  ↓      ↑
GREETING ↓
  ↓      ↑
THINK ←→ IDLE
```

All transitions use smooth cross-fading (0.15s fade in/out).

## Error Handling

- Missing FBX: Returns null, caller should fallback to IDLE
- Missing JSON: Warns but attempts to use animation anyway
- Retargeting failure: Falls back to original clip
- Invalid mapping: Warns about coverage but continues
- All errors are logged with context

## Performance

- **Caching**: Animations loaded once and cached
- **Async loading**: Non-blocking UI
- **Lazy loading**: Load animations on-demand
- **Memory**: ~1-5MB per animation clip

## Development

Enable detailed logging by running in development mode:

```javascript
// Logs include:
// - Animation loading progress
// - Bone overlap ratios
// - Retargeting decisions
// - Mapping coverage
// - State transitions
```

## Troubleshooting

### Animation doesn't play
- Check console for loading errors
- Verify FBX file path is correct
- Ensure avatar skeleton is loaded

### Animation looks wrong
- Check bone overlap ratio (should be >60% for direct, <60% for retarget)
- Verify JSON companion exists for non-Mixamo animations
- Check mapping coverage (should be >80%)

### Sliding feet / floating
- Adjust retargeting options in `retarget.js`
- Try `preserveHipPosition: true`
- Check if animation has root motion

## API Reference

### loadAnimation(name, urlFbx, targetAvatar)
Loads and optionally retargets an animation.

**Parameters:**
- `name` (string) - Animation name for caching
- `urlFbx` (string) - URL to FBX file
- `targetAvatar` (THREE.Object3D) - Target avatar with skeleton

**Returns:** `Promise<THREE.AnimationClip|null>`

### AnimationStateController
Manages animation states with cross-fading.

**Methods:**
- `transitionTo(state, force)` - Transition to new state
- `start()` - Start with IDLE state
- `update(deltaTime)` - Update mixer (call every frame)
- `getCurrentState()` - Get current state
- `hasState(state)` - Check if state is available
- `stopAll()` - Stop all animations
- `dispose()` - Cleanup

## License

Part of the AI Avatar Chat project.
