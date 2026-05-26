import * as THREE from 'three';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export class ProceduralController {
  constructor() {
    this.time = 0;
    
    // Anchored Bind Poses
    this.bindPoses = new Map();

    // Saccade & Eye System (Purely Reactive)
    this.saccadeSystem = {
      onSaccadeBlink: null
    };

    this.eyes = {
      targetPitch: 0,
      targetYaw: 0,
      currentPitch: 0,
      currentYaw: 0,
      timeSinceSaccade: 0,
      nextSaccadeIn: 1.0
    };

    // Head Look-At
    this.head = {
      targetPitch: 0,
      targetYaw: 0,
      currentPitch: 0,
      currentYaw: 0
    };
  }

  getSaccadeSystem() {
    return this.saccadeSystem;
  }

  undoAll(bones) {
    // Obsolete: We no longer do additive accumulation. We use anchored bind poses.
  }

  _cacheBindPose(bone) {
    if (!bone) return;
    if (!this.bindPoses.has(bone.name)) {
      this.bindPoses.set(bone.name, bone.quaternion.clone());
    }
  }

  _getBindPose(bone) {
    return this.bindPoses.get(bone.name);
  }

  update(dt, context, headBone, camera) {
    this.time += dt;
    
    const stateStr = context.conversationState || 'IDLE';
    const isSpeaking = stateStr === 'SPEAKING' || stateStr === 'PRE_SPEECH' || stateStr === 'MICRO_PAUSE';

    // 1. Calm Intentional Gaze (Saccades)
    this.eyes.timeSinceSaccade += dt;
    
    const isEngaged = isSpeaking || stateStr === 'LISTENING';
    const saccadeThreshold = isEngaged ? 3.0 : (stateStr === 'STILL_IDLE' ? 6.0 : 1.5);

    if (this.eyes.timeSinceSaccade > this.eyes.nextSaccadeIn) {
      this.eyes.timeSinceSaccade = 0;
      this.eyes.nextSaccadeIn = saccadeThreshold + Math.random() * 3.0;

      if (stateStr === 'THINKING' || stateStr === 'WAITING') {
        this.eyes.targetYaw = (Math.random() > 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.3);
        this.eyes.targetPitch = -0.1 - Math.random() * 0.2;
      } else if (stateStr === 'STILL_IDLE') {
        this.eyes.targetYaw = (Math.random() - 0.5) * 0.02;
        this.eyes.targetPitch = (Math.random() - 0.5) * 0.02;
      } else {
        this.eyes.targetYaw = (Math.random() - 0.5) * 0.05;
        this.eyes.targetPitch = (Math.random() - 0.5) * 0.05;
      }
      
      if (Math.abs(this.eyes.targetYaw) > 0.15 && Math.random() > 0.3) {
        if (this.saccadeSystem.onSaccadeBlink) this.saccadeSystem.onSaccadeBlink();
      }
    }

    // Simple lerp for eyes
    this.eyes.currentPitch = THREE.MathUtils.lerp(this.eyes.currentPitch, this.eyes.targetPitch, dt * 10);
    this.eyes.currentYaw = THREE.MathUtils.lerp(this.eyes.currentYaw, this.eyes.targetYaw, dt * 10);

    // 2. Head Look-At
    // The head gently tracks the eyes, but slower
    this.head.targetPitch = this.eyes.targetPitch * 0.5;
    this.head.targetYaw = this.eyes.targetYaw * 0.6;

    this.head.currentPitch = THREE.MathUtils.lerp(this.head.currentPitch, this.head.targetPitch, dt * 4);
    this.head.currentYaw = THREE.MathUtils.lerp(this.head.currentYaw, this.head.targetYaw, dt * 4);
  }

  applyAll(bones) {
    const safeClamp = (val, min, max) => {
      if (typeof val !== 'number' || Number.isNaN(val)) return 0;
      return THREE.MathUtils.clamp(val, min, max);
    };

    // TEMPORARILY DISABLED PROCEDURAL BONES (Step 3: NUKE Procedural Bones)
    /*
    // Cache bind poses
    if (bones.head) this._cacheBindPose(bones.head);
    if (bones.leftEye) this._cacheBindPose(bones.leftEye);
    if (bones.rightEye) this._cacheBindPose(bones.rightEye);

    // Apply Head Offset (Anchored)
    if (bones.head) {
      const bindPose = this._getBindPose(bones.head);
      if (bindPose) {
        // Strict clamping: Yaw max ±25°, Pitch max ±12°
        const maxPitch = 12 * THREE.MathUtils.DEG2RAD;
        const maxYaw = 25 * THREE.MathUtils.DEG2RAD;
        
        const p = safeClamp(this.head.currentPitch, -maxPitch, maxPitch);
        const y = safeClamp(this.head.currentYaw, -maxYaw, maxYaw);
        
        _euler.set(p, y, 0, 'XYZ');
        _quat.setFromEuler(_euler);
        
        bones.head.quaternion.copy(bindPose).multiply(_quat);
        bones.head.quaternion.normalize();
      }
    }

    // Apply Eye Offset (Anchored)
    if (bones.leftEye && bones.rightEye) {
      const bindPoseL = this._getBindPose(bones.leftEye);
      const bindPoseR = this._getBindPose(bones.rightEye);
      
      if (bindPoseL && bindPoseR) {
        const ep = safeClamp(this.eyes.currentPitch, -0.3, 0.3);
        const ey = safeClamp(this.eyes.currentYaw, -0.4, 0.4);
        
        _euler.set(ep, ey, 0, 'XYZ');
        _quat.setFromEuler(_euler);
        
        bones.leftEye.quaternion.copy(bindPoseL).multiply(_quat);
        bones.leftEye.quaternion.normalize();
        
        bones.rightEye.quaternion.copy(bindPoseR).multiply(_quat);
        bones.rightEye.quaternion.normalize();
      }
    }
    */
  }
}
