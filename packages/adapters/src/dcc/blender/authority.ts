/**
 * Blend/DCC metadata authority boundary (T18, REQ-BLENDER-005, REQ-RUNTIME-001).
 *
 * Blender scene state and .blend-side metadata NEVER own gameplay semantics:
 * quest state, NPC behavior, dialogue, objectives, factions, health, and any
 * other gameplay-authority claims found in DCC metadata are rejected here —
 * before a .blend is generated, and again at deterministic verify time
 * against the committed bake report and GLB node extras.
 *
 * The runtime's sole semantic authority stays Koota (packages/runtime/src/state);
 * DCC metadata may only ever ride along as AssetRecord affordance metadata.
 */

export const BLEND_SEMANTIC_AUTHORITY_REJECTED = "BLEND_SEMANTIC_AUTHORITY_REJECTED";

export interface BlendSemanticFinding {
  /** JSON-style path of the offending key inside the metadata tree. */
  path: string;
  key: string;
  /** String form of the matched forbidden pattern. */
  pattern: string;
}

/**
 * Keys that claim gameplay semantics. Detection is intentionally broad:
 * anything that looks like quest/NPC/gameplay authority is rejected rather
 * than smuggled into shipped assets.
 */
export const BLEND_FORBIDDEN_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /quest/i,
  /npc/i,
  /dialog(ue)?/i,
  /objective/i,
  /faction/i,
  /reputation/i,
  /inventory/i,
  /gameplay/i,
  /mission/i,
  /character_sheet/i,
  /hit_?points/i,
  /\bhealth\b/i,
  /\bhostile\b/i,
  /\bweapon_damage\b/i,
  /\bscore\b/i,
];

export class BlendSemanticAuthorityError extends Error {
  code = BLEND_SEMANTIC_AUTHORITY_REJECTED;
  findings: BlendSemanticFinding[];
  constructor(message: string, findings: BlendSemanticFinding[]) {
    super(message);
    this.name = "BlendSemanticAuthorityError";
    this.findings = findings;
  }
}

/** Lists every gameplay-semantics key found in a DCC metadata tree. */
export function listBlendSemanticFindings(metadata: unknown, prefix = "dcc_metadata"): BlendSemanticFinding[] {
  const findings: BlendSemanticFinding[] = [];
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, i) => visit(entry, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      const matched = BLEND_FORBIDDEN_KEY_PATTERNS.find((pattern) => pattern.test(key));
      if (matched) {
        findings.push({ path: childPath, key, pattern: String(matched) });
      }
      visit(child, childPath);
    }
  };
  visit(metadata, prefix);
  return findings;
}

/**
 * Asserts that DCC/.blend-side metadata carries no gameplay semantics.
 * Throws BlendSemanticAuthorityError (code BLEND_SEMANTIC_AUTHORITY_REJECTED)
 * listing every finding — the rejection is the point, not silent filtering.
 */
export function assertNoGameSemanticsInBlendMetadata(metadata: unknown, source = "dcc metadata"): void {
  const findings = listBlendSemanticFindings(metadata);
  if (findings.length > 0) {
    throw new BlendSemanticAuthorityError(
      `${source} attempts to store gameplay semantics (quest/NPC/gameplay authority) outside the game model; ` +
        `Blender scene state and DCC metadata are never semantic authority (REQ-BLENDER-005, REQ-RUNTIME-001): ` +
        findings.map((f) => `${f.path} (matched ${f.pattern})`).join("; "),
      findings
    );
  }
}
