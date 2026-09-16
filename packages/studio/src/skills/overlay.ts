import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityDescriptor } from "@gauntlet/contracts";
import { lintSkillDescriptor, lintSkillRegistry, type SkillLintIssue, type SkillLintReport } from "./linter";

export class ForbiddenUpstreamAuthorityError extends Error {
  public readonly code = "FORBIDDEN_UPSTREAM_AUTHORITY";
  constructor(public readonly skillId: string, message?: string) {
    super(message || `Skill '${skillId}' violates overlay policy: upstream orchestration director cannot compete with studio router.`);
    this.name = "ForbiddenUpstreamAuthorityError";
  }
}

export class UnnecessaryVendoringError extends Error {
  public readonly code = "UNNECESSARY_VENDORING_DETECTED";
  constructor(public readonly packageName: string, message?: string) {
    super(message || `Package '${packageName}' is vendored in vendor/ but should be a pinned package dependency (REQ-SOURCE-001).`);
    this.name = "UnnecessaryVendoringError";
  }
}

export interface QuarantinePolicy {
  enabled: boolean;
  enablement_basis?: string;
  /** Required when enabled=true: names the explicit studio project policy/capability that enables the fallback. */
  enablement_declared_by?: string;
  policy?: string;
}

export interface SpecialistBinding {
  /** Upstream specialist skill id, e.g. 'threejs-gameplay-systems'. */
  skill_id: string;
  /** Existing studio capability contracts this specialist is disclosed under (capability-first anchor). */
  capability_ids: string[];
  /** Repo-relative progressive-disclosure pointer (layer 2); full content loads only on activation. */
  disclosure_ref: string;
  summary: string;
  use_when: string[];
  do_not_use_when: string[];
}

export interface SkillOverlayPolicy {
  schema: string;
  schema_version: string;
  upstream: string;
  orchestration_authority: string;
  forbidden_skills: string[];
  allowed_specialists: string[];
  quarantined_skills: string[];
  specialist_bindings?: SpecialistBinding[];
  quarantine_policy?: QuarantinePolicy;
}

export interface AttributionClassManifest {
  schema: string;
  schema_version: string;
  classes: {
    runtime_dependency: Array<{ name: string; version: string; license: string; purpose: string }>;
    agent_skill_source: Array<{ id: string; vendor_path: string; upstream: string; license: string }>;
    temporary_donor: Array<{ id: string; donor_path: string; status: string; purpose: string }>;
    copied_code: Array<{ id: string; original_source: string; target_path: string }>;
    external_asset: Array<{ source: string; license: string; purpose: string }>;
  };
}

/**
 * Validates a skill overlay policy against REQ-SOURCE-005 and REQ-BIND-007.
 * Prohibits upstream directors (like threejs-game-director) from becoming competing orchestration authorities.
 * Since T16, also enforces the canonical specialist overlay set, generator quarantine, binding structure,
 * and disclosure-pointer confinement.
 */
export function validateOverlayPolicy(policy: SkillOverlayPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (policy.orchestration_authority !== "gauntlet-game-studio") {
    errors.push(`Orchestration authority must be 'gauntlet-game-studio', found '${policy.orchestration_authority}'`);
  }

  const norm = (s: string) => s.toLowerCase().trim();
  const normalizedForbidden = policy.forbidden_skills.map(norm);
  if (!normalizedForbidden.includes("threejs-game-director")) {
    errors.push("threejs-game-director must be explicitly included in forbidden_skills (REQ-SOURCE-005)");
  }

  const allowed = (policy.allowed_specialists || []).map(norm);
  const quarantined = (policy.quarantined_skills || []).map(norm);

  for (const specialist of CANONICAL_OVERLAY_SPECIALISTS) {
    if (!allowed.includes(specialist)) {
      errors.push(`threejs-game-skills overlay must allow specialist '${specialist}' (REQ-BIND-007)`);
    }
  }
  for (const generator of QUARANTINED_GENERATOR_SKILLS) {
    if (!quarantined.includes(generator)) {
      errors.push(`threejs-game-skills overlay must quarantine generic generator '${generator}' as a disabled optional fallback (REQ-BIND-007)`);
    }
  }
  for (const a of allowed) {
    if (normalizedForbidden.includes(a)) {
      errors.push(`Skill '${a}' cannot be both allowed and forbidden`);
    }
    if (quarantined.includes(a)) {
      errors.push(`Skill '${a}' cannot be both allowed and quarantined`);
    }
  }

  const bindings = policy.specialist_bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) {
    errors.push("specialist_bindings must declare the overlay mappings for the allowed specialists (REQ-BIND-007)");
  } else {
    const seen = new Set<string>();
    for (const binding of bindings) {
      const id = norm(binding.skill_id);
      if (seen.has(id)) {
        errors.push(`Duplicate specialist binding for '${binding.skill_id}'`);
      }
      seen.add(id);
      if (!allowed.includes(id)) {
        errors.push(`Specialist binding '${binding.skill_id}' is not in allowed_specialists`);
      }
      if (normalizedForbidden.includes(id) || quarantined.includes(id)) {
        errors.push(`Specialist binding '${binding.skill_id}' references a forbidden or quarantined skill`);
      }
      if (!binding.summary || binding.summary.length < 10) {
        errors.push(`Specialist binding '${binding.skill_id}' needs a routing summary (min 10 chars)`);
      }
      if (!Array.isArray(binding.use_when) || binding.use_when.length === 0) {
        errors.push(`Specialist binding '${binding.skill_id}' needs positive triggers in use_when`);
      }
      if (!Array.isArray(binding.do_not_use_when) || binding.do_not_use_when.length === 0) {
        errors.push(`Specialist binding '${binding.skill_id}' needs negative affordances in do_not_use_when`);
      }
      if (!Array.isArray(binding.capability_ids) || binding.capability_ids.length === 0) {
        errors.push(`Specialist binding '${binding.skill_id}' must anchor to at least one studio capability contract`);
      }
      if (!isConstrainedDisclosureRef(binding.disclosure_ref)) {
        errors.push(
          `Specialist binding '${binding.skill_id}' disclosure_ref must be a repo-relative pointer under skills/ or vendor/ (found '${binding.disclosure_ref}')`
        );
      }
    }
    for (const a of allowed) {
      if (!seen.has(a)) {
        errors.push(`Allowed specialist '${a}' has no specialist_binding (REQ-BIND-007)`);
      }
    }
  }

  if (policy.quarantine_policy) {
    if (typeof policy.quarantine_policy.enabled !== "boolean") {
      errors.push("quarantine_policy.enabled must be a boolean");
    }
    if (policy.quarantine_policy.enabled === true && !policy.quarantine_policy.enablement_declared_by) {
      errors.push(
        "Enabling quarantined generators requires enablement_declared_by naming the explicit studio project policy that enables the optional fallback (REQ-BIND-007); credential presence is never an enablement basis"
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks whether a proposed skill is allowed by the overlay policy.
 * Throws ForbiddenUpstreamAuthorityError if the skill violates the policy (Teeth Attack 1).
 */
export function checkSkillAgainstOverlay(skillId: string, policy: SkillOverlayPolicy): void {
  const normalized = skillId.toLowerCase().trim();
  for (const forbidden of policy.forbidden_skills) {
    if (normalized === forbidden.toLowerCase().trim()) {
      throw new ForbiddenUpstreamAuthorityError(
        skillId,
        `Skill '${skillId}' is strictly prohibited: upstream director cannot act as orchestration authority (REQ-SOURCE-005)`
      );
    }
  }
}

/**
 * Lints vendor/ and third-party manifests to prevent unnecessary vendoring of standard runtime libraries (Teeth Attack 2).
 */
export function lintSourceAttribution(vendorDir: string, attribution: AttributionClassManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Check classes structure
  const requiredClasses = [
    "runtime_dependency",
    "agent_skill_source",
    "temporary_donor",
    "copied_code",
    "external_asset",
  ];

  for (const cls of requiredClasses) {
    if (!(cls in attribution.classes)) {
      errors.push(`Missing required attribution class '${cls}' (REQ-SOURCE-006)`);
    }
  }

  // 2. Scan vendorDir for forbidden runtime library vendoring
  if (fs.existsSync(vendorDir)) {
    const forbiddenVendoredLibs = ["three", "koota", "rapier", "three-mesh-bvh", "tone", "playwright"];
    const vendorEntries = fs.readdirSync(vendorDir);

    for (const entry of vendorEntries) {
      const lower = entry.toLowerCase();
      for (const lib of forbiddenVendoredLibs) {
        if (lower === lib || lower.startsWith(lib + "-")) {
          errors.push(`Runtime library '${entry}' must not be vendored in vendor/. Use pinned package dependency instead (REQ-SOURCE-001).`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates single Three.js dependency resolution across monorepo packages.
 */
export function verifySingleThreeVersion(packageJsonFiles: string[]): { uniform: boolean; version: string; mismatched: Record<string, string> } {
  const versions: Record<string, string> = {};

  for (const pkgPath of packageJsonFiles) {
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const threeVer = parsed.dependencies?.three || parsed.devDependencies?.three;
      if (threeVer) {
        versions[pkgPath] = threeVer;
      }
    } catch {
      // ignore
    }
  }

  const distinct = new Set(Object.values(versions));
  return {
    uniform: distinct.size <= 1,
    version: Array.from(distinct)[0] || "",
    mismatched: versions,
  };
}

// ============================================================================
// T16: threejs-game-skills specialist overlay (REQ-BIND-007)
// Studio-owned overlay routing: the Gauntlet studio director remains the sole
// orchestration authority; upstream specialists are progressively disclosed
// below stable studio capability contracts; generic generators stay
// quarantined as disabled optional fallbacks.
// ============================================================================

export const UPSTREAM_PACK_ID = "threejs-game-skills";

/** The five specialists Gauntlet overlays, fixed by plan policy (threejs_game_skills_policy.overlay). */
export const CANONICAL_OVERLAY_SPECIALISTS = [
  "threejs-gameplay-systems",
  "threejs-aaa-graphics-builder",
  "threejs-game-ui-designer",
  "threejs-debug-profiler",
  "threejs-qa-release",
] as const;

/** Generic generation skills quarantined as disabled optional fallbacks; never preferred because credentials exist. */
export const QUARANTINED_GENERATOR_SKILLS = [
  "threejs-3d-generator",
  "threejs-image-generator",
  "threejs-audio-generator",
] as const;

export class QuarantinedSkillError extends Error {
  public readonly code = "QUARANTINED_SKILL";
  constructor(public readonly skillId: string, message?: string) {
    super(
      message ||
        `Skill '${skillId}' is quarantined as a disabled optional fallback; it must never be registered or preferred as a provider (REQ-BIND-007). Credential presence is never an enablement basis.`
    );
    this.name = "QuarantinedSkillError";
  }
}

export class OverlayPolicyError extends Error {
  public readonly code = "OVERLAY_POLICY_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "OverlayPolicyError";
  }
}

export class CredentialPreferenceError extends Error {
  public readonly code = "CREDENTIAL_PREFERENCE_REJECTED";
  constructor(message: string) {
    super(message);
    this.name = "CredentialPreferenceError";
  }
}

const norm = (s: string) => s.toLowerCase().trim();

/** Strips a provider prefix so 'agent-skill.threejs-game-director' references skill 'threejs-game-director'. */
export function extractSkillReference(providerOrId: string): string {
  return norm(providerOrId).replace(/^agent-skill\./, "");
}

function lastDottedSegment(value: string): string {
  const parts = norm(value).split(".");
  return parts[parts.length - 1];
}

/**
 * True when a skill id/provider reference denotes a listed token, either exactly or by its last
 * dotted segment (so 'skill.threejs-game-director' and 'agent-skill.director' are both caught).
 */
function policyTokenMatches(reference: string, tokens: string[]): boolean {
  const normalized = norm(reference);
  const stripped = extractSkillReference(normalized);
  for (const token of tokens) {
    const t = norm(token);
    if (normalized === t || stripped === t || lastDottedSegment(normalized) === t || lastDottedSegment(stripped) === t) {
      return true;
    }
  }
  return false;
}

function assertNotForbidden(reference: string, policy: SkillOverlayPolicy): void {
  if (policyTokenMatches(reference, policy.forbidden_skills)) {
    throw new ForbiddenUpstreamAuthorityError(
      reference,
      `Skill reference '${reference}' denotes a forbidden upstream orchestration director; the Gauntlet studio director is the sole orchestration authority (REQ-BIND-007, REQ-SOURCE-005)`
    );
  }
}

/** Throws QuarantinedSkillError when the reference denotes a quarantined generator skill. */
export function assertSkillNotQuarantined(reference: string, policy: SkillOverlayPolicy): void {
  if (policyTokenMatches(reference, policy.quarantined_skills || [])) {
    throw new QuarantinedSkillError(reference);
  }
}

/** Repo-relative, confined disclosure pointer: under skills/ or vendor/, no traversal, no donor paths. */
export function isConstrainedDisclosureRef(ref: unknown): ref is string {
  if (typeof ref !== "string" || ref.length === 0) return false;
  if (ref.includes("\\") || ref.includes("..") || ref.startsWith("/")) return false;
  if (ref.includes(".tmp")) return false;
  return ref.startsWith("skills/") || ref.startsWith("vendor/");
}

/**
 * Loader/config surface: loads the committed threejs-game-skills overlay policy from the repository.
 * Pure load; run validateOverlayPolicy/lintOverlayRouting on the result before relying on it.
 */
export function loadSkillOverlayPolicy(
  rootDir: string = process.cwd(),
  relativePath: string = "vendor/skills/threejs-game-skills/overlay.json"
): SkillOverlayPolicy {
  const overlayPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(overlayPath)) {
    throw new OverlayPolicyError(`Overlay policy file not found at authoritative path '${overlayPath}' (REQ-BIND-007)`);
  }
  try {
    return JSON.parse(fs.readFileSync(overlayPath, "utf-8")) as SkillOverlayPolicy;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OverlayPolicyError(`Failed to parse overlay policy '${overlayPath}': ${msg}`);
  }
}

/** Studio-owned routing surface for one upstream specialist. The entry — not the specialist — is the routing contract. */
export interface SpecialistRouteEntry {
  id: string;
  providers: string[];
  skill_id: string;
  capability_ids: string[];
  disclosure_ref: string;
  summary: string;
  use_when: string[];
  do_not_use_when: string[];
}

/** Stable studio-owned routing id for a specialist: threejs-gameplay-systems -> overlay.gameplay-systems. */
export function specialistRouteEntryId(skillId: string): string {
  return `overlay.${extractSkillReference(skillId).replace(/^threejs-/, "")}`;
}

export function specialistBindingToRouteEntry(binding: SpecialistBinding): SpecialistRouteEntry {
  return {
    id: specialistRouteEntryId(binding.skill_id),
    providers: [`agent-skill.${norm(binding.skill_id)}`],
    skill_id: binding.skill_id,
    capability_ids: binding.capability_ids,
    disclosure_ref: binding.disclosure_ref,
    summary: binding.summary,
    use_when: binding.use_when,
    do_not_use_when: binding.do_not_use_when,
  };
}

/** Converts a route entry to a CapabilityDescriptor-shaped record for reuse of the skill metadata linter. */
export function routeEntryToCapabilityDescriptor(entry: SpecialistRouteEntry): CapabilityDescriptor {
  return {
    id: entry.id,
    summary: entry.summary,
    use_when: entry.use_when,
    do_not_use_when: entry.do_not_use_when,
    inputs: ["capability_request"],
    outputs: ["agent_handoff"],
    verification: ["overlay_routing_lint"],
    providers: entry.providers,
  };
}

/** Builds the studio-owned routing entries for every declared specialist binding. */
export function buildSpecialistRouteEntries(policy: SkillOverlayPolicy): SpecialistRouteEntry[] {
  return (policy.specialist_bindings || []).map(specialistBindingToRouteEntry);
}

/** Progressive disclosure layer 2: resolves the disclosure pointer for one specialist on demand. */
export function resolveSpecialistDisclosure(
  policy: SkillOverlayPolicy,
  skillId: string
): { skill_id: string; capability_ids: string[]; disclosure_ref: string; summary: string } {
  const binding = (policy.specialist_bindings || []).find((b) => norm(b.skill_id) === norm(skillId));
  if (!binding) {
    throw new OverlayPolicyError(
      `No specialist binding for '${skillId}' in the ${UPSTREAM_PACK_ID} overlay; only declared specialists are disclosable (REQ-BIND-007)`
    );
  }
  return {
    skill_id: binding.skill_id,
    capability_ids: binding.capability_ids,
    disclosure_ref: binding.disclosure_ref,
    summary: binding.summary,
  };
}

/** Scans a discoverable skill surface (ids + provider references) for forbidden or quarantined skills. */
export function findSurfaceViolations(
  skills: Array<Pick<CapabilityDescriptor, "id" | "providers">>,
  policy: SkillOverlayPolicy
): { forbidden: string[]; quarantined: string[] } {
  const forbidden: string[] = [];
  const quarantined: string[] = [];
  for (const skill of skills) {
    const refs = [skill.id, ...(skill.providers || [])];
    for (const ref of refs) {
      if (policyTokenMatches(ref, policy.forbidden_skills) && !forbidden.includes(ref)) {
        forbidden.push(ref);
      }
      if (policyTokenMatches(ref, policy.quarantined_skills || []) && !quarantined.includes(ref)) {
        quarantined.push(ref);
      }
    }
  }
  return { forbidden, quarantined };
}

/**
 * Enforces that a discoverable top-level skill surface contains no forbidden upstream director and
 * no quarantined generator (enforced, not documented). Throws on the first violation.
 */
export function assertDiscoverableSkillSurface(
  skills: Array<Pick<CapabilityDescriptor, "id" | "providers">>,
  policy: SkillOverlayPolicy
): void {
  const { forbidden, quarantined } = findSurfaceViolations(skills, policy);
  if (forbidden.length > 0) {
    throw new ForbiddenUpstreamAuthorityError(
      forbidden[0],
      `Forbidden upstream orchestration skill discoverable at top level: '${forbidden.join("', '")}' (REQ-BIND-007, REQ-SOURCE-005)`
    );
  }
  if (quarantined.length > 0) {
    throw new QuarantinedSkillError(quarantined[0]);
  }
}

/**
 * Routing collision lint between studio capabilities and upstream specialist descriptions
 * (REQ-BIND-007, REQ-SKILL-002):
 * - overlay policy must validate;
 * - each specialist binding must anchor to studio capabilities that exist in the catalog;
 * - specialist descriptions must satisfy the skill metadata contract;
 * - exact trigger collisions between specialists are errors;
 * - exact trigger collisions with a studio capability are errors unless the capability is one the
 *   specialist is bound to (coordinated provider-below-contract overlap stays a warning).
 */
export function lintOverlayRouting(policy: SkillOverlayPolicy, catalog: CapabilityDescriptor[]): SkillLintReport {
  const issues: SkillLintIssue[] = [];
  const push = (issue: SkillLintIssue) => issues.push(issue);

  const base = validateOverlayPolicy(policy);
  if (!base.valid) {
    push({
      severity: "error",
      code: "OVERLAY_POLICY_INVALID",
      message: `Overlay policy invalid: ${base.errors.join("; ")}`,
      skill_id: UPSTREAM_PACK_ID,
    });
  }

  const entries = buildSpecialistRouteEntries(policy);
  const catalogIds = new Set(catalog.map((c) => c.id));

  for (const entry of entries) {
    for (const issue of lintSkillDescriptor(routeEntryToCapabilityDescriptor(entry))) {
      push({ ...issue, message: `[${entry.skill_id}] ${issue.message}`, skill_id: entry.skill_id });
    }
    for (const capId of entry.capability_ids) {
      if (!catalogIds.has(capId)) {
        push({
          severity: "error",
          code: "OVERLAY_BINDING_UNKNOWN_CAPABILITY",
          message: `[${entry.skill_id}] binding anchors to unknown studio capability '${capId}'; specialists must disclose below real studio contracts`,
          skill_id: entry.skill_id,
        });
      }
    }
    if (!isConstrainedDisclosureRef(entry.disclosure_ref)) {
      push({
        severity: "error",
        code: "OVERLAY_DISCLOSURE_REF_UNSAFE",
        message: `[${entry.skill_id}] disclosure_ref '${entry.disclosure_ref}' is not a confined repo-relative pointer`,
        skill_id: entry.skill_id,
      });
    }
  }

  // Forbidden/quarantined references anywhere in the declared specialist surface.
  const declared = findSurfaceViolations(entries.map(routeEntryToCapabilityDescriptor), policy);
  for (const ref of declared.forbidden) {
    push({
      severity: "error",
      code: "FORBIDDEN_UPSTREAM_AUTHORITY",
      message: `Upstream director reference '${ref}' declared in specialist surface; upstream must never compete with the studio director`,
      skill_id: ref,
    });
  }
  for (const ref of declared.quarantined) {
    push({
      severity: "error",
      code: "QUARANTINED_SKILL_DECLARED",
      message: `Quarantined generator '${ref}' declared in specialist surface; generators are disabled optional fallbacks only`,
      skill_id: ref,
    });
  }

  // Specialist-vs-specialist trigger collisions are hard errors: specialists must stay discriminated.
  const specialistTriggers = new Map<string, string[]>();
  for (const entry of entries) {
    for (const trigger of entry.use_when) {
      const t = norm(trigger);
      const existing = specialistTriggers.get(t) || [];
      existing.push(entry.skill_id);
      specialistTriggers.set(t, existing);
    }
  }
  for (const [trigger, skillIds] of specialistTriggers.entries()) {
    if (skillIds.length > 1) {
      push({
        severity: "error",
        code: "OVERLAY_SPECIALIST_TRIGGER_COLLISION",
        message: `Specialists ${skillIds.join(" and ")} claim identical trigger '${trigger}'; disambiguate via negative affordances`,
        skill_id: skillIds[0],
      });
    }
  }

  // Specialist-vs-studio-capability trigger collisions: coordinated overlap (bound capability) is a
  // warning; uncoordinated overlap competes with a studio contract and is a hard error.
  for (const entry of entries) {
    for (const trigger of entry.use_when) {
      const t = norm(trigger);
      for (const cap of catalog) {
        const collides = cap.use_when.some((c) => norm(c) === t);
        if (!collides) continue;
        if (entry.capability_ids.includes(cap.id)) {
          push({
            severity: "warning",
            code: "SKILL_TRIGGER_COLLISION",
            message: `[${entry.skill_id}] trigger '${trigger}' overlaps bound studio capability '${cap.id}'; specialist knowledge stays a provider below the contract`,
            skill_id: entry.skill_id,
          });
        } else {
          push({
            severity: "error",
            code: "OVERLAY_ROUTING_COLLISION",
            message: `[${entry.skill_id}] trigger '${trigger}' collides with unbound studio capability '${cap.id}'; coordinate the binding or disambiguate`,
            skill_id: entry.skill_id,
          });
        }
      }
    }
  }

  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Full studio skill/routing lint: base metadata lint of the discoverable surface (registered studio
 * capabilities) plus overlay routing lint plus top-level discoverability enforcement. This is the
 * surface bound to `bun run studio -- capabilities lint`.
 */
export function lintStudioSkillSurface(catalog: CapabilityDescriptor[], policy: SkillOverlayPolicy): SkillLintReport {
  const issues: SkillLintIssue[] = [];

  issues.push(...lintSkillRegistry(catalog).issues);
  issues.push(...lintOverlayRouting(policy, catalog).issues);

  // Enforce that nothing forbidden/quarantined became discoverable at the top level
  // (e.g. threejs-game-director registered alongside the studio director).
  const { forbidden, quarantined } = findSurfaceViolations(catalog, policy);
  for (const ref of forbidden) {
    issues.push({
      severity: "error",
      code: "FORBIDDEN_UPSTREAM_AUTHORITY",
      message: `Forbidden upstream orchestration skill '${ref}' is discoverable at the top-level studio surface`,
      skill_id: ref,
    });
  }
  for (const ref of quarantined) {
    issues.push({
      severity: "error",
      code: "QUARANTINED_SKILL_REGISTERED",
      message: `Quarantined generator '${ref}' is registered on the top-level studio surface; optional fallbacks stay disabled (REQ-BIND-007)`,
      skill_id: ref,
    });
  }

  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Registration-time enforcement for the studio-owned specialist overlay surface. The upstream
 * director can never be registered; quarantined generators can never be registered; every entry
 * must anchor to real studio capabilities with a confined disclosure pointer.
 */
export class OverlaySkillRegistry {
  private entries: SpecialistRouteEntry[] = [];
  private readonly triggers = new Map<string, string>();

  constructor(
    private readonly policy: SkillOverlayPolicy,
    private readonly studioCapabilities: CapabilityDescriptor[] = []
  ) {
    const base = validateOverlayPolicy(policy);
    if (!base.valid) {
      throw new OverlayPolicyError(`Cannot construct overlay registry from invalid policy: ${base.errors.join("; ")}`);
    }
  }

  register(entry: SpecialistRouteEntry): void {
    for (const ref of [entry.id, ...entry.providers]) {
      assertNotForbidden(ref, this.policy);
      assertSkillNotQuarantined(ref, this.policy);
    }

    if (this.studioCapabilities.length > 0) {
      const known = new Set(this.studioCapabilities.map((c) => c.id));
      for (const capId of entry.capability_ids) {
        if (!known.has(capId)) {
          throw new OverlayPolicyError(
            `Overlay entry '${entry.id}' anchors to unknown studio capability '${capId}'; specialists disclose below real studio contracts (REQ-BIND-007)`
          );
        }
      }
    }

    if (!isConstrainedDisclosureRef(entry.disclosure_ref)) {
      throw new OverlayPolicyError(`Overlay entry '${entry.id}' has an unsafe disclosure_ref '${entry.disclosure_ref}'`);
    }

    const descriptorIssues = lintSkillDescriptor(routeEntryToCapabilityDescriptor(entry)).filter((i) => i.severity === "error");
    if (descriptorIssues.length > 0) {
      throw new OverlayPolicyError(
        `Overlay entry '${entry.id}' violates the skill metadata contract: ${descriptorIssues.map((i) => i.code).join(", ")}`
      );
    }

    for (const trigger of entry.use_when) {
      const t = norm(trigger);
      const owner = this.triggers.get(t);
      if (owner && owner !== entry.id) {
        throw new OverlayPolicyError(`Trigger '${trigger}' already claimed by overlay entry '${owner}'`);
      }
      this.triggers.set(t, entry.id);
    }

    this.entries.push(entry);
  }

  list(): SpecialistRouteEntry[] {
    return [...this.entries];
  }

  has(skillId: string): boolean {
    return this.entries.some((e) => norm(e.skill_id) === norm(skillId));
  }
}

export type ProviderPreferenceCode =
  | "ALLOWED"
  | "FORBIDDEN_UPSTREAM_AUTHORITY"
  | "QUARANTINED_SKILL"
  | "CREDENTIAL_PREFERENCE_REJECTED"
  | "UNDECLARED_PROVIDER"
  | "UNKNOWN_CAPABILITY";

export interface ProviderPreferenceRequest {
  capability_id: string;
  requested_provider: string;
  credentials_present?: boolean;
  justification?: string;
}

export interface ProviderPreferenceDecision {
  allowed: boolean;
  code: ProviderPreferenceCode;
  reason: string;
}

/**
 * Provider preference policy (REQ-BIND-007, REQ-ROUTE-003): provider identity stays below studio
 * contracts. Preference must follow declared studio capability policy — never credential presence,
 * and never a quarantined generic generator or a forbidden upstream director.
 */
export function evaluateProviderPreference(
  request: ProviderPreferenceRequest,
  policy: SkillOverlayPolicy,
  catalog: CapabilityDescriptor[]
): ProviderPreferenceDecision {
  const reference = extractSkillReference(request.requested_provider);

  if (policyTokenMatches(reference, policy.forbidden_skills)) {
    return {
      allowed: false,
      code: "FORBIDDEN_UPSTREAM_AUTHORITY",
      reason: `'${request.requested_provider}' denotes a forbidden upstream orchestration director; the studio director is the sole orchestration authority`,
    };
  }

  if (policyTokenMatches(reference, policy.quarantined_skills || [])) {
    return {
      allowed: false,
      code: "QUARANTINED_SKILL",
      reason: `'${request.requested_provider}' is a quarantined optional fallback (REQ-BIND-007); credential presence ${
        request.credentials_present ? "(" + String(request.credentials_present) + ") " : ""
      }is never an enablement or preference basis`,
    };
  }

  const capability = catalog.find((c) => c.id === request.capability_id);
  if (!capability) {
    return {
      allowed: false,
      code: "UNKNOWN_CAPABILITY",
      reason: `Capability '${request.capability_id}' is not a declared studio capability`,
    };
  }

  if (!capability.providers.includes(request.requested_provider)) {
    if (request.credentials_present) {
      return {
        allowed: false,
        code: "CREDENTIAL_PREFERENCE_REJECTED",
        reason: `Credential presence alone must never prefer a provider for '${request.capability_id}' (REQ-BIND-007); preference must come from declared studio capability policy (providers: ${capability.providers.join(", ")})`,
      };
    }
    return {
      allowed: false,
      code: "UNDECLARED_PROVIDER",
      reason: `'${request.requested_provider}' is not a declared provider of studio capability '${request.capability_id}'`,
    };
  }

  return {
    allowed: true,
    code: "ALLOWED",
    reason: `'${request.requested_provider}' is a declared provider of studio capability '${request.capability_id}' and not quarantined`,
  };
}
