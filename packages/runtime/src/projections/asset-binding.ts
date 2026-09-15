import type { Entity } from "koota";
import { AssetBinding } from "../state/traits";

/**
 * Raw affordance manifest exposed by an asset (e.g. from glTF / Blender / 3dviz).
 * REQ-RUNTIME-003
 */
export interface RawAssetAffordanceManifest {
  assetId: string;
  nodes?: Array<{ name: string; position?: [number, number, number]; rotation?: [number, number, number, number] }>;
  sockets?: Array<{ name: string; position: [number, number, number]; rotation?: [number, number, number, number] }>;
  colliders?: Array<{ name: string; type: "box" | "sphere" | "capsule" | "trimesh"; dimensions: number[] }>;
  destructionGroups?: string[];
  rigs?: Array<{ name: string; boneCount: number }>;
}

/**
 * Explicit game model binding specification.
 * Dictates which raw asset affordances are promoted to authoritative gameplay semantics.
 */
export interface GameBindingSpecification {
  acceptedSockets?: Record<string, string>; // assetSocketName -> semanticSlotName
  acceptedColliders?: string[]; // collider names promoted to gameplay colliders
  acceptedDestructionGroups?: string[]; // destruction group names promoted
}

export interface BoundAffordanceResult {
  assetId: string;
  boundSockets: Record<string, string>;
  activeColliders: string[];
  activeDestructionGroups: string[];
  inertAffordances: {
    unboundSockets: string[];
    unboundColliders: string[];
    unboundNodes: string[];
    unboundDestructionGroups: string[];
  };
}

/**
 * AssetAffordanceFilter enforces that raw asset affordances (sockets, colliders, nodes, rigs)
 * do NOT automatically become game semantics until explicitly bound by the game model.
 * Implements REQ-RUNTIME-003.
 */
export class AssetAffordanceFilter {
  /**
   * Filters and binds raw asset affordances according to explicit game binding specifications.
   */
  public static filterAffordances(
    raw: RawAssetAffordanceManifest,
    binding: GameBindingSpecification
  ): BoundAffordanceResult {
    const rawSockets = raw.sockets || [];
    const rawColliders = raw.colliders || [];
    const rawNodes = raw.nodes || [];
    const rawDestruction = raw.destructionGroups || [];

    const boundSockets: Record<string, string> = {};
    const unboundSockets: string[] = [];

    const requestedSockets = binding.acceptedSockets || {};
    for (const socket of rawSockets) {
      if (requestedSockets[socket.name]) {
        boundSockets[socket.name] = requestedSockets[socket.name];
      } else {
        unboundSockets.push(socket.name);
      }
    }

    const requestedColliders = new Set(binding.acceptedColliders || []);
    const activeColliders: string[] = [];
    const unboundColliders: string[] = [];

    for (const collider of rawColliders) {
      if (requestedColliders.has(collider.name)) {
        activeColliders.push(collider.name);
      } else {
        unboundColliders.push(collider.name);
      }
    }

    const requestedDestruction = new Set(binding.acceptedDestructionGroups || []);
    const activeDestructionGroups: string[] = [];
    const unboundDestructionGroups: string[] = [];

    for (const dg of rawDestruction) {
      if (requestedDestruction.has(dg)) {
        activeDestructionGroups.push(dg);
      } else {
        unboundDestructionGroups.push(dg);
      }
    }

    const unboundNodes = rawNodes.map(n => n.name);

    return {
      assetId: raw.assetId,
      boundSockets,
      activeColliders,
      activeDestructionGroups,
      inertAffordances: {
        unboundSockets,
        unboundColliders,
        unboundNodes,
        unboundDestructionGroups,
      },
    };
  }

  /**
   * Applies filtered affordances to an authoritative Koota entity.
   */
  public static bindToEntity(
    entity: Entity,
    boundResult: BoundAffordanceResult
  ): void {
    if (entity.has(AssetBinding)) {
      entity.set(AssetBinding, {
        assetId: boundResult.assetId,
        boundSockets: boundResult.boundSockets,
        activeColliders: boundResult.activeColliders,
        activeDestructionGroups: boundResult.activeDestructionGroups,
      });
    } else {
      entity.add(
        AssetBinding({
          assetId: boundResult.assetId,
          boundSockets: boundResult.boundSockets,
          activeColliders: boundResult.activeColliders,
          activeDestructionGroups: boundResult.activeDestructionGroups,
        })
      );
    }
  }
}
