/**
 * Blackwater Relay — Rapier physics projections (T22).
 *
 * Bodies are execution projections created through the runtime RapierPhysicsAdapter.
 * The adapter is stepped EXACTLY ONCE per authoritative tick by the single simulation
 * scheduler (REQ-RUNTIME-006); these helpers only construct and move bodies. Body poses
 * are read BACK into Koota by the game systems (authority absorption); no gameplay
 * decision is ever read from a render or physics object directly.
 */

import type RAPIER from "@dimforge/rapier3d-compat";
import type { RapierPhysicsAdapter } from "@gauntlet/runtime";
import { GATE_HALF_EXTENTS, OBSTACLE_HALF_EXTENTS } from "./state";

export interface GameBodies {
  rover: RAPIER.RigidBody | null;
  gate: RAPIER.RigidBody | null;
  obstacle: RAPIER.RigidBody | null;
}

export function createRoverBody(adapter: RapierPhysicsAdapter, spawn: [number, number, number]): RAPIER.RigidBody {
  const desc = adapter.rapier.RigidBodyDesc.dynamic()
    .setTranslation(spawn[0], spawn[1], spawn[2])
    .setLinearDamping(0.6)
    .setAngularDamping(1.0);
  const body = adapter.world.createRigidBody(desc);
  const collider = adapter.rapier.ColliderDesc.cuboid(1.1, 0.5, 1.6).setMass(220);
  adapter.world.createCollider(collider, body);
  return body;
}

export function createGateBody(adapter: RapierPhysicsAdapter, closedCenter: [number, number, number]): RAPIER.RigidBody {
  const desc = adapter.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
    closedCenter[0],
    closedCenter[1],
    closedCenter[2]
  );
  const body = adapter.world.createRigidBody(desc);
  const collider = adapter.rapier.ColliderDesc.cuboid(
    GATE_HALF_EXTENTS[0],
    GATE_HALF_EXTENTS[1],
    GATE_HALF_EXTENTS[2]
  );
  adapter.world.createCollider(collider, body);
  return body;
}

export function createObstacleBody(adapter: RapierPhysicsAdapter, center: [number, number, number]): RAPIER.RigidBody {
  const desc = adapter.rapier.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]);
  const body = adapter.world.createRigidBody(desc);
  const collider = adapter.rapier.ColliderDesc.cuboid(
    OBSTACLE_HALF_EXTENTS[0],
    OBSTACLE_HALF_EXTENTS[1],
    OBSTACLE_HALF_EXTENTS[2]
  );
  adapter.world.createCollider(collider, body);
  return body;
}

export function removeBody(adapter: RapierPhysicsAdapter, body: RAPIER.RigidBody | null): void {
  if (body) {
    adapter.world.removeRigidBody(body);
  }
}
