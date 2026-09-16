import * as fs from "node:fs";
import * as path from "node:path";
import { validateAssetRecord, validateCapabilityResult, type CapabilityResult } from "@gauntlet/contracts";
import type {
  NormalizedWorldComposition,
  VerifyWorldCompositionOptions,
  WorldVerificationCheck,
  WorldVerificationReport,
} from "./types";
import {
  THREEVIZ_PROVIDER,
  THREEVIZ_SKILL_ID,
  WORLD_COMPOSITION_RESULT_SCHEMA,
  WORLD_ENVIRONMENT_COMPOSE_CAPABILITY,
} from "./types";

/**
 * Thrown when a world-composition handoff output claims authority outside its boundary:
 * terrain elevation, navigation/navmesh, physics, or specific depicted-object reconstruction.
 * AGENTS.md §6: terrain generation, navigation, and reference reconstruction remain separate
 * capabilities; the studio director owns routing.
 */
export class WorldCompositionAuthorityError extends Error {
  public readonly code = "WORLD_COMPOSITION_AUTHORITY_VIOLATION";
  constructor(
    public readonly violation: "terrain_authority" | "navigation_authority" | "physics_authority" | "object_reconstruction",
    message: string,
    public readonly redirect_capability?: string
  ) {
    super(message);
    this.name = "WorldCompositionAuthorityError";
  }
}

/** Route fragments that denote the separate reference-reconstruction capability. */
const RECONSTRUCTION_ROUTE_PATTERN = /img2threejs|reconstruct/i;

/**
 * Routing boundary for TEETH-T15-001 (REQ-BIND-005): a request to reconstruct one specific
 * depicted object/character (e.g. a depicted transceiver from reference imagery) must NEVER
 * travel the world-composition route. Throws with a redirect to the reference-reconstruction
 * capability so the studio director can re-route (asset.reconstruct / img2threejs).
 */
export function assertWorldCompositionIntentBoundary(intent: string): void {
  if (RECONSTRUCTION_ROUTE_PATTERN.test(intent)) {
    throw new WorldCompositionAuthorityError(
      "object_reconstruction",
      `Intent '${intent.slice(0, 160)}' asks for specific depicted-object reconstruction through the world-composition route; routing rejects it and redirects to the reference-reconstruction capability`,
      "asset.reconstruct"
    );
  }
}

/** Deep-scanned keys that would embed competing terrain/navigation/physics authority in composition output. */
const FORBIDDEN_AUTHORITY_KEYS = [
  "terrain_heights",
  "terrain_elevation",
  "elevation_grid",
  "elevations",
  "heightfield_data",
  "heightfield_heights",
  "terrain_mesh",
  "navmesh",
  "navmesh_data",
  "nav_mesh",
  "recast_geo",
  "physics_bodies",
  "physics_source",
];

const CREDENTIAL_KEY_PATTERN = /(api[_-]?key|secret|credential|password|^token$|auth[_-]?token|access[_-]?token)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`World composition output field '${field}' must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`World composition output field '${field}' must be a finite number`);
  }
  return value;
}

function requireInt(value: unknown, field: string): number {
  const n = requireNumber(value, field);
  if (!Number.isInteger(n)) {
    throw new Error(`World composition output field '${field}' must be an integer`);
  }
  return n;
}

function requireBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`World composition output field '${field}' must be a boolean`);
  }
  return value;
}

/** Deterministic deep-key scan; returns offending (key, path) pairs. */
export function findForbiddenKeys(value: unknown, forbidden: string[]): Array<{ key: string; path: string }> {
  const hits: Array<{ key: string; path: string }> = [];
  const walk = (node: unknown, pathStr: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pathStr}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.includes(key.toLowerCase())) {
        hits.push({ key, path: `${pathStr}.${key}` });
      }
      walk(child, `${pathStr}.${key}`);
    }
  };
  walk(value, "$");
  return hits;
}

/** Deep-scans an arbitrary document for credential-shaped keys (must find none). */
export function findCredentialKeys(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, pathStr: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pathStr}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (CREDENTIAL_KEY_PATTERN.test(key.toLowerCase())) {
        hits.push(`${pathStr}.${key}`);
      }
      walk(child, `${pathStr}.${key}`);
    }
  };
  walk(value, "$");
  return hits;
}

/**
 * Normalizes raw 3dviz agent output into the project/runtime composition form.
 * Enforces authority boundaries during normalization (REQ-BIND-005):
 * - reconstruction of a specific depicted object redirects to the reference-reconstruction capability;
 * - terrain elevation or navmesh authority claims are rejected outright.
 * Pure data transformation; performs no model invocation.
 */
export function normalizeWorldCompositionOutput(raw: unknown): NormalizedWorldComposition {
  if (!isPlainObject(raw)) {
    throw new Error("World composition agent output must be an object");
  }

  // Boundary 0: specific depicted-object reconstruction never travels the composition route.
  const routeHints = [raw.requested_route, raw.output_kind].filter((v): v is string => typeof v === "string");
  for (const hint of routeHints) {
    if (RECONSTRUCTION_ROUTE_PATTERN.test(hint)) {
      throw new WorldCompositionAuthorityError(
        "object_reconstruction",
        `World composition output declares reconstruction intent ('${hint}'); specific depicted objects must route to the reference-reconstruction capability, not world composition`,
        "asset.reconstruct"
      );
    }
  }

  // Boundary 1: competing terrain/navigation/physics authority keys are rejected outright.
  const forbidden = findForbiddenKeys(raw, FORBIDDEN_AUTHORITY_KEYS);
  if (forbidden.length > 0) {
    const terrainish = forbidden.find((f) => !/nav/i.test(f.key));
    const navish = forbidden.find((f) => /nav/i.test(f.key));
    if (terrainish) {
      throw new WorldCompositionAuthorityError(
        "terrain_authority",
        `World composition output embeds terrain elevation authority at ${terrainish.path}; elevation remains canonical TerrainHeightfield authority (world.terrain), composition may only reference it`
      );
    }
    throw new WorldCompositionAuthorityError(
      "navigation_authority",
      `World composition output embeds navigation authority at ${navish?.path}; navmesh remains runtime Recast authority (world.navigation), derived downstream from accepted geometry`
    );
  }

  // Boundary 2: the terrain stance must be an explicit canonical reference.
  const terrain = raw.terrain_authority;
  if (!isPlainObject(terrain)) {
    throw new WorldCompositionAuthorityError(
      "terrain_authority",
      "World composition output must declare terrain_authority referencing the canonical heightfield (world.terrain)"
    );
  }
  if (terrain.mode !== "canonical_heightfield_reference") {
    throw new WorldCompositionAuthorityError(
      "terrain_authority",
      `terrain_authority.mode must be 'canonical_heightfield_reference'; got '${String(terrain.mode)}'. A 3dviz-created terrain mesh must never bypass TerrainHeightfield for physics or navigation`,
      "world.terrain"
    );
  }
  if (terrain.capability !== "world.terrain") {
    throw new WorldCompositionAuthorityError(
      "terrain_authority",
      `terrain_authority.capability must be 'world.terrain'; got '${String(terrain.capability)}'`,
      "world.terrain"
    );
  }

  const composition: Record<string, unknown> = {};
  composition.composition_id = requireString(raw.composition_id, "composition_id");
  composition.capability = WORLD_ENVIRONMENT_COMPOSE_CAPABILITY;
  composition.skill_id = THREEVIZ_SKILL_ID;
  composition.terrain_authority = {
    mode: "canonical_heightfield_reference",
    capability: "world.terrain",
    generator: requireString(terrain.generator, "terrain_authority.generator"),
    seed: requireInt(terrain.seed, "terrain_authority.seed"),
    rows: requireInt(terrain.rows, "terrain_authority.rows"),
    columns: requireInt(terrain.columns, "terrain_authority.columns"),
    size_x: requireNumber(terrain.size_x, "terrain_authority.size_x"),
    size_z: requireNumber(terrain.size_z, "terrain_authority.size_z"),
  };

  const nav = isPlainObject(raw.navigation_derivation) ? raw.navigation_derivation : {};
  if (nav.mode !== undefined && nav.mode !== "runtime_derived") {
    throw new WorldCompositionAuthorityError(
      "navigation_authority",
      `navigation_derivation.mode must be 'runtime_derived'; got '${String(nav.mode)}'. Navmesh data is never a composition output`,
      "world.navigation"
    );
  }
  composition.navigation_derivation = {
    mode: "runtime_derived",
    capability: "world.navigation",
    source:
      typeof nav.source === "string" && nav.source.length > 0
        ? nav.source
        : "canonical TerrainHeightfield navigation geometry + world-kit collider specs (Recast derives navmesh downstream)",
  };

  const kitsRaw = Array.isArray(raw.kits) ? raw.kits : [];
  composition.kits = kitsRaw.map((k, i) => {
    if (!isPlainObject(k)) throw new Error(`kits[${i}] must be an object`);
    const position = isPlainObject(k.position) ? k.position : {};
    return {
      kit_id: requireString(k.kit_id, `kits[${i}].kit_id`),
      asset_id: requireString(k.asset_id, `kits[${i}].asset_id`),
      role: requireString(k.role, `kits[${i}].role`),
      position: {
        x: requireNumber(position.x, `kits[${i}].position.x`),
        z: requireNumber(position.z, `kits[${i}].position.z`),
        terrain_socked: position.terrain_socked === undefined ? true : requireBool(position.terrain_socked, `kits[${i}].position.terrain_socked`),
        offset_y: position.offset_y === undefined ? 0 : requireNumber(position.offset_y, `kits[${i}].position.offset_y`),
      },
      rotation_y: k.rotation_y === undefined ? 0 : requireNumber(k.rotation_y, `kits[${i}].rotation_y`),
      scale: k.scale === undefined ? 1 : requireNumber(k.scale, `kits[${i}].scale`),
    };
  });

  const socketsRaw = Array.isArray(raw.sockets) ? raw.sockets : [];
  composition.sockets = socketsRaw.map((s, i) => {
    if (!isPlainObject(s)) throw new Error(`sockets[${i}] must be an object`);
    const heightSource = s.height_source === undefined ? "canonical_heightfield" : requireString(s.height_source, `sockets[${i}].height_source`);
    if (heightSource !== "canonical_heightfield") {
      throw new WorldCompositionAuthorityError(
        "terrain_authority",
        `sockets[${i}].height_source must be 'canonical_heightfield'; got '${heightSource}'. Socket heights resolve from the canonical heightfield, never from composition-owned elevation`,
        "world.terrain"
      );
    }
    return {
      socket_id: requireString(s.socket_id, `sockets[${i}].socket_id`),
      attaches_to: requireString(s.attaches_to, `sockets[${i}].attaches_to`),
      terrain_socked: s.terrain_socked === undefined ? true : requireBool(s.terrain_socked, `sockets[${i}].terrain_socked`),
      height_source: "canonical_heightfield" as const,
      offset_y: s.offset_y === undefined ? 0 : requireNumber(s.offset_y, `sockets[${i}].offset_y`),
    };
  });

  const collidersRaw = Array.isArray(raw.colliders) ? raw.colliders : [];
  composition.colliders = collidersRaw.map((c, i) => {
    if (!isPlainObject(c)) throw new Error(`colliders[${i}] must be an object`);
    const shape = requireString(c.shape, `colliders[${i}].shape`);
    if (shape !== "box" && shape !== "cylinder" && shape !== "mesh-exact") {
      throw new Error(`colliders[${i}].shape must be 'box' | 'cylinder' | 'mesh-exact'`);
    }
    return {
      collider_id: requireString(c.collider_id, `colliders[${i}].collider_id`),
      attached_to: requireString(c.attached_to, `colliders[${i}].attached_to`),
      shape,
      blocks_navigation: c.blocks_navigation === undefined ? true : requireBool(c.blocks_navigation, `colliders[${i}].blocks_navigation`),
    };
  });

  const scatterRaw = Array.isArray(raw.scatter) ? raw.scatter : [];
  composition.scatter = scatterRaw.map((s, i) => {
    if (!isPlainObject(s)) throw new Error(`scatter[${i}] must be an object`);
    const placement = s.placement === undefined ? "terrain-projected" : requireString(s.placement, `scatter[${i}].placement`);
    if (placement !== "terrain-projected") {
      throw new Error(`scatter[${i}].placement must be 'terrain-projected'`);
    }
    const maxInstances = requireInt(s.max_instances, `scatter[${i}].max_instances`);
    if (maxInstances < 1 || maxInstances > 20000) {
      throw new Error(`scatter[${i}].max_instances must be within [1, 20000]`);
    }
    return {
      layer_id: requireString(s.layer_id, `scatter[${i}].layer_id`),
      asset_id: requireString(s.asset_id, `scatter[${i}].asset_id`),
      placement: "terrain-projected" as const,
      placement_seed: requireInt(s.placement_seed, `scatter[${i}].placement_seed`),
      max_instances: maxInstances,
    };
  });

  const lightRaw = isPlainObject(raw.lighting_atmosphere) ? raw.lighting_atmosphere : {};
  composition.lighting_atmosphere = {
    preset: requireString(lightRaw.preset ?? "unspecified", "lighting_atmosphere.preset"),
    asset_ids: Array.isArray(lightRaw.asset_ids) ? lightRaw.asset_ids.map((a, i) => requireString(a, `lighting_atmosphere.asset_ids[${i}]`)) : [],
  };

  return composition as unknown as NormalizedWorldComposition;
}

function check(name: string, pass: boolean, detail: string): WorldVerificationCheck {
  return { code: name, pass, detail };
}

function resolveProjectRoot(resultFilePath: string): string {
  // <root>/.studio/results/<file> -> <root>
  return path.resolve(path.dirname(resultFilePath), "..", "..");
}

interface ManifestLike {
  schema?: string;
  records?: Array<Record<string, unknown>>;
}

function loadProjectManifest(projectRoot: string): ManifestLike | null {
  const manifestPath = path.join(projectRoot, "assets", "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ManifestLike;
  } catch {
    return null;
  }
}

/**
 * Deterministic result verification for `world.environment.compose` (REQ-BIND-005).
 * Validates the committed lifecycle document: contracts CapabilityResult envelope,
 * handoff lifecycle record, canonical terrain reference (never competing elevation),
 * downstream navigation derivation (never embedded navmesh), no specific-object
 * reconstruction route, bounded Asset Registry provenance for every referenced asset,
 * deterministic scatter, and zero model credentials. No model/network invocation.
 */
export function verifyWorldCompositionResultDocument(
  doc: unknown,
  options: VerifyWorldCompositionOptions = {}
): WorldVerificationReport {
  const checks: WorldVerificationCheck[] = [];
  const record = (name: string, pass: boolean, detail: string) => checks.push(check(name, pass, detail));

  let resultEnvelope: CapabilityResult | null = null;
  let composition: NormalizedWorldComposition | null = null;
  const docObj = isPlainObject(doc) ? doc : {};

  // 1. Document schema + capability binding.
  record(
    "DOCUMENT_SCHEMA",
    docObj.schema === WORLD_COMPOSITION_RESULT_SCHEMA,
    `schema must be '${WORLD_COMPOSITION_RESULT_SCHEMA}' (got '${String(docObj.schema)}')`
  );
  record(
    "CAPABILITY_BINDING",
    docObj.capability === WORLD_ENVIRONMENT_COMPOSE_CAPABILITY,
    `capability must be '${WORLD_ENVIRONMENT_COMPOSE_CAPABILITY}' (got '${String(docObj.capability)}')`
  );

  // 2. Handoff lifecycle record.
  const handoff = isPlainObject(docObj.handoff) ? docObj.handoff : null;
  const lifecycleOk =
    !!handoff &&
    typeof handoff.request_id === "string" &&
    handoff.request_id.length > 0 &&
    handoff.skill_id === THREEVIZ_SKILL_ID &&
    typeof handoff.instructions_ref === "string" &&
    (handoff.instructions_ref.startsWith("skills/") || handoff.instructions_ref.startsWith("vendor/")) &&
    Array.isArray(handoff.acceptance) &&
    handoff.acceptance.length > 0;
  record(
    "HANDOFF_LIFECYCLE_RECORDED",
    lifecycleOk,
    "handoff must record request_id, skill_id '3dviz', a confined instructions_ref (skills/ or vendor/), and non-empty acceptance"
  );

  // 3. CapabilityResult contracts envelope.
  try {
    resultEnvelope = validateCapabilityResult(docObj.result);
    record("RESULT_ENVELOPE_CONTRACT", true, "result satisfies the @gauntlet/contracts CapabilityResult schema");
    record(
      "RESULT_PROVIDER_BINDING",
      resultEnvelope.provider === THREEVIZ_PROVIDER,
      `result.provider must be '${THREEVIZ_PROVIDER}' (got '${resultEnvelope.provider}')`
    );
    record(
      "RESULT_SETTLED",
      resultEnvelope.status === "success" && resultEnvelope.artifacts.length > 0,
      "accepted output settles as success with at least one committed artifact (no premature settlement)"
    );
    if (handoff && typeof handoff.request_id === "string") {
      record(
        "REQUEST_ID_CONSISTENT",
        resultEnvelope.request_id === handoff.request_id,
        `result.request_id '${resultEnvelope.request_id}' must match handoff.request_id '${handoff.request_id}'`
      );
    } else {
      record("REQUEST_ID_CONSISTENT", false, "handoff.request_id missing");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record("RESULT_ENVELOPE_CONTRACT", false, `result violates the CapabilityResult schema: ${msg}`);
    record("RESULT_PROVIDER_BINDING", false, "envelope invalid");
    record("RESULT_SETTLED", false, "envelope invalid");
    record("REQUEST_ID_CONSISTENT", false, "envelope invalid");
  }

  // 4. Accepted output normalization + authority boundaries.
  const accepted = isPlainObject(docObj.accepted_output) ? docObj.accepted_output : null;
  try {
    if (!accepted || !isPlainObject(accepted.composition)) {
      throw new Error("accepted_output.composition missing");
    }
    composition = normalizeWorldCompositionOutput(accepted.composition);
    record("COMPOSITION_NORMALIZED", true, "accepted composition normalizes into project/runtime forms (kits, sockets, colliders, scatter, lighting/atmosphere)");
    record(
      "TERRAIN_AUTHORITY_CANONICAL",
      composition.terrain_authority.mode === "canonical_heightfield_reference" &&
        composition.terrain_authority.capability === "world.terrain",
      "composition references canonical TerrainHeightfield authority (world.terrain) and supplies no elevation of its own"
    );
    record(
      "NAVIGATION_DERIVED_DOWNSTREAM",
      composition.navigation_derivation.mode === "runtime_derived" &&
        composition.navigation_derivation.capability === "world.navigation",
      "navigation stays runtime Recast authority (world.navigation), derived downstream from accepted geometry"
    );
  } catch (err: unknown) {
    const violation = err instanceof WorldCompositionAuthorityError ? err.violation : null;
    const msg = err instanceof Error ? err.message : String(err);
    record("COMPOSITION_NORMALIZED", false, `composition normalization failed: ${msg}`);
    if (violation === "navigation_authority") {
      record("TERRAIN_AUTHORITY_CANONICAL", true, "not evaluated in detail (navigation violation recorded)");
      record("NAVIGATION_DERIVED_DOWNSTREAM", false, msg);
    } else {
      record("TERRAIN_AUTHORITY_CANONICAL", false, msg);
      record("NAVIGATION_DERIVED_DOWNSTREAM", true, "not evaluated in detail (terrain violation recorded)");
    }
  }

  // 5. Explicit deep scan: no competing terrain/nav/physics authority embedded anywhere in the document.
  const embedded = findForbiddenKeys(docObj, FORBIDDEN_AUTHORITY_KEYS);
  record(
    "NO_COMPETING_AUTHORITY_EMBEDDED",
    embedded.length === 0,
    embedded.length === 0
      ? "no terrain elevation, navmesh, or physics authority keys embedded in the composition document"
      : `competing authority keys embedded at: ${embedded.map((e) => e.path).join(", ")}`
  );

  // 6. Reconstruction boundary: composition never carries reference-reconstruction routes.
  const compositionJson = JSON.stringify(accepted?.composition ?? null);
  record(
    "NO_OBJECT_RECONSTRUCTION_ROUTE",
    !RECONSTRUCTION_ROUTE_PATTERN.test(compositionJson),
    "specific depicted-object reconstruction stays on the reference-reconstruction capability, never world composition"
  );

  // 7. Asset provenance: every referenced asset is a settled Asset Registry record.
  const manifest = options.projectRoot ? loadProjectManifest(options.projectRoot) : null;
  const resolvedRoot = options.projectRoot ?? null;
  const manifestOk = manifest !== null && manifest.schema === "gauntlet.asset.manifest";
  record(
    "ASSET_REGISTRY_PRESENT",
    manifestOk,
    manifestOk
      ? `project Asset Registry manifest found under ${resolvedRoot ? "project root" : "project root"}`
      : "project assets/manifest.json (gauntlet.asset.manifest) not found or invalid"
  );

  const recordsById = new Map<string, Record<string, unknown>>();
  if (manifestOk && Array.isArray(manifest?.records)) {
    for (const rec of manifest.records) {
      const id = typeof rec.id === "string" ? rec.id : null;
      if (id) recordsById.set(id, rec);
    }
  }

  const referencedAssetIds = new Set<string>();
  if (composition) {
    for (const kit of composition.kits) referencedAssetIds.add(kit.asset_id);
    for (const layer of composition.scatter) referencedAssetIds.add(layer.asset_id);
    for (const assetId of composition.lighting_atmosphere.asset_ids) referencedAssetIds.add(assetId);
  }
  const resultAssetIds = new Set<string>(resultEnvelope?.asset_ids ?? []);
  const provenanceProblems: string[] = [];
  for (const assetId of referencedAssetIds) {
    if (!resultAssetIds.has(assetId)) {
      provenanceProblems.push(`${assetId} not declared in result.asset_ids`);
      continue;
    }
    const rec = recordsById.get(assetId);
    if (!rec) {
      provenanceProblems.push(`${assetId} missing from project Asset Registry`);
      continue;
    }
    try {
      const validated = validateAssetRecord(rec);
      if (validated.acceptance_state !== "accepted" && validated.acceptance_state !== "degraded") {
        provenanceProblems.push(`${assetId} acceptance_state '${validated.acceptance_state}' is not production-settled`);
      }
      if (RECONSTRUCTION_ROUTE_PATTERN.test(validated.construction_route)) {
        provenanceProblems.push(`${assetId} construction_route '${validated.construction_route}' denotes reference reconstruction, not composition`);
      }
    } catch (err: unknown) {
      provenanceProblems.push(`${assetId} violates AssetRecord contract: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  record(
    "ASSET_PROVENANCE_BOUND",
    manifestOk && referencedAssetIds.size > 0 && provenanceProblems.length === 0,
    provenanceProblems.length === 0
      ? `${referencedAssetIds.size} referenced asset(s) bound to settled project Asset Registry records (accepted/degraded)`
      : provenanceProblems.join("; ")
  );

  // 8. Sockets terrain-socked to the canonical heightfield.
  const socketsOk =
    !!composition && composition.sockets.length > 0 &&
    composition.sockets.every((s) => s.terrain_socked && s.height_source === "canonical_heightfield");
  record(
    "SOCKETS_CANONICAL_SOCKED",
    socketsOk,
    socketsOk
      ? `${composition?.sockets.length} socket(s) resolve heights from the canonical heightfield only`
      : "every socket must be terrain-socked with height_source 'canonical_heightfield'"
  );

  // 9. Scatter determinism (seeded, bounded).
  const scatterOk =
    !!composition &&
    composition.scatter.every((l) => Number.isInteger(l.placement_seed) && l.max_instances >= 1 && l.max_instances <= 20000);
  record(
    "SCATTER_DETERMINISTIC",
    scatterOk,
    scatterOk ? `${composition?.scatter.length} scatter layer(s) seeded and instance-bounded` : "every scatter layer needs an integer seed and bounded max_instances [1, 20000]"
  );

  // 10. No model credentials anywhere in the committed document.
  const credentialHits = findCredentialKeys(docObj);
  record(
    "NO_MODEL_CREDENTIALS",
    credentialHits.length === 0,
    credentialHits.length === 0
      ? "deterministic verification only; zero credential-shaped keys and zero model/network invocations"
      : `credential-shaped keys found at: ${credentialHits.join(", ")}`
  );

  const failed = checks.filter((c) => !c.pass).length;
  return {
    valid: failed === 0,
    capability: String(docObj.capability ?? WORLD_ENVIRONMENT_COMPOSE_CAPABILITY),
    checks,
    summary: { passed: checks.length - failed, failed },
  };
}

/** Reads a committed .studio/results/*.yaml file and verifies it deterministically. */
export function verifyWorldCompositionResultFile(
  resultFilePath: string,
  options: VerifyWorldCompositionOptions = {}
): WorldVerificationReport {
  const resolved = path.resolve(resultFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Result file not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, "utf-8");
  const doc = Bun.YAML.parse(text);
  const projectRoot = options.projectRoot ?? resolveProjectRoot(resolved);
  return verifyWorldCompositionResultDocument(doc, { ...options, projectRoot });
}
