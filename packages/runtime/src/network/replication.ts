/**
 * Replication, interest/relevance filtering, and client reconciliation.
 *
 * Authority rules (REQ-NET-004, REQ-NET-005, REQ-NET-007, REQ-SAFE-006):
 * - Replication projections are derived ONE-WAY from authoritative Koota state.
 *   Nothing in this module mutates the server's authoritative GameWorld.
 * - The client reconciles into a client-side projection GameWorld that is never
 *   semantic authority; authoritative snapshots always win, then unacknowledged
 *   locally-predicted commands are replayed on top (bounded).
 */

import type { SerializedEntityState } from "../state/traits";
import { Transform, Velocity } from "../state/traits";
import type { GameWorld } from "../state/world";
import type { NetworkEnvelope } from "@gauntlet/contracts";

/** Interest/relevance filter over authoritative Koota state (REQ-NET-005). */
export interface InterestFilter {
  /** Returns the stable entity ids relevant for one viewer. */
  selectEntityIds(viewer: InterestViewer): string[];
}

export interface InterestViewer {
  clientId: string;
  entityId: string | null;
  world: GameWorld;
}

/** Sends every networked entity to every client (baseline/no filtering). */
export class AllInterestFilter implements InterestFilter {
  selectEntityIds(viewer: InterestViewer): string[] {
    return viewer.world.getEntityIds();
  }
}

/**
 * Radius relevance: a client receives itself plus entities whose authoritative
 * Transform position lies within `radius` world units of its own position.
 */
export class RadiusInterestFilter implements InterestFilter {
  constructor(private readonly radius: number) {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error("RadiusInterestFilter requires a finite non-negative radius");
    }
  }

  selectEntityIds(viewer: InterestViewer): string[] {
    const ids = viewer.world.getEntityIds();
    if (!viewer.entityId || !viewer.world.hasEntity(viewer.entityId)) {
      // Viewer has no positioned entity yet: only itself is relevant.
      return viewer.entityId ? [viewer.entityId] : [];
    }

    const viewerEntity = viewer.world.getEntity(viewer.entityId);
    const vt = viewerEntity?.get(Transform);
    if (!viewerEntity || !vt) return viewer.entityId ? [viewer.entityId] : [];

    const [vx, vy, vz] = vt.position;
    const relevant: string[] = [viewer.entityId];
    const radiusSq = this.radius * this.radius;

    for (const id of ids) {
      if (id === viewer.entityId) continue;
      const entity = viewer.world.getEntity(id);
      if (!entity || !entity.has(Transform)) continue;
      const t = entity.get(Transform);
      if (!t) continue;
      const dx = t.position[0] - vx;
      const dy = t.position[1] - vy;
      const dz = t.position[2] - vz;
      if (dx * dx + dy * dy + dz * dz <= radiusSq) {
        relevant.push(id);
      }
    }
    return relevant;
  }
}

/**
 * Projects the requested entities from authoritative Koota state into a
 * transport-neutral snapshot body. Read-only over the authoritative world.
 */
export function projectEntities(world: GameWorld, entityIds: string[]): SerializedEntityState[] {
  const out: SerializedEntityState[] = [];
  for (const id of entityIds) {
    const entity = world.getEntity(id);
    if (!entity) continue;
    const state: SerializedEntityState = { id };

    if (entity.has(Transform)) {
      const t = entity.get(Transform);
      if (t) {
        state.transform = {
          position: [...t.position] as [number, number, number],
          rotation: [...t.rotation] as [number, number, number, number],
          scale: [...t.scale] as [number, number, number],
        };
      }
    }
    if (entity.has(Velocity)) {
      const v = entity.get(Velocity);
      if (v) {
        state.velocity = {
          linear: [...v.linear] as [number, number, number],
          angular: [...v.angular] as [number, number, number],
        };
      }
    }
    out.push(state);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client reconciliation
// ---------------------------------------------------------------------------

export interface SnapshotView {
  tick: number;
  entities: Array<Record<string, unknown>>;
  removed_entity_ids: string[];
}

export interface ReconciliationResult {
  appliedEntities: number;
  removedEntities: number;
  replayedCommands: number;
}

/**
 * Applies an authoritative snapshot into the client projection world, then
 * replays at most `maxReplayCommands` unacknowledged client commands on top
 * (client-side prediction). The projection world is never semantic authority.
 */
export function reconcileSnapshot(
  projection: GameWorld,
  snapshot: SnapshotView,
  pendingCommands: NetworkEnvelope[],
  maxReplayCommands = 64
): ReconciliationResult {
  let applied = 0;
  let removed = 0;

  for (const raw of snapshot.entities) {
    const state = raw as unknown as SerializedEntityState;
    if (typeof state?.id !== "string") continue;
    applyEntityState(projection, state);
    applied++;
  }

  for (const id of snapshot.removed_entity_ids) {
    if (projection.despawnEntity(id)) removed++;
  }

  // Bounded replay of unacknowledged prediction (client-authoritative data is
  // applied ONLY to the client projection, never to server authority).
  let replayed = 0;
  for (const envelope of pendingCommands) {
    if (replayed >= maxReplayCommands) break;
    if (envelope.kind !== "cmd.move") continue;
    const payload = envelope.payload as { entity_id?: string; direction?: number[]; speed?: number };
    if (typeof payload.entity_id !== "string" || !Array.isArray(payload.direction)) continue;
    const entity = projection.getEntity(payload.entity_id);
    if (!entity || !entity.has(Transform)) continue;
    const t = entity.get(Transform);
    if (!t) continue;
    const len = Math.hypot(payload.direction[0], payload.direction[1], payload.direction[2]);
    if (!Number.isFinite(len) || len === 0) continue;
    const speed = typeof payload.speed === "number" && Number.isFinite(payload.speed) ? payload.speed : 5;
    const step = (1 / 60) * speed; // one nominal tick of predicted movement
    const pos: [number, number, number] = [
      t.position[0] + (payload.direction[0] / len) * step,
      t.position[1] + (payload.direction[1] / len) * step,
      t.position[2] + (payload.direction[2] / len) * step,
    ];
    entity.set(Transform, { position: pos, rotation: t.rotation, scale: t.scale });
    replayed++;
  }

  return { appliedEntities: applied, removedEntities: removed, replayedCommands: replayed };
}

function applyEntityState(world: GameWorld, state: SerializedEntityState): void {
  const existing = world.getEntity(state.id);
  if (existing) {
    if (state.transform && existing.has(Transform)) {
      const t = existing.get(Transform);
      if (t) {
        existing.set(Transform, {
          position: state.transform.position,
          rotation: state.transform.rotation,
          scale: state.transform.scale,
        });
      }
    }
    if (state.velocity && existing.has(Velocity)) {
      const v = existing.get(Velocity);
      if (v) {
        existing.set(Velocity, {
          linear: state.velocity.linear,
          angular: state.velocity.angular,
        });
      }
    }
    return;
  }

  world.spawnEntity({
    id: state.id,
    transform: state.transform,
    velocity: state.velocity,
    tags: state.tags as ("player" | "enemy" | "obstacle" | "vehicle" | "item")[] | undefined,
  });
}
