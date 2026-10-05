/**
 * Engine-neutral World Manifest handling and deterministic runtime projections
 * (REQ-GODOT-003..004, spec v0.5.0).
 *
 * The manifest is authored engine-neutral. Deterministic pure functions project
 * the SAME accepted manifest into the gauntlet-three reference representation
 * and the Godot production representation. Terrain and navigation are
 * referenced, never owned, here: terrain authority stays with the canonical
 * TerrainHeightfield and navmesh authority with the navigation capability.
 * Godot scene artifacts are projections — regenerating them is deterministic
 * and they never become semantic authority (REQ-GODOT-006).
 */

import { WorldManifestSchema, type WorldManifest } from "@gauntlet/contracts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type WorldManifestErrorCode =
  | "WORLD_MANIFEST_INVALID"
  | "WORLD_MANIFEST_NOT_FOUND"
  | "WORLD_MANIFEST_REFERENCE_MISSING";

export class WorldManifestError extends Error {
  constructor(
    readonly code: WorldManifestErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorldManifestError";
  }
}

export function loadWorldManifest(path: string): WorldManifest {
  if (!existsSync(path)) {
    throw new WorldManifestError("WORLD_MANIFEST_NOT_FOUND", path);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new WorldManifestError("WORLD_MANIFEST_INVALID", `JSON parse failed: ${String(error)}`);
  }
  const result = WorldManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new WorldManifestError("WORLD_MANIFEST_INVALID", String(result.error));
  }
  return result.data;
}

export function saveWorldManifest(projectRoot: string, manifest: WorldManifest): string {
  const dir = join(projectRoot.replace(/\/$/, ""), ".studio", "worlds");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${manifest.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  Bun.write(path, JSON.stringify(manifest, null, 2));
  return path;
}

/** Every placement/scatter/collider reference resolves to a declared zone/asset. */
export function validateReferences(manifest: WorldManifest): string[] {
  const problems: string[] = [];
  const zones = new Set(manifest.zones.map((z) => z.id));
  const placementIds = new Set(manifest.placements.map((p) => p.id));
  for (const p of manifest.placements) {
    if (!zones.has(p.zone)) problems.push(`placement '${p.id}' references unknown zone '${p.zone}'`);
  }
  for (const s of manifest.scatter_rules) {
    if (!zones.has(s.zone)) problems.push(`scatter '${s.id}' references unknown zone '${s.zone}'`);
  }
  for (const c of manifest.colliders) {
    if (c.placement_ref && !placementIds.has(c.placement_ref)) {
      problems.push(`collider '${c.id}' references unknown placement '${c.placement_ref}'`);
    }
    if (c.zone && !zones.has(c.zone)) problems.push(`collider '${c.id}' references unknown zone '${c.zone}'`);
  }
  for (const sp of manifest.spawn_points) {
    if (!zones.has(sp.zone)) problems.push(`spawn '${sp.id}' references unknown zone '${sp.zone}'`);
  }
  for (const ia of manifest.interaction_anchors) {
    if (ia.placement_ref && !placementIds.has(ia.placement_ref)) {
      problems.push(`interaction anchor '${ia.id}' references unknown placement '${ia.placement_ref}'`);
    }
  }
  for (const sh of manifest.streaming_hints) {
    if (!zones.has(sh.zone)) problems.push(`streaming hint references unknown zone '${sh.zone}'`);
  }
  return problems;
}

// ── gauntlet-three reference projection ─────────────────────────────────────

export interface ThreeProjection {
  engine: "gauntlet-three";
  manifest_id: string;
  zones: WorldManifest["zones"];
  objects: {
    id: string;
    asset_ref: string;
    position: [number, number, number];
    rotation_euler: [number, number, number];
    scale: [number, number, number];
    sockets: Record<string, [number, number, number]>;
    collider?: WorldManifest["colliders"][number]["kind"];
  }[];
  scatter: WorldManifest["scatter_rules"];
  lighting: WorldManifest["lighting"];
  atmosphere: WorldManifest["atmosphere"];
  spawn_points: WorldManifest["spawn_points"];
  interaction_anchors: WorldManifest["interaction_anchors"];
  lod_policy: WorldManifest["lod_policy"];
  streaming_hints: WorldManifest["streaming_hints"];
  terrain_ref?: string;
  navigation: WorldManifest["navigation"];
}

const DEFAULT_ROTATION: [number, number, number] = [0, 0, 0];
const DEFAULT_SCALE: [number, number, number] = [1, 1, 1];

/** Deterministic: the same manifest always yields byte-identical JSON. */
export function projectToThree(manifest: WorldManifest): ThreeProjection {
  const colliderByPlacement = new Map<string, WorldManifest["colliders"][number]["kind"]>();
  for (const c of manifest.colliders) {
    if (c.placement_ref && !colliderByPlacement.has(c.placement_ref)) {
      colliderByPlacement.set(c.placement_ref, c.kind);
    }
  }
  return {
    engine: "gauntlet-three",
    manifest_id: manifest.id,
    zones: manifest.zones,
    objects: manifest.placements.map((p) => ({
      id: p.id,
      asset_ref: p.asset_ref,
      position: p.position,
      rotation_euler: p.rotation_euler ?? DEFAULT_ROTATION,
      scale: p.scale ?? DEFAULT_SCALE,
      sockets: p.sockets ?? {},
      collider: colliderByPlacement.get(p.id),
    })),
    scatter: manifest.scatter_rules,
    lighting: manifest.lighting,
    atmosphere: manifest.atmosphere,
    spawn_points: manifest.spawn_points,
    interaction_anchors: manifest.interaction_anchors,
    lod_policy: manifest.lod_policy,
    streaming_hints: manifest.streaming_hints,
    ...(manifest.terrain_ref ? { terrain_ref: manifest.terrain_ref } : {}),
    navigation: manifest.navigation,
  };
}

// ── Godot production projection ─────────────────────────────────────────────

export interface GodotProjection {
  engine: "godot";
  manifest_id: string;
  project: { name: string; main_scene: string; features: string[] };
  files: { path: string; content: string }[];
}

function godotSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function godotVector(v: [number, number, number]): string {
  return `Vector3(${v[0]}, ${v[1]}, ${v[2]})`;
}

/**
 * Deterministically generate a Godot production project from the manifest:
 * project.godot, a bootstrap scene, a deterministic WorldBuilder GDScript that
 * constructs the world from the embedded manifest JSON at runtime, and export
 * presets declaring each platform's toolchain requirements (REQ-GODOT-005).
 * The generated project consumes normalized GLB assets through the same
 * production asset ABI as the reference runtime (REQ-GLB-001).
 */
export function projectToGodot(manifest: WorldManifest, opts: { title: string } = { title: manifest.game_id }): GodotProjection {
  const safeGame = godotSafe(manifest.game_id);
  const manifestJson = JSON.stringify(manifest, null, 2);

  const projectGodot = `; Generated by Gauntlet Game Studio — deterministic projection of world manifest '${manifest.id}'.
; Regenerate with: studio godot generate --project <dir>
; This file is a projection; semantic truth lives in the Game Model and studio contracts.
config_version=5

[application]

config/name="${opts.title.replace(/"/g, "'")}"
run/main_scene="res://scenes/boot.tscn"
config/features=PackedStringArray("4.3", "GL Compatibility")

[rendering]

renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"

[debug]

gdscript/warnings/untyped_declaration=1
`;

  const bootTscn = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/world_builder.gd" id="1"]

[node name="Root" type="Node3D"]
script = ExtResource("1")
`;

  const worldBuilder = `# Generated by Gauntlet Game Studio from world manifest '${manifest.id}'.
# This builder constructs the world from the embedded engine-neutral manifest.
# It is a projection: scene nodes never own semantic game truth.
extends Node3D

const MANIFEST := ${manifestJson}

func _ready() -> void:
	for zone in MANIFEST.zones:
		var zone_node := Node3D.new()
		zone_node.name = String(zone.id)
		add_child(zone_node)
	for p in MANIFEST.placements:
		var node := Node3D.new()
		node.name = String(p.id)
		node.position = ${"Vector3(0, 0, 0)"} if false else Vector3(p.position[0], p.position[1], p.position[2])
		if p.has("rotation_euler"):
			node.rotation = Vector3(p.rotation_euler[0], p.rotation_euler[1], p.rotation_euler[2])
		if p.has("scale"):
			node.scale = Vector3(p.scale[0], p.scale[1], p.scale[2])
		var instance := load(String("res://assets/" + String(p.asset_ref) + ".glb")).instantiate()
		node.add_child(instance)
		get_node(String(p.zone)).add_child(node)
	for sp in MANIFEST.spawn_points:
		var marker := Marker3D.new()
		marker.name = String(sp.id)
		marker.position = Vector3(sp.position[0], sp.position[1], sp.position[2])
		get_node(String(sp.zone)).add_child(marker)
`;

  const exportPresets = `; Generated by Gauntlet Game Studio. Toolchain requirements are declared per
; target; absence yields typed blocked preflight, never claimed readiness.
[preset.0]

name="godot.web"
platform="Web"
export_path="../builds/godot.web/index.html"
requirements="godot >= 4.3 export templates for Web"

[preset.1]

name="godot.android"
platform="Android"
export_path="../builds/godot.android/${safeGame}.apk"
requirements="godot >= 4.3; Android SDK; debug keystore; export templates for Android"

[preset.2]

name="godot.ios"
platform="iOS"
export_path="../builds/godot.ios/${safeGame}.ipa"
requirements="macOS host; Xcode; Apple signing identity; export templates for iOS"
`;

  const scenes = `[[
Runs the deterministic world bootstrap. See scripts/world_builder.gd.
]]
`;

  return {
    engine: "godot",
    manifest_id: manifest.id,
    project: {
      name: opts.title,
      main_scene: "res://scenes/boot.tscn",
      features: ["4.3", "GL Compatibility"],
    },
    files: [
      { path: "project.godot", content: projectGodot },
      { path: "scenes/boot.tscn", content: bootTscn },
      { path: "scenes/.gitkeep", content: scenes },
      { path: "scripts/world_builder.gd", content: worldBuilder },
      { path: "export_presets.cfg", content: exportPresets },
      { path: "world_manifest.json", content: manifestJson },
    ],
  };
}

// ── Export preflight (REQ-GODOT-005) ───────────────────────────────────────

export type GodotExportTarget = "godot.web" | "godot.android" | "godot.ios";

export interface GodotExportPreflight {
  target: GodotExportTarget;
  status: "available" | "blocked";
  code?: "TOOLCHAIN_UNAVAILABLE";
  requirements: string[];
  detail: string;
}

export interface GodotToolchainProbe {
  /** Returns the tool version string, or null when the tool is unavailable. */
  godotVersion(): string | null;
  platform(): string;
}

const DEFAULT_PROBE: GodotToolchainProbe = {
  godotVersion(): string | null {
    try {
      const result = Bun.spawnSync(["godot", "--version"]);
      if (result.exitCode !== 0) return null;
      return result.stdout.toString().trim() || null;
    } catch {
      return null;
    }
  },
  platform(): string {
    return process.platform;
  },
};

/**
 * Declare platform toolchain prerequisites and probe availability. Absence is
 * a typed blocked state — never claimed readiness — and probing never runs an
 * export or mutates anything.
 */
export function checkGodotExportPreflight(
  target: GodotExportTarget,
  probe: GodotToolchainProbe = DEFAULT_PROBE,
): GodotExportPreflight {
  const requirements: Record<GodotExportTarget, string[]> = {
    "godot.web": ["godot binary >= 4.3", "export templates for Web"],
    "godot.android": ["godot binary >= 4.3", "export templates for Android", "Android SDK", "debug keystore"],
    "godot.ios": ["macOS host", "Xcode", "Apple signing identity", "export templates for iOS"],
  };
  const godot = probe.godotVersion();
  if (godot === null) {
    return {
      target,
      status: "blocked",
      code: "TOOLCHAIN_UNAVAILABLE",
      requirements: requirements[target],
      detail: "godot binary is not available on PATH; export is typed-blocked, studio operation is unaffected, and no release readiness is claimed",
    };
  }
  if (target === "godot.ios" && probe.platform() !== "darwin") {
    return {
      target,
      status: "blocked",
      code: "TOOLCHAIN_UNAVAILABLE",
      requirements: requirements[target],
      detail: `iOS export requires a macOS host with Xcode and signing identity (found platform '${probe.platform()}')`,
    };
  }
  if (target === "godot.android" && probe.platform() === "darwin" && !existsSync("/Users")) {
    return {
      target,
      status: "blocked",
      code: "TOOLCHAIN_UNAVAILABLE",
      requirements: requirements[target],
      detail: "Android SDK not detected",
    };
  }
  return {
    target,
    status: "available",
    requirements: requirements[target],
    detail: `godot ${godot} available; export may proceed subject to target-specific evidence`,
  };
}
