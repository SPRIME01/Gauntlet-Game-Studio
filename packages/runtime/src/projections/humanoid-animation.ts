import * as THREE from "three";

/**
 * Visual-only humanoid animation. Game logic (Koota) owns the motion state and
 * the character's world position; this class owns no gameplay transitions.
 */
import { HumanoidMotion, type HumanoidMotionState } from "../state/traits";
import type { GameWorld } from "../state/world";
export type { HumanoidMotionState } from "../state/traits";

export const HUMANOID_CLIP_MAP: Readonly<Record<HumanoidMotionState, readonly string[]>> = {
  idle: ["Idle_Loop"],
  walk: ["Walk_Loop", "Walk_Formal_Loop"],
  run: ["Jog_Fwd_Loop", "Sprint_Loop"],
  sprint: ["Sprint_Loop", "Jog_Fwd_Loop"],
  crouch: ["Crouch_Fwd_Loop", "Crouch_Idle_Loop"],
  "jump-start": ["Jump_Start", "NinjaJump_Start"],
  "jump-air": ["Jump_Loop", "NinjaJump_Idle_Loop"],
  "jump-land": ["Jump_Land", "NinjaJump_Land"],
  swim: ["Swim_Fwd_Loop"],
  "swim-idle": ["Swim_Idle_Loop"],
  punch: ["Punch_Jab", "Punch_Cross", "Melee_Hook"],
  "sword-attack": ["Sword_Attack", "Sword_Regular_A", "Sword_Heavy_Combo"],
  "sword-block": ["Sword_Block", "Idle_Shield_Loop"],
  push: ["Push_Loop"],
  climb: ["ClimbUp_1m"],
  interact: ["Interact"],
  death: ["Death01"],
};

const LOOPING = new Set<HumanoidMotionState>([
  "idle", "walk", "run", "sprint", "crouch", "jump-air", "swim", "swim-idle", "push", "sword-block",
]);

export interface HumanoidMotionSample {
  /** Koota-owned semantic motion state; this object is a read-only projection input. */
  state: HumanoidMotionState;
  /** Playback rate multiplier; does NOT move the authoritative entity. */
  rate?: number;
  /** Monotonically increasing request counter owned by game logic; defaults to zero. */
  trigger?: number;
}

export interface HumanoidAnimationOptions {
  model: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
  /** Must be false until root-motion displacement is reconciled through Koota/Rapier. */
  rootMotion?: boolean;
  transitionSeconds?: number;
  /** Validated catalog's joint-hash; useful for caller-side compatibility proof. */
  skeletonSignature?: string;
}

export interface HumanoidAnimationObservation {
  state: HumanoidMotionState | null;
  clip: string | null;
  time: number;
  rootMotion: false;
  skeletonSignature: string | null;
}

/** Single mixer/projector per skinned model instance (never a shared SkinnedMesh). */
export class HumanoidAnimationProjector {
  public readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly fade: number;
  private readonly skeletonSignature: string | null;
  private state: HumanoidMotionState | null = null;
  private active: THREE.AnimationAction | null = null;
  private activeClip: string | null = null;
  private elapsed = 0;
  private trigger = 0;

  constructor(options: HumanoidAnimationOptions) {
    if (options.rootMotion === true) {
      throw new Error("ROOT_MOTION_NOT_AUTHORITATIVE: root-motion clips require an explicit Koota/Rapier integration");
    }
    if (!options.model) throw new Error("Humanoid animation requires a model");
    this.fade = options.transitionSeconds ?? 0.18;
    if (!Number.isFinite(this.fade) || this.fade < 0) throw new Error("Invalid animation blend time");
    this.skeletonSignature = options.skeletonSignature ?? null;
    this.mixer = new THREE.AnimationMixer(options.model);
    for (const clip of options.clips) {
      if (this.actions.has(clip.name)) throw new Error("Duplicate humanoid clip: " + clip.name);
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    if (!this.actions.has("Idle_Loop")) {
      throw new Error("Missing mandatory Idle_Loop foundation clip");
    }
  }

  available(state: HumanoidMotionState): boolean {
    return HUMANOID_CLIP_MAP[state].some(name => this.actions.has(name));
  }

  /** Called AFTER the authoritative game step. No entity/physics mutation occurs. */
  update(sample: Readonly<HumanoidMotionSample>, dt: number): HumanoidAnimationObservation {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error("Invalid animation frame delta");
    const rate = sample.rate ?? 1;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid animation playback rate");
    const candidates = HUMANOID_CLIP_MAP[sample.state];
    if (!candidates) throw new Error("Unknown authoritative humanoid motion state: " + sample.state);
    const nextName = candidates.find(name => this.actions.has(name));
    if (!nextName) throw new Error("No compatible clip for motion state: " + sample.state);
    const trigger = sample.trigger ?? 0;
    if (this.state !== sample.state || this.activeClip !== nextName ||
        (!LOOPING.has(sample.state) && trigger !== this.trigger)) {
      const next = this.actions.get(nextName)!;
      next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.setLoop(LOOPING.has(sample.state) ? THREE.LoopRepeat : THREE.LoopOnce, LOOPING.has(sample.state) ? Infinity : 1);
      next.clampWhenFinished = !LOOPING.has(sample.state);
      next.play();
      if (this.active && this.active !== next) {
        if (this.fade > 0) this.active.crossFadeTo(next, this.fade, false);
        else this.active.stop();
      }
      this.active = next;
      this.activeClip = nextName;
      this.state = sample.state;
      this.elapsed = 0;
    }
    this.trigger = trigger;
    this.active!.setEffectiveTimeScale(Math.max(0.1, Math.min(rate, 3)));
    this.mixer.update(dt);
    this.elapsed += dt;
    return this.observe();
  }

  /** Authoritative ECS adapter. Mesh animations can NEVER overwrite the input trait. */
  updateFromWorld(world: GameWorld, entityId: string, dt: number): HumanoidAnimationObservation {
    const motion = world.getEntity(entityId)?.get(HumanoidMotion);
    if (!motion) throw new Error("No authoritative HumanoidMotion trait for entity " + entityId);
    return this.update({ state: motion.state, rate: motion.rate, trigger: motion.trigger }, dt);
  }

  observe(): HumanoidAnimationObservation {
    return {
      state: this.state, clip: this.activeClip, time: this.elapsed,
      rootMotion: false, skeletonSignature: this.skeletonSignature,
    };
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.actions.clear();
    this.active = null;
    this.activeClip = null;
    this.state = null;
  }
}
