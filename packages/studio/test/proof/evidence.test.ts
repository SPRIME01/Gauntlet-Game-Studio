/**
 * T20 evidence store tests: immutability, append-only preservation, identity-based
 * freshness/correlation validation (TEETH-T20-002 store layer), artifact hash
 * integrity, and committed fixture checking (`studio evidence check-fixtures`).
 * Deterministic: no browser required.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EvidenceStore,
  EvidenceImmutabilityError,
  EvidenceStaleError,
  EvidenceCorrelationError,
} from "../../src/evidence/store";
import { resolveProjectRevision, RevisionUnavailableError } from "../../src/evidence/revision";
import { runDraft, manifestDraft, REVISION_A, REVISION_B } from "./helpers";

let workDir: string;
let store: EvidenceStore;
const RUN_ID = "run-fixture-ok-aaaaaaaaaa-20260915T120000Z";

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "t20-evidence-"));
  store = new EvidenceStore({ projectRoot: workDir });
  store.beginRun(runDraft({ id: RUN_ID, revision: REVISION_A }));
});

describe("EvidenceStore immutability and append-only preservation (T20, REQ-GAUNTLET-006)", () => {
  it("refuses to rewrite an existing run directory (immutable once written)", () => {
    expect(() => store.beginRun(runDraft({ id: RUN_ID, revision: REVISION_A }))).toThrow(
      EvidenceImmutabilityError
    );
    // Even a differently-shaped draft for the same run id is refused.
    expect(() => store.beginRun(runDraft({ id: RUN_ID, revision: REVISION_B }))).toThrow(
      EvidenceImmutabilityError
    );
  });

  it("preserves failed/contradictory evidence append-only: manifest ids are never overwritten", () => {
    const bytes = store.writeArtifact(
      RUN_ID,
      "state-snapshot.json",
      JSON.stringify({ channel: "state", entities: [] }),
      "state-snapshot"
    );
    const first = store.appendManifest(
      RUN_ID,
      manifestDraft({
        id: `${RUN_ID}-manifest-01`,
        runId: RUN_ID,
        revision: REVISION_A,
        artifactPaths: [{ path: bytes.path, sha256: bytes.sha256, size: bytes.size_bytes }],
      })
    );
    expect(first.result).toBe("pass");

    // A correction is a NEW manifest with a NEW id; the original stays byte-identical.
    const corrected = store.appendManifest(
      RUN_ID,
      manifestDraft({
        id: `${RUN_ID}-manifest-02`,
        runId: RUN_ID,
        revision: REVISION_A,
        result: "fail",
        artifactPaths: [{ path: bytes.path, sha256: bytes.sha256, size: bytes.size_bytes }],
      })
    );
    const manifests = store.listManifests(RUN_ID);
    expect(manifests.map((m) => m.id)).toEqual([first.id, corrected.id]);
    expect(manifests[0].result).toBe("pass"); // failed/contradictory history preserved

    expect(() =>
      store.appendManifest(
        RUN_ID,
        manifestDraft({
          id: first.id,
          runId: RUN_ID,
          revision: REVISION_A,
          artifactPaths: [{ path: bytes.path, sha256: bytes.sha256, size: bytes.size_bytes }],
        })
      )
    ).toThrow(EvidenceImmutabilityError);
  });

  it("appendSettlement never overwrites an existing settlement decision", () => {
    const record = {
      id: "settlement-fixture-ok",
      requirement_ids: ["REQ-GOAL-004"],
      decision: "failed" as const,
      evidence_manifest_ids: [`${RUN_ID}-manifest-01`],
      reason: "original contradictory decision must be preserved",
      settled_at: "2026-09-15T12:00:00Z",
    };
    store.appendSettlement(RUN_ID, record);
    expect(() => store.appendSettlement(RUN_ID, record)).toThrow(EvidenceImmutabilityError);
    expect(store.listSettlements(RUN_ID)).toHaveLength(1);
  });
});

describe("Freshness and correlation from run/revision identity (TEETH-T20-002)", () => {
  it("rejects a passing EvidenceManifest from another project revision", () => {
    const [manifest] = store.listManifests(RUN_ID);
    expect(manifest.result).toBe("pass"); // it is a PASSING manifest
    expect(() => store.validateFreshness(manifest, REVISION_B)).toThrow(EvidenceStaleError);
    try {
      store.validateFreshness(manifest, REVISION_B);
    } catch (err) {
      expect((err as EvidenceStaleError).code).toBe("EVIDENCE_STALE");
      expect((err as Error).message).toContain(REVISION_B);
    }
    // Freshness is identity-based: the SAME manifest validates for its own revision.
    expect(() => store.validateFreshness(manifest, REVISION_A)).not.toThrow();
  });

  it("rejects manifests uncorrelated with their run (run_id or revision)", () => {
    const run = store.loadRun(RUN_ID);
    const [manifest] = store.listManifests(RUN_ID);

    const foreignRun = { ...run, id: "run-other-scenario" } as typeof run;
    expect(() => store.validateCorrelation(foreignRun, manifest)).toThrow(EvidenceCorrelationError);

    const driftedRevision = { ...run, project_revision: REVISION_B } as typeof run;
    expect(() => store.validateCorrelation(driftedRevision, manifest)).toThrow(
      EvidenceCorrelationError
    );

    // Filename convention MUST NOT determine freshness: renaming the manifest file
    // does not make it fresh — identity (project_revision) does.
    expect(manifest.project_revision).toBe(REVISION_A);
    expect(() => store.validateFreshness(manifest, REVISION_B)).toThrow(EvidenceStaleError);
  });

  it("detects artifact tampering by re-verifying manifest hashes", () => {
    const [manifest] = store.listManifests(RUN_ID);
    const artifactFile = path.join(store.runDir(RUN_ID), manifest.artifacts[0].path);
    const original = fs.readFileSync(artifactFile, "utf-8");
    fs.writeFileSync(artifactFile, original + "tampered\n");
    expect(() => store.verifyManifestArtifacts(RUN_ID, manifest)).toThrow(EvidenceCorrelationError);
    fs.writeFileSync(artifactFile, original); // restore
    expect(() => store.verifyManifestArtifacts(RUN_ID, manifest)).not.toThrow();
  });
});

describe("Project revision resolution for freshness identity", () => {
  it("prefers an explicit revision and fails typed when unresolvable", () => {
    expect(resolveProjectRevision(workDir, { explicit: REVISION_A })).toBe(REVISION_A);
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "t20-nonrepo-"));
    try {
      expect(() => resolveProjectRevision(nonRepo)).toThrow(RevisionUnavailableError);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe("Committed evidence fixtures (studio evidence check-fixtures)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
  const fixturesRoot = path.join(repoRoot, "packages", "studio", "test", "proof", "fixtures");

  it("validates every committed fixture, including negative controls that must reject", () => {
    const report = new EvidenceStore({ projectRoot: repoRoot }).checkFixtures(fixturesRoot);
    expect(report.totals.total).toBeGreaterThanOrEqual(3);
    expect(report.status).toBe("success");
    const byStatus = {
      valid: report.fixtures.filter((f) => f.status === "valid").map((f) => f.fixture),
      rejected: report.fixtures.filter((f) => f.status === "rejected_as_expected").map((f) => f.fixture),
    };
    expect(byStatus.valid).toContain("run-fixture-ok");
    expect(byStatus.valid).toContain("run-fixture-contradiction");
    expect(byStatus.rejected).toContain("run-fixture-stale");
    for (const fixture of report.fixtures) {
      for (const check of fixture.checks) {
        if (!check.pass && check.code !== "EXPECTED_DECLARATION") {
          throw new Error(`fixture ${fixture.fixture} check ${check.code} failed: ${check.detail}`);
        }
      }
    }
  });
});
