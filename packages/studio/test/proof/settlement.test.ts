/**
 * T20 Gauntlet settlement tests — the three preregistered teeth at the settlement
 * layer, plus channel selection, REQ-GAUNTLET-004 classification, and the
 * confirmation gate. Deterministic: no browser required. The browser gate script
 * (run-browser-proof.ts) re-proves TEETH-T20-001 end-to-end with real Chrome.
 */

import { describe, it, expect } from "bun:test";
import { settleExpectation, parseFrozenExpectation } from "../../src/gauntlet";
import type { FrozenExpectation } from "../../src/gauntlet";
import type { ChannelEvidence } from "@gauntlet/adapters";
import type { ObservationRun, EvidenceManifest } from "@gauntlet/contracts";
import { runDraft, manifestDraft, environment, REVISION_A, REVISION_B } from "./helpers";

// ---------------------------------------------------------------------------
// Fixture-level inputs (mirror the committed browser fixtures' semantics)
// ---------------------------------------------------------------------------

const EXPECTATION_RAW = {
  id: "fixture-ok",
  scenario_id: "fixture-ok",
  requirement_ids: ["REQ-GOAL-004", "REQ-VERIFY-001", "REQ-VERIFY-002", "REQ-GAUNTLET-003"],
  revision: "current",
  seed: 1337,
  steps: 3,
  view: "main",
  claims: { state: true, pixels: true, telemetry: true, network: true },
  requires_confirmation: false,
  semantic: {
    entities: [
      { id: "player", tags_include: ["player"], position_approx: { x: 3, y: 0, z: 0 }, tolerance: 1e-6 },
      { id: "checkpoint-beacon", tags_include: ["beacon"], position_approx: { x: 3, y: 0, z: 0 }, tolerance: 1e-6 },
    ],
  },
  pixels: { views: ["main"], min_width: 320, min_height: 180 },
  telemetry: { max_console_errors: 0, max_page_errors: 0, tick_advanced_min: 3 },
  network: { require_all_ok: true, min_responses: 1 },
};

const EXPECTATION = parseFrozenExpectation(EXPECTATION_RAW) as FrozenExpectation;

const RUN_ID = "run-fixture-ok-aaaaaaaaaa-20260915T120000Z";

function run(revision = REVISION_A, id = RUN_ID): ObservationRun {
  return JSON.parse(JSON.stringify(runDraft({ id, revision, scenarioId: "fixture-ok" })));
}

function manifest(revision = REVISION_A, runId = RUN_ID, result: "pass" | "fail" | "blocked" | "incomplete" = "pass"): EvidenceManifest {
  return JSON.parse(
    JSON.stringify(
      manifestDraft({
        id: `${runId}-manifest-01`,
        runId,
        revision,
        result,
        artifactPaths: [{ path: "artifacts/state-snapshot.json", sha256: "0".repeat(64), size: 10 }],
      })
    )
  );
}

/** Channel evidence where every channel agrees: state matches the expectation. */
function agreeingChannels(playerX = 3): ChannelEvidence[] {
  return [
    {
      channel: "state",
      source: "koota",
      snapshot: {
        version: 1,
        timestamp: 0,
        entities: [
          { id: "player", transform: { position: [playerX, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: ["player"] },
          { id: "checkpoint-beacon", transform: { position: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: ["beacon"] },
        ],
      },
      tick: { tick: 3, running: false, paused: true },
      read_via: ["entities.snapshot()"],
    },
    {
      channel: "pixels",
      captures: [{ view: "main", artifact: "artifacts/screenshot-main.png", sha256: "f".repeat(64), width: 640, height: 360, bytes: 20480 }],
    },
    { channel: "telemetry", console: [], page_errors: [], tick_after_steps: 3 },
    {
      channel: "network",
      responses: [{ url: "http://127.0.0.1:1/", status: 200, ok: true }],
      surface_read: { present: false, reason: "single-player" },
    },
  ];
}

const AVAILABLE = { browser_proof_available: true };

// ---------------------------------------------------------------------------
// TEETH-T20-001: a correct screenshot cannot override a semantic contradiction
// ---------------------------------------------------------------------------

describe("TEETH-T20-001: correct pixels + incorrect Koota state fail overall verification", () => {
  it("fails settlement and records the pixels-vs-state contradiction", () => {
    // Pixels, telemetry, and network all pass; the authoritative semantic state
    // reports the player at x=0 while the frozen expectation demands x=3.
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest()],
      channels: agreeingChannels(0),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });

    expect(outcome.decision).toBe("failed");
    expect(outcome.decision).not.toBe("settled");
    expect(outcome.blockage_class).toBe("represented_but_deficient");
    expect(outcome.contradictions.join(" ")).toContain("pixels_pass_state_fail");
    expect(outcome.record?.decision).toBe("failed");

    const stateChecks = outcome.channel_verdicts.find((v) => v.channel === "state")!;
    expect(stateChecks.pass).toBe(false);
    expect(stateChecks.checks.some((c) => c.code === "SEMANTIC_POSITION_MISMATCH")).toBe(true);
    const pixelsChecks = outcome.channel_verdicts.find((v) => v.channel === "pixels")!;
    expect(pixelsChecks.pass).toBe(true); // the screenshot is genuinely "correct"
  });

  it("never lets an observation-level pass manifest become a settled requirement", () => {
    // The manifest documents a fully-observed run (result "pass") — observation
    // success is not interpretation: the requirement still FAILS on semantics.
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest()],
      channels: agreeingChannels(0),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(manifest().result).toBe("pass");
    expect(outcome.decision).toBe("failed");
  });

  it("classifies a missing entity as insufficiently represented (REQ-GAUNTLET-004)", () => {
    const channels = agreeingChannels(3);
    const state = channels[0] as Extract<ChannelEvidence, { channel: "state" }>;
    state.snapshot.entities = state.snapshot.entities.filter((e) => e.id !== "player");
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest()],
      channels,
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("failed");
    expect(outcome.blockage_class).toBe("insufficiently_represented");
  });

  it("settles only when state, pixels, telemetry, and network all agree", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest()],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("settled");
    expect(outcome.contradictions).toHaveLength(0);
    expect(outcome.record?.decision).toBe("settled");
    expect(outcome.record?.evidence_manifest_ids).toEqual([`${RUN_ID}-manifest-01`]);
  });
});

// ---------------------------------------------------------------------------
// TEETH-T20-002: reusing a passing manifest from another revision is rejected
// ---------------------------------------------------------------------------

describe("TEETH-T20-002: evidence from another project revision cannot settle", () => {
  it("returns incomplete with evidence_stale for a foreign-revision manifest", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(REVISION_B), // whole observation belongs to ANOTHER revision
      manifests: [manifest(REVISION_B)],
      channels: agreeingChannels(3), // even perfectly agreeing channel evidence
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_stale");
    expect(outcome.record?.decision).not.toBe("settled");
    expect(outcome.reason).toContain("revision");
  });

  it("rejects a current-revision run cited with a foreign-revision manifest", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(REVISION_A),
      manifests: [manifest(REVISION_B)],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_stale");
  });

  it("rejects manifests uncorrelated with the run", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(REVISION_A),
      manifests: [manifest(REVISION_A, "run-some-other-run")],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_uncorrelated");
  });

  it("an expectation bound to an older revision cannot settle on current evidence", () => {
    const pinned = parseFrozenExpectation({ ...EXPECTATION_RAW, revision: REVISION_B });
    const outcome = settleExpectation({
      expectation: pinned,
      run: run(REVISION_A),
      manifests: [manifest(REVISION_A)],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_stale");
  });
});

// ---------------------------------------------------------------------------
// TEETH-T20-003: unavailable browser proof is blocked, never passed
// ---------------------------------------------------------------------------

describe("TEETH-T20-003: missing browser proof blocks and never passes", () => {
  it("blocks a pixels claim when the browser proof could not run", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest(REVISION_A, RUN_ID, "blocked")],
      channels: [],
      availability: { browser_proof_available: false, unavailable_reason: "Playwright unavailable (simulated)" },
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("blocked");
    expect(outcome.blockage_class).toBe("browser_proof_unavailable");
    expect(outcome.record?.decision).toBe("blocked");
    expect(outcome.record?.next_affordance).toContain("browser proof");
  });

  it("blocks on a typed blocked observation manifest even with availability claimed", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest(REVISION_A, RUN_ID, "blocked")],
      channels: [],
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("blocked");
    expect(outcome.blockage_class).toBe("browser_proof_unavailable");
  });

  it("reports incomplete (never passed) when a required channel was simply not captured", () => {
    const channels = agreeingChannels(3).filter((c) => c.channel !== "telemetry");
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: run(),
      manifests: [manifest()],
      channels,
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_channel_missing");
    expect(outcome.reason).toContain("telemetry");
  });

  it("cannot settle at all without any evidence manifest", () => {
    const outcome = settleExpectation({
      expectation: EXPECTATION,
      run: null,
      manifests: [],
      channels: [],
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_missing");
    expect(outcome.record).toBeNull();
    expect(outcome.reason).toContain("provider");
  });
});

// ---------------------------------------------------------------------------
// Confirmation gate and environment identity
// ---------------------------------------------------------------------------

describe("Confirmation gate and evidence identity", () => {
  it("a missing required confirmation prevents settled status", () => {
    const pinned = parseFrozenExpectation({ ...EXPECTATION_RAW, requires_confirmation: true });
    const outcome = settleExpectation({
      expectation: pinned,
      run: run(),
      manifests: [manifest()],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("confirmation_required");

    const confirmed = settleExpectation({
      expectation: pinned,
      run: run(),
      manifests: [manifest()],
      channels: agreeingChannels(3),
      availability: AVAILABLE,
      currentRevision: REVISION_A,
      confirmation: { mode: "independent_adversarial", ref: "artifacts/plan/T20/confirmation.md" },
    });
    expect(confirmed.decision).toBe("settled");
    expect(confirmed.record?.confirmation_ref).toContain("independent_adversarial");
  });

  it("carries the declared environment identity (no autoplay bypass) in run drafts", () => {
    const env = environment();
    expect(env.autoplay_bypass_flags).toBe(false);
    expect(env.executable_path).toBe("/usr/bin/google-chrome");
  });
});
