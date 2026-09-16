/**
 * Field transceiver — procedural Three.js reconstruction (T14).
 *
 * Produced through the AgentHandoff lifecycle for
 * `asset.reconstruct.reference-image` / `agent-skill.img2threejs`:
 * prepare (reference validated) -> interactive agent authoring (this file) ->
 * accept -> deterministic offline verify-result.
 *
 * Boundaries held by this module:
 *  - It imports ONLY the single pinned `three` specifier; no network APIs, no
 *    gameplay/state imports (affordances are recorded metadata, never auto-
 *    promoted gameplay semantics).
 *  - Geometry is pure Three.js (no renderer/DOM), so deterministic offline
 *    verification can instantiate it headlessly.
 *  - Named nodes, sockets, and collider declarations are structural metadata
 *    for the AssetRecord; the game owns any semantics separately.
 */

import * as THREE from "three";

export const ASSET_MODULE_META = {
  schema: "gauntlet.asset.procedural_module",
  id: "field-transceiver",
  version: 1,
  three_import: "three",
  factory: "createFieldTransceiver",
  reference_evidence: {
    method: "silhouette_grid_8x8_iou",
    reference: "references/field-transceiver/reference.png",
    reference_sha256: "b615ea171c65d5acfcc349121c34f9da2f02c8dd6ec21f94daf1a5722af4022f",
    similarity: 0.8696,
  },
  affordances: {
    named_nodes: [
      "transceiver-body",
      "transceiver-panel",
      "antenna-mast",
      "antenna-tip",
      "mount-foot-left",
      "mount-foot-right",
      "socket-power",
      "socket-antenna",
      "collider-body",
    ],
    sockets: {
      "socket-power": { node: "socket-power", kind: "attachment", note: "power line attach point on body flank" },
      "socket-antenna": { node: "socket-antenna", kind: "attachment", note: "antenna mast mount point" },
    },
    colliders: [{ node: "collider-body", shape: "box" }],
  },
} as const;

/** Front-of-body face material detail is procedural; colors are placeholder paint. */
export function createFieldTransceiver(): THREE.Group {
  const root = new THREE.Group();
  root.name = "field-transceiver";

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7, metalness: 0.2 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.85, metalness: 0.05 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.4, metalness: 0.6 });

  // Body — main radio chassis.
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 1.6), bodyMaterial);
  body.name = "transceiver-body";
  body.position.set(0, 1.4, 0);
  root.add(body);

  // Front panel — speaker/dial detail slightly proud of the chassis.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), darkMaterial);
  panel.name = "transceiver-panel";
  panel.position.set(-0.5, 1.4, 0.85);
  root.add(panel);

  // Antenna mast + cap.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 12), metalMaterial);
  mast.name = "antenna-mast";
  mast.position.set(0, 2.7, 0);
  root.add(mast);

  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.04, 0.2, 8), darkMaterial);
  tip.name = "antenna-tip";
  tip.position.set(0, 3.5, 0);
  root.add(tip);

  // Mount feet.
  const footLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.6), darkMaterial);
  footLeft.name = "mount-foot-left";
  footLeft.position.set(-1.35, 0.7, 0);
  root.add(footLeft);

  const footRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.6), darkMaterial);
  footRight.name = "mount-foot-right";
  footRight.position.set(1.35, 0.7, 0);
  root.add(footRight);

  // Sockets — attachment points recorded as AssetRecord affordance metadata.
  const socketPower = new THREE.Object3D();
  socketPower.name = "socket-power";
  socketPower.position.set(1.6, 1.4, 0.3);
  root.add(socketPower);

  const socketAntenna = new THREE.Object3D();
  socketAntenna.name = "socket-antenna";
  socketAntenna.position.set(0, 2.05, 0);
  root.add(socketAntenna);

  // Collider declaration — structural metadata only; the game/runtime owns any
  // physics semantics. Not a mesh, so it adds no geometry or triangles.
  const colliderBody = new THREE.Object3D();
  colliderBody.name = "collider-body";
  colliderBody.userData = {
    collider: { shape: "box", size: [3.4, 1.4, 1.8], offset: [0, 1.4, 0] },
  };
  root.add(colliderBody);

  return root;
}
