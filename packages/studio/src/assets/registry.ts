/**
 * Project-local Asset Registry for Gauntlet Game Studio.
 *
 * Storage/API authority for production assets, built strictly on the frozen
 * AssetRecord contract from @gauntlet/contracts. The registry:
 *  - validates provenance/license/source-hash at intake per origin class;
 *  - enforces the acceptance state machine (pending/accepted/rejected/blocked/degraded);
 *  - preserves rejected and superseded routes append-only (REQ-ASSET-007);
 *  - distinguishes reference-only imagery from shipped source material (REQ-ASSET-004);
 *  - runs release/asset checks for unknown provenance, missing collider/LOD policy
 *    where required, and budget failure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  validateAssetRecord,
  type AssetAcceptanceState,
  type AssetRecord,
} from "@gauntlet/contracts";
import {
  DEFAULT_ASSET_POLICY,
  evaluateAsset,
  validateProvenanceIntake,
  type AssetGateReport,
  type AssetPolicy,
} from "./gates";

export const ASSET_MANIFEST_SCHEMA = "gauntlet.asset.manifest";
export const ASSET_MANIFEST_SCHEMA_VERSION = "1.0";

export type RegistryEventKind =
  | "intake"
  | "accept"
  | "reject"
  | "block"
  | "degrade"
  | "waiver"
  | "supersede"
  | "reference";

export interface RegistryEvent {
  seq: number;
  kind: RegistryEventKind;
  asset_id: string;
  at: string;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface ReferenceOnlyEntry {
  id: string;
  uri: string;
  license?: string;
  sha256?: string;
  retrieved_at?: string;
  note?: string;
}

export interface AssetManifest {
  schema: string;
  schema_version: string;
  records: AssetRecord[];
  history?: RegistryEvent[];
  references?: ReferenceOnlyEntry[];
}

export type Waiver = {
  gate: "budget";
  reason: string;
  author: string;
  ref?: string;
};

export class AssetRegistryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssetRegistryError";
    this.code = code;
  }
}

export interface IntakeOutcome {
  record: AssetRecord;
  provenance_violations: string[];
  state: AssetAcceptanceState;
}

export interface AcceptanceOutcome {
  asset_id: string;
  state: AssetAcceptanceState;
  report: AssetGateReport;
  waiver_applied: boolean;
}

export interface AssetVerifyEntry extends AssetGateReport {
  origin: string;
  role: string;
  clean_pending: boolean;
}

export interface AssetVerifyReport {
  operation: "asset.verify_all";
  manifest_path: string;
  status: "success" | "failed";
  totals: {
    total: number;
    accepted: number;
    degraded: number;
    pending: number;
    rejected: number;
    blocked: number;
    not_acceptable: number;
  };
  assets: AssetVerifyEntry[];
}

export interface AssetRegistryOptions {
  policy?: AssetPolicy;
  now?: () => string;
  manifestPath?: string;
}

function manifestPathFor(projectRoot: string): string {
  return path.join(projectRoot, "assets", "manifest.json");
}

function emptyManifest(): AssetManifest {
  return {
    schema: ASSET_MANIFEST_SCHEMA,
    schema_version: ASSET_MANIFEST_SCHEMA_VERSION,
    records: [],
    history: [],
    references: [],
  };
}

function parseManifest(raw: string, manifestPath: string): AssetManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AssetRegistryError("MANIFEST_UNPARSEABLE", `Asset manifest at ${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const manifest = parsed as AssetManifest;
  if (manifest.schema !== ASSET_MANIFEST_SCHEMA) {
    throw new AssetRegistryError("MANIFEST_SCHEMA_MISMATCH", `Asset manifest at ${manifestPath} declares schema '${String(manifest.schema)}'; expected '${ASSET_MANIFEST_SCHEMA}'`);
  }
  if (!Array.isArray(manifest.records)) {
    throw new AssetRegistryError("MANIFEST_INVALID", `Asset manifest at ${manifestPath} must contain a 'records' array`);
  }
  return {
    schema: manifest.schema,
    schema_version: manifest.schema_version ?? ASSET_MANIFEST_SCHEMA_VERSION,
    records: manifest.records,
    history: Array.isArray(manifest.history) ? manifest.history : [],
    references: Array.isArray(manifest.references) ? manifest.references : [],
  };
}

/**
 * The Asset Registry. Loads/saves `<projectRoot>/assets/manifest.json` atomically
 * (temp file + rename) so provider failure cannot corrupt accepted assets
 * (REQ-SAFE-001). History is append-only through the API; there is no
 * delete/truncate surface for records or events.
 */
export class AssetRegistry {
  private readonly manifestPathValue: string;
  private readonly policy: AssetPolicy;
  private readonly now: () => string;
  private manifest: AssetManifest = emptyManifest();
  private loaded = false;

  constructor(projectRoot: string, options: AssetRegistryOptions = {}) {
    this.manifestPathValue = options.manifestPath ?? manifestPathFor(projectRoot);
    this.policy = options.policy ?? DEFAULT_ASSET_POLICY;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get manifestPath(): string {
    return this.manifestPathValue;
  }

  exists(): boolean {
    return fs.existsSync(this.manifestPathValue);
  }

  load(): void {
    if (!this.exists()) {
      this.manifest = emptyManifest();
      this.loaded = true;
      return;
    }
    const raw = fs.readFileSync(this.manifestPathValue, "utf-8");
    this.manifest = parseManifest(raw, this.manifestPathValue);
    for (const record of this.manifest.records) {
      validateAssetRecord(record);
    }
    this.loaded = true;
  }

  save(): void {
    if (!this.loaded) {
      throw new AssetRegistryError("NOT_LOADED", "Refusing to save an AssetRegistry that has not been loaded");
    }
    const dir = path.dirname(this.manifestPathValue);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.manifestPathValue}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.manifest, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, this.manifestPathValue);
  }

  get records(): readonly AssetRecord[] {
    return this.manifest.records;
  }

  get history(): readonly RegistryEvent[] {
    return this.manifest.history ?? [];
  }

  get references(): readonly ReferenceOnlyEntry[] {
    return this.manifest.references ?? [];
  }

  get(id: string): AssetRecord | undefined {
    return this.manifest.records.find((r) => r.id === id);
  }

  isReferenceOnly(id: string): boolean {
    return (this.manifest.references ?? []).some((r) => r.id === id);
  }

  private waivedGatesFor(id: string): Set<string> {
    const waived = new Set<string>();
    for (const event of this.history) {
      if (event.kind === "waiver" && event.asset_id === id && event.data?.["gate"] === "budget") {
        waived.add("budget");
      }
    }
    return waived;
  }

  private appendEvent(event: Omit<RegistryEvent, "seq">): void {
    if (!this.manifest.history) this.manifest.history = [];
    this.manifest.history.push({ seq: this.manifest.history.length, ...event });
  }

  private setState(id: string, state: AssetAcceptanceState): void {
    const record = this.get(id);
    if (!record) throw new AssetRegistryError("ASSET_NOT_FOUND", `Asset '${id}' is not registered`);
    record.acceptance_state = state;
  }

  /**
   * Register a reference-only image entry (REQ-ASSET-004). Reference-only
   * provenance is preserved distinctly and can never become production content.
   */
  registerReference(entry: ReferenceOnlyEntry): void {
    if (!entry.id || typeof entry.uri !== "string" || entry.uri.length === 0) {
      throw new AssetRegistryError("REFERENCE_INVALID", "Reference-only entries require at least an id and source uri");
    }
    if (!this.manifest.references) this.manifest.references = [];
    if (this.manifest.references.some((r) => r.id === entry.id)) {
      throw new AssetRegistryError("REFERENCE_DUPLICATE", `Reference '${entry.id}' is already registered`);
    }
    this.manifest.references.push({ ...entry });
    this.appendEvent({ kind: "reference", asset_id: entry.id, at: this.now(), data: { uri: entry.uri, reference_only: true } });
  }

  /**
   * Intake one candidate asset. Validates the AssetRecord contract, then runs
   * provenance/license/source-hash validation for the origin class. Assets with
   * unknown/unacceptable provenance are recorded in a blocked state (never
   * silently dropped and never accepted) with the violation evidence preserved.
   */
  intake(input: unknown): IntakeOutcome {
    let record: AssetRecord;
    try {
      record = validateAssetRecord(input);
    } catch (err) {
      throw new AssetRegistryError(
        "ASSET_RECORD_INVALID",
        `AssetRecord contract validation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (this.get(record.id)) {
      throw new AssetRegistryError("ASSET_DUPLICATE", `Asset '${record.id}' is already registered`);
    }
    if (this.isReferenceOnly(record.id)) {
      throw new AssetRegistryError("REFERENCE_COLLISION", `'${record.id}' is registered as reference-only imagery and cannot be intake'd as an asset`);
    }

    const violations = validateProvenanceIntake(record.origin, record.source_provenance);
    const blocked = violations.length > 0;
    if (blocked && (record.acceptance_state === "accepted" || record.acceptance_state === "degraded")) {
      throw new AssetRegistryError(
        "INTAKE_PROVENANCE_INVALID",
        `Refusing intake of '${record.id}' in an accepted state with invalid provenance: ${violations.map((v) => v.requirement).join(", ")}`
      );
    }
    const state: AssetAcceptanceState = blocked ? "blocked" : record.acceptance_state ?? "pending";
    const stored: AssetRecord = { ...record, acceptance_state: state };
    this.manifest.records.push(stored);
    this.appendEvent({
      kind: "intake",
      asset_id: record.id,
      at: this.now(),
      reason: blocked ? "provenance validation failed at intake" : undefined,
      data: { origin: record.origin, construction_route: record.construction_route, state },
    });
    if (blocked) {
      this.appendEvent({
        kind: "block",
        asset_id: record.id,
        at: this.now(),
        reason: violations.map((v) => `${v.requirement}: ${v.detail}`).join("; "),
        data: { violations },
      });
    }
    return { record: stored, provenance_violations: violations.map((v) => `${v.requirement}: ${v.detail}`), state };
  }

  /**
   * Attempt production acceptance. Every project-required gate must pass; any
   * budget-gate failure requires an explicit recorded waiver (degraded), any
   * other failure rejects, and any blocked gate (unknown provenance, prohibited
   * texture downgrade) blocks. Never silently accepts over-budget assets.
   */
  accept(id: string, options: { waiver?: Waiver } = {}): AcceptanceOutcome {
    const record = this.get(id);
    if (!record) throw new AssetRegistryError("ASSET_NOT_FOUND", `Asset '${id}' is not registered`);

    const report = evaluateAsset(record, {
      policy: this.policy,
      referenceOnly: this.isReferenceOnly(id),
      waivedGates: this.waivedGatesFor(id),
    });

    if (report.blockers.length === 0) {
      if (record.acceptance_state !== "accepted") {
        this.setState(id, "accepted");
        this.appendEvent({ kind: "accept", asset_id: id, at: this.now(), data: { route: record.construction_route } });
      }
      // Recompute post-acceptance so production_acceptable reflects the new state.
      const post = evaluateAsset(record, {
        policy: this.policy,
        referenceOnly: this.isReferenceOnly(id),
        waivedGates: this.waivedGatesFor(id),
      });
      return { asset_id: id, state: "accepted", report: post, waiver_applied: false };
    }

    const nonBudgetBlockers = report.blockers.filter((b) => b.gate !== "budget");
    if (nonBudgetBlockers.length === 0 && options.waiver?.gate === "budget" && options.waiver.reason && options.waiver.author) {
      this.setState(id, "degraded");
      this.appendEvent({
        kind: "waiver",
        asset_id: id,
        at: this.now(),
        reason: options.waiver.reason,
        data: { gate: "budget", author: options.waiver.author, ref: options.waiver.ref },
      });
      this.appendEvent({ kind: "degrade", asset_id: id, at: this.now(), reason: "accepted under explicit budget policy waiver" });
      const post = evaluateAsset(record, {
        policy: this.policy,
        referenceOnly: this.isReferenceOnly(id),
        waivedGates: this.waivedGatesFor(id),
      });
      return { asset_id: id, state: "degraded", report: post, waiver_applied: true };
    }

    const isBlocked = report.blockers.some((b) => b.status === "blocked");
    const reason = report.blockers.map((b) => `${b.gate}: ${b.detail}`).join("; ");
    this.setState(id, isBlocked ? "blocked" : "rejected");
    this.appendEvent({ kind: isBlocked ? "block" : "reject", asset_id: id, at: this.now(), reason });
    return { asset_id: id, state: isBlocked ? "blocked" : "rejected", report, waiver_applied: false };
  }

  reject(id: string, reason: string): void {
    this.get(id);
    this.setState(id, "rejected");
    this.appendEvent({ kind: "reject", asset_id: id, at: this.now(), reason });
  }

  block(id: string, reason: string): void {
    this.get(id);
    this.setState(id, "blocked");
    this.appendEvent({ kind: "block", asset_id: id, at: this.now(), reason });
  }

  /**
   * Supersede one asset with a successor. The predecessor stays in the manifest
   * (marked rejected with a supersession reason) and the full acceptance history
   * remains reconstructable: why it was accepted, and why it was replaced.
   */
  supersede(oldId: string, next: unknown, reason?: string): { old: AssetRecord; next: AssetRecord } {
    const oldRecord = this.get(oldId);
    if (!oldRecord) throw new AssetRegistryError("ASSET_NOT_FOUND", `Asset '${oldId}' is not registered`);
    const outcome = this.intake(next);
    if (outcome.state === "blocked") {
      throw new AssetRegistryError("SUPERSEDE_INVALID", `Successor '${outcome.record.id}' failed provenance intake and cannot supersede '${oldId}'`);
    }
    this.appendEvent({
      kind: "supersede",
      asset_id: oldId,
      at: this.now(),
      reason,
      data: { superseded_by: outcome.record.id },
    });
    this.setState(oldId, "rejected");
    this.appendEvent({ kind: "reject", asset_id: oldId, at: this.now(), reason: `superseded_by:${outcome.record.id}` });
    return { old: oldRecord, next: outcome.record };
  }

  /**
   * Release/asset check across the whole manifest. Status is "success" only when
   * every record is either production-acceptable (accepted/degraded with all
   * gates passing) or a clean pending intake. Any rejected/blocked record, any
   * accepted record failing current gates, or any pending record with broken
   * provenance fails the check.
   */
  verifyAll(): AssetVerifyReport {
    const assets: AssetVerifyEntry[] = [];
    const totals = { total: 0, accepted: 0, degraded: 0, pending: 0, rejected: 0, blocked: 0, not_acceptable: 0 };
    let failed = false;

    for (const record of this.manifest.records) {
      totals.total += 1;
      totals[record.acceptance_state] += 1;
      const report = evaluateAsset(record, {
        policy: this.policy,
        referenceOnly: this.isReferenceOnly(record.id),
        waivedGates: this.waivedGatesFor(record.id),
      });
      const cleanPending = record.acceptance_state === "pending" && report.blockers.length === 0;
      const acceptable = report.production_acceptable || cleanPending;
      if (!acceptable) {
        totals.not_acceptable += 1;
        failed = true;
      }
      assets.push({
        ...report,
        origin: record.origin,
        role: record.role,
        clean_pending: cleanPending,
      });
    }

    return {
      operation: "asset.verify_all",
      manifest_path: this.manifestPathValue,
      status: failed ? "failed" : "success",
      totals,
      assets,
    };
  }
}
