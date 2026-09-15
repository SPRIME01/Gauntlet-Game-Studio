import { trait } from "koota";

/**
 * Stable entity identifier trait.
 * Correlates authoritative game entities across projection adapters.
 * REQ-RUNTIME-001, REQ-RUNTIME-002
 */
export const EntityId = trait({
  id: "",
});

/**
 * Authoritative 3D transform trait.
 * Pure semantic representation (no Three.js Vector3/Quaternion/Matrix4 instances).
 */
export const Transform = trait({
  position: () => [0, 0, 0] as [number, number, number],
  rotation: () => [0, 0, 0, 1] as [number, number, number, number], // [x, y, z, w] quaternion
  scale: () => [1, 1, 1] as [number, number, number],
});

/**
 * Authoritative linear and angular velocity trait.
 */
export const Velocity = trait({
  linear: () => [0, 0, 0] as [number, number, number],
  angular: () => [0, 0, 0] as [number, number, number],
});

/**
 * Render projection handle trait.
 * References visual projection without storing Three.js Object3D/Mesh instances in Koota.
 * REQ-GOAL-003, REQ-RUNTIME-001
 */
export const RenderProjectionHandle = trait({
  handleId: "",
  visible: true,
  castShadow: false,
  receiveShadow: false,
  layer: 0,
});

/**
 * Physics projection handle trait.
 * References physics body without storing Rapier RigidBody instances in Koota.
 */
export const PhysicsProjectionHandle = trait({
  handleId: "",
  bodyType: "dynamic" as "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased",
  mass: 1.0,
  sensor: false,
});

/**
 * Navigation projection handle trait.
 * References navigation agent without storing Recast crowd agent instances in Koota.
 */
export const NavigationProjectionHandle = trait({
  handleId: "",
  radius: 0.5,
  height: 2.0,
  speed: 5.0,
});

/**
 * Audio projection handle trait.
 * References audio emitter without storing Tone/WebAudio nodes in Koota.
 */
export const AudioProjectionHandle = trait({
  handleId: "",
  soundEvent: "",
  playing: false,
  volume: 1.0,
});

/**
 * Asset binding trait.
 * Captures bound asset references and selectively accepted affordances.
 * REQ-RUNTIME-003
 */
export const AssetBinding = trait({
  assetId: "",
  boundSockets: () => ({}) as Record<string, string>,
  activeColliders: () => [] as string[],
  activeDestructionGroups: () => [] as string[],
});

/**
 * Semantic marker traits.
 */
export const PlayerTag = trait({});
export const EnemyTag = trait({});
export const ObstacleTag = trait({});
export const VehicleTag = trait({});
export const ItemTag = trait({});

/**
 * Serialized representation of an entity's semantic state.
 */
export interface SerializedEntityState {
  id: string;
  transform?: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  velocity?: {
    linear: [number, number, number];
    angular: [number, number, number];
  };
  renderHandle?: {
    handleId: string;
    visible: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    layer: number;
  };
  physicsHandle?: {
    handleId: string;
    bodyType: "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";
    mass: number;
    sensor: boolean;
  };
  navHandle?: {
    handleId: string;
    radius: number;
    height: number;
    speed: number;
  };
  assetBinding?: {
    assetId: string;
    boundSockets: Record<string, string>;
    activeColliders: string[];
    activeDestructionGroups: string[];
  };
  tags?: string[];
}

/**
 * Semantic snapshot data structure.
 */
export interface SemanticStateSnapshot {
  version: number;
  timestamp: number;
  entities: SerializedEntityState[];
}
