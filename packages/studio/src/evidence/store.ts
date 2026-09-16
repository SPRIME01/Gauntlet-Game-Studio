/**
 * Immutable ObservationRun / EvidenceManifest storage and freshness validation
 * (T20, REQ-OUT-003, REQ-GAUNTLET-006, REQ-VERIFY-001/002).
 *
 * Canonical layout: `artifacts/runs/<run-id>/` containing
 *   run.json            — ObservationRun (contract schema, strictly validated)
 *   manifest-NN.json    — EvidenceManifest(s), append-only
 *   settlement-NN.json  — SettlementRecord(s), append-only (studio gauntlet module)
 *   artifacts/...       — hashed state snapshots, captures, diagnostics, traces
 *
 * Invariants (spec-settled):
 * - Evidence is IMMUTABLE once written: an existing run directory is never rewritten
 *   (EvidenceImmutabilityError). Failed/contradictory evidence is preserved
 *   append-only; corrections are NEW manifests with NEW IDs.
 * - Freshness is decided from run/revision IDENTITY, never filename convention
 *   (EvidenceStaleError on revision mismatch).
 * - Manifests are correlated to their run by run_id AND project_revision
 *   (EvidenceCorrelationError otherwise), and artifact hashes are re-verified.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {
  EvidenceManifestSchema,
  ObservationRunSchema,
  SettlementRecordSchema,
  type EvidenceManifest,
  type ObservationRun,
  type SettlementRecord,
} from "@gauntlet/contracts";
import type {
  ArtifactRecord,
  EvidenceManifestDraft,
  ObservationRunDraft,
  ObservationSink,
} from "@gauntlet/adapters";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class EvidenceImmutabilityError extends Error {
  readonly code = "EVIDENCE_IMMUTABLE";
  constructor(message: string) {
    super(message);
    this.name = "EvidenceImmutabilityError";
  }
}

export class EvidenceStaleError extends Error {
  readonly code = "EVIDENCE_STALE";
  constructor(
    message: string,
    readonly details: { manifest_id: string; manifest_revision: string; expected_revision: string }
  ) {
    super(message);
    this.name = "EvidenceStaleError";
  }
}

export class EvidenceCorrelationError extends Error {
  readonly code = "EVIDENCE_UNCORRELATED";
  constructor(message: string) {
    super(message);
    this.name = "EvidenceCorrelationError";
  }
}

export class EvidenceSchemaError extends Error {
  readonly code = "EVIDENCE_SCHEMA_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "EvidenceSchemaError";
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface EvidenceStoreOptions {
  projectRoot: string;
  /** Override the runs root; default `<projectRoot>/artifacts/runs`. */
  runsRoot?: string;
}

export class EvidenceStore {
  readonly projectRoot: string;
  readonly runsRoot: string;

  constructor(projectRoot: string, opts?: Omit<EvidenceStoreOptions, "projectRoot">);
  constructor(opts: EvidenceStoreOptions);
  constructor(projectRootOrOpts: string | EvidenceStoreOptions, opts?: Omit<EvidenceStoreOptions, "projectRoot">) {
    if (typeof projectRootOrOpts === "string") {
      this.projectRoot = path.resolve(projectRootOrOpts);
      this.runsRoot = path.resolve(this.projectRoot, opts?.runsRoot ?? "artifacts/runs");
    } else {
      this.projectRoot = path.resolve(projectRootOrOpts.projectRoot);
      this.runsRoot = path.resolve(
        this.projectRoot,
        projectRootOrOpts.runsRoot ?? "artifacts/runs"
      );
    }
  }

  runDir(runId: string): string {
    return path.join(this.runsRoot, runId);
  }

  hasRun(runId: string): boolean {
    return fs.existsSync(path.join(this.runDir(runId), "run.json"));
  }

  listRuns(): string[] {
    if (!fs.existsSync(this.runsRoot)) return [];
    return fs
      .readdirSync(this.runsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(this.runsRoot, e.name, "run.json")))
      .map((e) => e.name)
      .sort();
  }

  /** Loads and schema-validates run.json for a run. */
  loadRun(runId: string): ObservationRun {
    const file = path.join(this.runDir(runId), "run.json");
    if (!fs.existsSync(file)) throw new EvidenceCorrelationError(`no run.json for run '${runId}'`);
    return this.parseJson(ObservationRunSchema, fs.readFileSync(file, "utf-8"), file) as ObservationRun;
  }

  /** Loads all append-only manifests for a run, in write order. */
  listManifests(runId: string): EvidenceManifest[] {
    const dir = this.runDir(runId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^manifest-\d+\.json$/.test(f))
      .sort()
      .map((f) =>
        this.parseJson(
          EvidenceManifestSchema,
          fs.readFileSync(path.join(dir, f), "utf-8"),
          path.join(dir, f)
        ) as EvidenceManifest
      );
  }

  /** Loads all append-only settlement records for a run, in write order. */
  listSettlements(runId: string): SettlementRecord[] {
    const dir = this.runDir(runId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^settlement-\d+\.json$/.test(f))
      .sort()
      .map((f) =>
        this.parseJson(
          SettlementRecordSchema,
          fs.readFileSync(path.join(dir, f), "utf-8"),
          path.join(dir, f)
        ) as SettlementRecord
      );
  }

  // -------------------------------------------------------------------------
  // Sink implementation (consumed by the browser proof harness)
  // -------------------------------------------------------------------------

  /** Creates an immutable-run sink bound to this store. */
  createRunWriter(): EvidenceRunWriter {
    return new EvidenceRunWriter(this);
  }

  /** Validates and writes run.json. Refuses to touch an existing run directory. */
  beginRun(run: ObservationRunDraft): void {
    ObservationRunSchema.parse(run);
    const dir = this.runDir(run.id);
    if (fs.existsSync(dir)) {
      throw new EvidenceImmutabilityError(
        `run '${run.id}' already exists at ${dir}; evidence is immutable once written — record a NEW run for fresh evidence`
      );
    }
    fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
    this.writeJsonAtomic(path.join(dir, "run.json"), run);
  }

  /** Validates role shape and appends a hashed artifact under artifacts/. */
  writeArtifact(runId: string, name: string, bytes: Uint8Array | string, role: string): ArtifactRecord {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new EvidenceSchemaError(`artifact name '${name}' is not a safe run-relative artifact name`);
    }
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    const rel = `artifacts/${name}`;
    this.writeBytesAtomic(path.join(this.runDir(runId), "artifacts", name), data);
    return {
      id: `artifact-${rel}`,
      path: rel,
      sha256: sha256Hex(data),
      role,
      size_bytes: data.byteLength,
      mime_type: mimeFor(name),
    };
  }

  /**
   * Validates and APPENDS a manifest (manifest-NN.json). An existing manifest ID
   * is never overwritten: failed/contradictory evidence is preserved as-is.
   */
  appendManifest(runId: string, draft: EvidenceManifestDraft): EvidenceManifest {
    const manifest = EvidenceManifestSchema.parse(draft) as EvidenceManifest;
    if (manifest.run_id !== runId) {
      throw new EvidenceCorrelationError(
        `manifest '${manifest.id}' declares run_id '${manifest.run_id}' but was appended to run '${runId}'`
      );
    }
    const run = this.loadRun(runId); // throws if run missing
    this.validateCorrelation(run, manifest);
    const dir = this.runDir(runId);
    const existing = fs
      .readdirSync(dir)
      .filter((f) => /^manifest-\d+\.json$/.test(f))
      .sort();
    for (const f of existing) {
      const prior = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as { id?: string };
      if (prior.id === manifest.id) {
        throw new EvidenceImmutabilityError(
          `manifest '${manifest.id}' already recorded in ${f}; evidence IDs are immutable — append a new manifest instead`
        );
      }
    }
    const next = `manifest-${String(existing.length + 1).padStart(2, "0")}.json`;
    this.writeJsonAtomic(path.join(dir, next), manifest);
    return manifest;
  }

  /** Validates and APPENDS a SettlementRecord (settlement-NN.json), never overwriting. */
  appendSettlement(runId: string, record: SettlementRecord): SettlementRecord {
    SettlementRecordSchema.parse(record);
    const dir = this.runDir(runId);
    if (!fs.existsSync(dir)) {
      throw new EvidenceCorrelationError(`cannot settle unknown run '${runId}'`);
    }
    const existing = fs
      .readdirSync(dir)
      .filter((f) => /^settlement-\d+\.json$/.test(f))
      .sort();
    for (const f of existing) {
      const prior = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as { id?: string };
      if (prior.id === record.id) {
        throw new EvidenceImmutabilityError(
          `settlement '${record.id}' already recorded in ${f}; settlement decisions are append-only`
        );
      }
    }
    const next = `settlement-${String(existing.length + 1).padStart(2, "0")}.json`;
    this.writeJsonAtomic(path.join(dir, next), record);
    return record;
  }

  // -------------------------------------------------------------------------
  // Freshness + correlation (identity-based, never filename-based)
  // -------------------------------------------------------------------------

  /**
   * Freshness from run/revision identity: the manifest's project_revision must
   * equal the expected current revision. Throws EvidenceStaleError otherwise.
   */
  validateFreshness(manifest: EvidenceManifest, expectedRevision: string): void {
    if (manifest.project_revision !== expectedRevision) {
      throw new EvidenceStaleError(
        `evidence manifest '${manifest.id}' belongs to project revision '${manifest.project_revision}', ` +
          `not the current revision '${expectedRevision}'; stale evidence cannot settle a requirement`,
        {
          manifest_id: manifest.id,
          manifest_revision: manifest.project_revision,
          expected_revision: expectedRevision,
        }
      );
    }
  }

  /**
   * Correlation: manifest.run_id must reference the run, and both must declare the
   * SAME project_revision. Prevents merging observations from different historical
   * runs into a fictional complete run.
   */
  validateCorrelation(run: ObservationRun, manifest: EvidenceManifest): void {
    if (manifest.run_id !== run.id) {
      throw new EvidenceCorrelationError(
        `manifest '${manifest.id}' references run '${manifest.run_id}' but was checked against run '${run.id}'`
      );
    }
    if (manifest.project_revision !== run.project_revision) {
      throw new EvidenceCorrelationError(
        `manifest '${manifest.id}' declares revision '${manifest.project_revision}' but its run ` +
          `'${run.id}' declares '${run.project_revision}'; cross-revision evidence correlation is rejected`
      );
    }
  }

  /** Re-verifies every artifact hash/size recorded by a manifest against disk. */
  verifyManifestArtifacts(runId: string, manifest: EvidenceManifest): void {
    this.verifyArtifactsAgainstDir(this.runDir(runId), manifest);
  }

  /** Hash/size verification of manifest artifacts against an explicit directory. */
  verifyArtifactsAgainstDir(dir: string, manifest: EvidenceManifest): void {
    for (const artifact of manifest.artifacts) {
      if (artifact.path.includes("..") || path.isAbsolute(artifact.path)) {
        throw new EvidenceCorrelationError(
          `manifest '${manifest.id}' references unsafe artifact path '${artifact.path}'`
        );
      }
      const file = path.join(dir, artifact.path);
      if (!fs.existsSync(file)) {
        throw new EvidenceCorrelationError(
          `manifest '${manifest.id}' artifact '${artifact.path}' is missing under ${dir}`
        );
      }
      const data = new Uint8Array(fs.readFileSync(file));
      const actual = sha256Hex(data);
      if (artifact.sha256 && artifact.sha256 !== actual) {
        throw new EvidenceCorrelationError(
          `manifest '${manifest.id}' artifact '${artifact.path}' hash mismatch ` +
            `(manifest ${artifact.sha256} vs actual ${actual}); evidence integrity violated`
        );
      }
      if (artifact.size_bytes !== undefined && artifact.size_bytes !== data.byteLength) {
        throw new EvidenceCorrelationError(
          `manifest '${manifest.id}' artifact '${artifact.path}' size mismatch`
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Committed fixture checking (`studio evidence check-fixtures`)
  // -------------------------------------------------------------------------

  /** Parses a fixtures root; each subdirectory is one fixture run with expected.json. */
  checkFixtures(fixturesRoot: string): FixturesReport {
    const root = path.resolve(fixturesRoot);
    const report: FixturesReport = {
      status: "success",
      root,
      fixtures: [],
      totals: { total: 0, passed: 0, failed: 0 },
    };
    if (!fs.existsSync(root)) {
      report.status = "failed";
      report.fixtures.push({
        fixture: path.basename(root),
        expectation: null,
        status: "invalid",
        checks: [{ code: "FIXTURES_ROOT_MISSING", pass: false, detail: `no fixtures root at ${root}` }],
      });
      report.totals.total = 1;
      report.totals.failed = 1;
      return report;
    }
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const dir of dirs) {
      const fixtureReport = this.checkFixtureDir(path.join(root, dir));
      report.fixtures.push(fixtureReport);
      report.totals.total += 1;
      if (fixtureReport.status === "invalid") report.totals.failed += 1;
      else report.totals.passed += 1;
    }
    report.status = report.totals.failed === 0 ? "success" : "failed";
    return report;
  }

  checkFixtureDir(dir: string): FixtureCheckReport {
    const checks: FixtureCheck[] = [];
    const name = path.basename(dir);
    const add = (code: string, pass: boolean, detail: string) => checks.push({ code, pass, detail });

    // expected.json declares what the fixture must prove (incl. negative controls).
    let expectation: FixtureExpectation | null = null;
    const expectedFile = path.join(dir, "expected.json");
    if (!fs.existsSync(expectedFile)) {
      add("EXPECTED_DECLARATION_MISSING", false, `fixture '${name}' has no expected.json declaration`);
    } else {
      try {
        expectation = FixtureExpectationSchema.parse(JSON.parse(fs.readFileSync(expectedFile, "utf-8"))) as FixtureExpectation;
        add("EXPECTED_DECLARATION", true, expectation.description);
      } catch (err) {
        add("EXPECTED_DECLARATION_INVALID", false, `expected.json invalid: ${errMessage(err)}`);
      }
    }

    const rejectCode = expectation?.must_reject;

    // run.json schema enforcement.
    let run: ObservationRun | null = null;
    try {
      run = this.loadRunRaw(path.join(dir, "run.json"));
      add("RUN_SCHEMA", true, `run '${run.id}' satisfies ObservationRun schema (revision ${run.project_revision})`);
    } catch (err) {
      if (rejectCode === "schema") {
        add("RUN_SCHEMA_REJECTED_AS_EXPECTED", true, `invalid run.json rejected as expected: ${errMessage(err)}`);
      } else {
        add("RUN_SCHEMA", false, `run.json failed ObservationRun schema: ${errMessage(err)}`);
      }
    }

    // Manifest schema enforcement (append-only set).
    const manifests: EvidenceManifest[] = [];
    if (run || rejectCode === "schema") {
      const manifestFiles = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => /^manifest-\d+\.json$/.test(f)).sort()
        : [];
      for (const f of manifestFiles) {
        try {
          manifests.push(
            this.parseJson(EvidenceManifestSchema, fs.readFileSync(path.join(dir, f), "utf-8"), f) as EvidenceManifest
          );
        } catch (err) {
          if (rejectCode === "schema") {
            add("MANIFEST_SCHEMA_REJECTED_AS_EXPECTED", true, `${f} rejected as expected: ${errMessage(err)}`);
          } else {
            add("MANIFEST_SCHEMA", false, `${f} failed EvidenceManifest schema: ${errMessage(err)}`);
          }
        }
      }
      if (manifestFiles.length === 0) {
        add("MANIFEST_PRESENT", false, `fixture '${name}' has no manifest-NN.json`);
      }
    }

    // Correlation (run_id + revision identity).
    if (run && manifests.length > 0) {
      if (rejectCode === "uncorrelated_manifest") {
        let rejected = false;
        const details: string[] = [];
        for (const m of manifests) {
          try {
            this.validateCorrelation(run, m);
          } catch (err) {
            rejected = true;
            details.push(errMessage(err));
          }
        }
        if (rejected) {
          add("CORRELATION_REJECTED_AS_EXPECTED", true, details.join("; "));
        } else {
          add("CORRELATION_REJECTED_AS_EXPECTED", false, "uncorrelated manifest was NOT rejected");
        }
      } else {
        let correlated = true;
        for (const m of manifests) {
          try {
            this.validateCorrelation(run, m);
          } catch (err) {
            correlated = false;
            add("CORRELATION", false, errMessage(err));
          }
        }
        if (correlated) add("CORRELATION", true, "all manifests correlate to the run (run_id + revision)");
      }
    }

    // Settlement records (append-only) must satisfy the schema when present.
    if (fs.existsSync(dir) && rejectCode !== "schema") {
      const settlementFiles = fs
        .readdirSync(dir)
        .filter((f) => /^settlement-\d+\.json$/.test(f))
        .sort();
      let settlementsOk = true;
      for (const f of settlementFiles) {
        try {
          this.parseJson(SettlementRecordSchema, fs.readFileSync(path.join(dir, f), "utf-8"), f);
        } catch (err) {
          settlementsOk = false;
          add("SETTLEMENT_SCHEMA", false, `${f} failed SettlementRecord schema: ${errMessage(err)}`);
        }
      }
      if (settlementFiles.length > 0 && settlementsOk) {
        add("SETTLEMENT_SCHEMA", true, `${settlementFiles.length} settlement record(s) schema-valid`);
      }
    }

    // Artifact hash re-verification.
    if (run && manifests.length > 0 && rejectCode !== "schema") {
      let verified = true;
      for (const m of manifests) {
        try {
          this.verifyArtifactsAgainstDir(dir, m);
        } catch (err) {
          verified = false;
          add("ARTIFACT_HASH", false, errMessage(err));
        }
      }
      if (verified) add("ARTIFACT_HASH", true, "all manifest artifacts present with matching sha256");
    }

    // Stale-revision negative control: freshness identity check must reject.
    if (rejectCode === "stale_revision") {
      const expectedRevision = expectation?.current_revision;
      if (!expectedRevision) {
        add("STALE_CONTROL", false, "stale_revision fixture requires expected.current_revision");
      } else if (manifests.length === 0) {
        add("STALE_CONTROL", false, "no parsable manifest to freshness-check");
      } else {
        let rejected = false;
        const details: string[] = [];
        for (const m of manifests) {
          try {
            this.validateFreshness(m, expectedRevision);
          } catch (err) {
            rejected = true;
            details.push(errMessage(err));
          }
        }
        if (rejected) {
          add("STALE_REJECTED_AS_EXPECTED", true, details.join("; "));
        } else {
          add("STALE_REJECTED_AS_EXPECTED", false, "stale manifest was NOT rejected by freshness validation");
        }
      }
    }

    const structuralChecks = checks.filter((c) => c.code !== "EXPECTED_DECLARATION");
    const structuralOk = structuralChecks.length > 0 && structuralChecks.every((c) => c.pass);
    const status: FixtureCheckReport["status"] = structuralOk
      ? rejectCode !== undefined
        ? "rejected_as_expected"
        : "valid"
      : "invalid";
    return { fixture: name, expectation, status, checks };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private loadRunRaw(file: string): ObservationRun {
    if (!fs.existsSync(file)) throw new EvidenceSchemaError(`missing ${file}`);
    return this.parseJson(ObservationRunSchema, fs.readFileSync(file, "utf-8"), file) as ObservationRun;
  }

  private parseJson(schema: z.ZodType, text: string, label: string): unknown {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new EvidenceSchemaError(`${label} is not valid JSON: ${errMessage(err)}`);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new EvidenceSchemaError(`${label} failed schema validation: ${result.error.message}`);
    }
    return result.data;
  }

  private writeJsonAtomic(file: string, value: unknown): void {
    const data = new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
    this.writeBytesAtomic(file, data);
  }

  private writeBytesAtomic(file: string, data: Uint8Array): void {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
}

/**
 * Per-run sink implementing the harness ObservationSink interface with canonical
 * store enforcement (schema validation + immutability + append-only manifests).
 */
export class EvidenceRunWriter implements ObservationSink {
  private runId: string | null = null;

  constructor(private readonly store: EvidenceStore) {}

  begin(run: ObservationRunDraft): void {
    this.store.beginRun(run);
    this.runId = run.id;
  }

  writeArtifact(name: string, bytes: Uint8Array | string, role: string): ArtifactRecord {
    if (!this.runId) throw new EvidenceCorrelationError("writer.begin must be called before writeArtifact");
    return this.store.writeArtifact(this.runId, name, bytes, role);
  }

  complete(manifest: EvidenceManifestDraft): void {
    if (!this.runId) throw new EvidenceCorrelationError("writer.begin must be called before complete");
    this.store.appendManifest(this.runId, manifest);
  }

  get currentRunId(): string | null {
    return this.runId;
  }
}

// ---------------------------------------------------------------------------
// Fixture expectation schema + report types
// ---------------------------------------------------------------------------

export const FixtureExpectationSchema = z
  .object({
    description: z.string().min(1),
    must_validate: z.boolean().default(false),
    must_reject: z.enum(["stale_revision", "uncorrelated_manifest", "schema"]).optional(),
    current_revision: z.string().optional(),
  })
  .strict();

export type FixtureExpectation = z.infer<typeof FixtureExpectationSchema>;

export interface FixtureCheck {
  code: string;
  pass: boolean;
  detail: string;
}

export interface FixtureCheckReport {
  fixture: string;
  expectation: FixtureExpectation | null;
  status: "valid" | "rejected_as_expected" | "invalid";
  checks: FixtureCheck[];
}

export interface FixturesReport {
  status: "success" | "failed";
  root: string;
  fixtures: FixtureCheckReport[];
  totals: { total: number; passed: number; failed: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mimeFor(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
