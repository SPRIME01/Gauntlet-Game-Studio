#!/usr/bin/env bun
/**
 * T24 gate: conformance:security (REQ-SEC-001/002/003/005, REQ-SAFE-003,
 * REQ-DONOR-005, REQ-SEC-006/007; preregistration:
 * .agents/preregistrations/gauntlet-game-studio-plan-T24.prereg.yaml).
 *
 * Cases (each recorded as structured JSON lines appended to
 * artifacts/plan/T24/security-cases.jsonl — append-only):
 *   SEC-01 secret-leakage scan over git-TRACKED files (committed source AND
 *         committed evidence) for credential-shaped literals;
 *   SEC-02 path traversal / unsafe archive file types rejected BEFORE any
 *         privileged side effect (direct probes of the settled T13 surface,
 *         target directory proven pristine);
 *   SEC-03 untrusted client commands rejected server-side before authoritative
 *         mutation (T12 authority suite + T23 raw-WebSocket teeth, fresh);
 *   SEC-04 donor imports / identity / branding confined to provenance surfaces
 *         (donor:audit + donor:dependency-scan + repo branding sweep);
 *   SEC-05 production observability surface carries no privileged mutation
 *         (T19 inspector, fresh);
 *   SEC-06 browser-facing source carries no credential access (REQ-SEC-001).
 *
 * Exit 0 only when every case verdicts PASS.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const evidenceDir = path.join(repoRoot, "artifacts", "plan", "T24");
const jsonlPath = path.join(evidenceDir, "security-cases.jsonl");

const runId = `t24-security-${new Date().toISOString().replace(/[-:.]/g, "")}`;
fs.mkdirSync(evidenceDir, { recursive: true });

function strippedEnv(): Record<string, string> {
  const drop = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "HUGGINGFACE_API_KEY",
    "HF_TOKEN",
    "REPLICATE_API_TOKEN",
    "GOOGLE_AI_API_KEY",
    "STABILITY_API_KEY",
    "MESHY_API_KEY",
    "TRIPO_API_KEY",
  ];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !drop.includes(k)) env[k] = v;
  }
  return env;
}

async function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: strippedEnv(),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs ?? 300_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

function tail(r: { stdout: string; stderr: string }, lines = 6): string {
  return (r.stdout + "\n" + r.stderr).trim().split("\n").slice(-lines).join(" | ").slice(0, 600);
}

interface CaseRecord {
  type: "case";
  run_id: string;
  case: string;
  spec_ids: string[];
  action: string;
  expected: string;
  observed: string;
  verdict: "PASS" | "FAIL";
  detail?: string;
}

const records: CaseRecord[] = [];
function record(r: Omit<CaseRecord, "type" | "run_id">): void {
  records.push({ type: "case", run_id: runId, ...r });
  console.log(
    `[${r.verdict}] ${r.case} (${r.spec_ids.join(",")})\n` +
      `    action:   ${r.action}\n` +
      `    expected: ${r.expected}\n` +
      `    observed: ${r.observed}`
  );
  if (r.detail) console.log(`    detail:   ${r.detail}`);
}

// ---------------------------------------------------------------------------
// SEC-01 / helpers: git-tracked file inventory
// ---------------------------------------------------------------------------
function trackedFiles(): string[] {
  const proc = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: repoRoot });
  return proc.stdout
    .toString()
    .split("\0")
    .filter((f) => f.length > 0);
}

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".py",
  ".html", ".css", ".toml", ".txt", ".sh", ".svg", ".prereg", "",
]);

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "openai-style-key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{36}\b/ },
  { name: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  {
    name: "assigned-secret-literal",
    re: /\b(api[_-]?key|secret|password|passwd|auth[_-]?token)\b\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/i,
  },
];

/**
 * Declared secret-scan baseline: pattern hits that are verified NOT to be
 * credentials, each with recorded justification. Anything not in this baseline
 * fails the gate. The single entry is the settled T03 secret-hygiene teeth
 * canary — a deliberately fake literal whose ONLY purpose is to prove the
 * config loader rejects (and never echoes) literal secrets.
 */
const SECRET_BASELINE: Array<{ file: string; pattern: string; exactContent: string; reason: string }> = [
  {
    file: "apps/studio-cli/src/cli.test.ts",
    pattern: "openai-style-key",
    exactContent: 'const leakingSecret = "sk-live-super-secret-key-12345";',
    reason:
      "T03 TEETH canary: fake literal proving loadStudioConfig REJECTS literal secrets without echoing; not a credential",
  },
  {
    file: "scripts/conformance-security.ts",
    pattern: "openai-style-key",
    exactContent: "exactContent: 'const leakingSecret = \"sk-live-super-secret-key-12345\";',",
    reason:
      "Self-declaration: this scanner's own baseline must quote the canary literal to match it exactly; not a credential",
  },
];

function scanSecrets(): { ok: boolean; observed: string; detail: string } {
  const files = trackedFiles().filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return TEXT_EXTS.has(ext) && !f.endsWith("bun.lock");
  });
  const hits: string[] = [];
  const classified: string[] = [];
  const unexpected: string[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(repoRoot, f), "utf-8");
    } catch {
      continue;
    }
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(content);
      if (m) {
        const lineNo = content.slice(0, m.index).split("\n").length;
        const line = content.split("\n")[lineNo - 1].trim();
        const baseline = SECRET_BASELINE.find(
          (b) => b.file === f && b.pattern === name && line === b.exactContent
        );
        if (baseline) {
          classified.push(`${f}:${lineNo} [${name}] BASELINE: ${baseline.reason}`);
        } else {
          unexpected.push(`${f}:${lineNo} [${name}] ${line.slice(0, 120)}`);
        }
        hits.push(`${f}:${lineNo} [${name}]`);
      }
    }
  }
  const ok = unexpected.length === 0;
  return {
    ok,
    observed: `scanned ${files.length} tracked text files with ${SECRET_PATTERNS.length} credential patterns; ${hits.length} hits: ${classified.length} classified against the declared baseline, ${unexpected.length} unexpected${ok ? "" : " (FAIL)"}`,
    detail: [...classified.map((c) => `BASELINE ${c}`), ...unexpected].slice(0, 20).join("; "),
  };
}

// ---------------------------------------------------------------------------
// SEC-02: path traversal probes against the settled T13 intake surface
// ---------------------------------------------------------------------------
async function traversalProbe(): Promise<{ ok: boolean; observed: string; detail: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "t24-sec02-"));
  const probePath = path.join(dir, "probe.ts");
  const polyhavenAbs = path.join(repoRoot, "packages", "adapters", "src", "assets", "polyhaven.ts");
  await fs.promises.writeFile(
    probePath,
    `
import { safeIntakePath, PolyHavenPathError } from "${polyhavenAbs}";
import * as fs from "node:fs";
import * as path from "node:path";
const projectRoot = process.argv[2];
const results = [];
const cases = [
  ["relative-escape", ["../../secrets/exfil.gltf"]],
  ["deep-escape", ["a/b/../../../../../etc/passwd.gltf"]],
  ["absolute-target", ["/etc/passwd"]],
  ["unsafe-file-type", ["payload.sh"]],
  ["unsafe-no-ext", ["payload"]],
];
for (const [name, segments] of cases) {
  let outcome;
  try {
    const p = safeIntakePath(projectRoot, ...segments);
    outcome = "ACCEPTED:" + p;
  } catch (err) {
    outcome = err instanceof PolyHavenPathError ? "REJECTED_UNSAFE_FILE" : "REJECTED_OTHER:" + String(err);
  }
  results.push(name + "=" + outcome);
}
const valid = safeIntakePath(projectRoot, "crate", "model.gltf");
results.push("valid-intake=" + (valid.startsWith(path.join(projectRoot, "assets", "sources", "polyhaven")) ? "INSIDE_BASE" : "OUTSIDE_BASE"));
console.log("PROBE:" + JSON.stringify({ results }));
`,
    "utf-8"
  );
  const r = await run(["bun", "run", probePath, dir], { timeoutMs: 60_000 });
  // Privileged-side-effect check: the pristine target dir must contain ONLY the probe file.
  const leftovers = fs.readdirSync(dir).filter((f) => f !== "probe.ts");
  await fs.promises.rm(dir, { recursive: true, force: true });
  try {
    const line = r.stdout.split("\n").find((l) => l.startsWith("PROBE:"));
    if (!line) return { ok: false, observed: "probe produced no PROBE line", detail: tail(r) };
    const { results } = JSON.parse(line.slice("PROBE:".length)) as { results: string[] };
    const map = Object.fromEntries(results.map((s) => [s.split("=")[0], s.split("=").slice(1).join("=")]));
    const rejectedAll = Object.entries(map)
      .filter(([k]) => k !== "valid-intake")
      .every(([, v]) => v === "REJECTED_UNSAFE_FILE");
    const ok = rejectedAll && map["valid-intake"] === "INSIDE_BASE" && leftovers.length === 0;
    return {
      ok,
      observed:
        `${results.join("; ")}; privileged side effects: ${leftovers.length === 0 ? "none (target dir pristine, zero bytes written)" : `UNEXPECTED FILES: ${leftovers.join(",")}`}`,
      detail: ok ? "" : tail(r),
    };
  } catch (err) {
    return { ok: false, observed: "probe threw", detail: `${err} :: ${tail(r)}` };
  }
}

// ---------------------------------------------------------------------------
// SEC-06: browser-facing source must not read credentials (REQ-SEC-001)
// ---------------------------------------------------------------------------
function browserCredentialScan(): { ok: boolean; observed: string; detail: string } {
  const scanDirs = [
    "examples/blackwater-relay/src",
    "packages/runtime/src",
    "packages/adapters/src/browser",
    "templates/game/src",
  ];
  const patterns: Array<{ name: string; re: RegExp }> = [
    { name: "process-env-access", re: /process\.env\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/ },
    { name: "import-meta-env", re: /import\.meta\.env/ },
    { name: "credential-literal", re: /\b(API_KEY|apiKey|api_key|accessSecret|clientSecret)\b/ },
  ];
  const hits: string[] = [];
  let scanned = 0;
  for (const d of scanDirs) {
    const abs = path.join(repoRoot, d);
    if (!fs.existsSync(abs)) continue;
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          scanned++;
          const content = fs.readFileSync(full, "utf-8");
          for (const { name, re } of patterns) {
            const m = re.exec(content);
            if (m) hits.push(`${path.relative(repoRoot, full)} [${name}: ${m[0]}]`);
          }
        }
      }
    };
    visit(abs);
  }
  return {
    ok: hits.length === 0,
    observed: `scanned ${scanned} browser-facing source files in ${scanDirs.length} dirs; ${hits.length} credential-access hits`,
    detail: hits.slice(0, 20).join("; "),
  };
}

// ---------------------------------------------------------------------------
// SEC-04: donor branding confined to provenance/attribution surfaces
// ---------------------------------------------------------------------------
/**
 * Boundary-enforcement classification for branding matches inside the trust
 * boundary modules themselves: a line that DETECTS or FORBIDS the donor must
 * name the donor to detect it (deny-list class, settled T02/T03/T09). Each
 * classified line is recorded in evidence; any match outside an enforcement
 * context fails.
 */
const ENFORCEMENT_CONTEXT_RE = /includes\(|forbidden|disallowed|reject/i;

function brandingScan(): { ok: boolean; observed: string; detail: string } {
  // Public surfaces only: first-party source, generated projects, templates, docs.
  // Allowlist: provenance/attribution surfaces + the audit tooling that MUST name
  // the donor (scripts/), plus tests asserting rejection and the graph cache.
  const scanDirs = ["packages", "apps", "templates", "examples", "README.md", "AGENTS.md"];
  const allowedInFile = (f: string) =>
    f.includes("test") ||
    f.includes("third_party/") ||
    f.includes("vendor/") ||
    f.includes("graft/") ||
    f.includes(".jolli/");
  const hits: string[] = [];
  const enforcement: string[] = [];
  let scanned = 0;
  const visit = (abs: string, rel: string) => {
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      const relFull = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git", ".tmp", "artifacts"].includes(entry.name)) continue;
        visit(full, relFull);
      } else if (/\.(ts|tsx|js|json|md|html|yaml|yml)$/.test(entry.name)) {
        if (allowedInFile(relFull)) continue;
        scanned++;
        const content = fs.readFileSync(full, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (!/Mavon/i.test(line)) return;
          if (ENFORCEMENT_CONTEXT_RE.test(line)) {
            enforcement.push(`${relFull}:${i + 1} [enforcement] ${line.trim().slice(0, 120)}`);
          } else {
            hits.push(`${relFull}:${i + 1} ${line.trim().slice(0, 120)}`);
          }
        });
      }
    }
  };
  for (const d of scanDirs) {
    const abs = path.join(repoRoot, d);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) visit(abs, d);
    else if (fs.existsSync(abs)) {
      scanned++;
      const content = fs.readFileSync(abs, "utf-8");
      content.split("\n").forEach((line, i) => {
        if (!/Mavon/i.test(line)) return;
        if (ENFORCEMENT_CONTEXT_RE.test(line)) {
          enforcement.push(`${d}:${i + 1} [enforcement] ${line.trim().slice(0, 120)}`);
        } else {
          hits.push(`${d}:${i + 1} ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
  return {
    ok: hits.length === 0,
    observed: `scanned ${scanned} public-surface files (provenance/attribution/test surfaces allowlisted); ${hits.length} donor-branding hits, ${enforcement.length} boundary-enforcement references (deny-list class, recorded)`,
    detail: [...enforcement.map((e) => `ENFORCEMENT ${e}`), ...hits].slice(0, 20).join("; "),
  };
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  console.log(`=== T24 conformance:security (run ${runId}) ===`);
  const header = { type: "run" as const, run_id: runId, started: new Date().toISOString() };
  fs.appendFileSync(jsonlPath, JSON.stringify(header) + "\n");

  // SEC-01 secret leakage over committed source AND committed evidence.
  {
    const scan = scanSecrets();
    const doctor = await run(["bun", "run", "studio", "--", "doctor", "--json"], { timeoutMs: 120_000 });
    const doctorOk = doctor.code === 0 && doctor.stdout.includes('"status": "success"');
    const ok = scan.ok && doctorOk;
    record({
      case: "SEC-01-secret-leakage",
      spec_ids: ["REQ-SEC-001", "secret_handling"],
      action: "Scan every git-tracked text file (committed source, config, docs, and plan evidence) with credential-shaped literal patterns; run studio doctor (config secret-hygiene enforcement).",
      expected: "No secrets/credentials in committed source or evidence artifacts; configuration parses under secret-hygiene rules; doctor succeeds.",
      observed: `${scan.observed}; doctor exit ${doctor.code} ${doctorOk ? "success (secret hygiene rules pass)" : "FAILED"}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [scan.detail, doctorOk ? "" : tail(doctor)].filter(Boolean).join(" :: "),
    });
  }

  // SEC-02 path traversal / unsafe file types rejected before privileged side effects.
  {
    const probe = await traversalProbe();
    record({
      case: "SEC-02-path-traversal",
      spec_ids: ["REQ-SEC-002", "REQ-SAFE-003", "TEETH-T24-003"],
      action: "Probe the settled T13 intake surface with relative escapes, deep escapes, absolute targets, unsafe file types, and extension-less payloads; prove the target directory stays pristine.",
      expected: "Every traversal/unsafe input throws the typed UNSAFE_FILE rejection BEFORE extraction/execution; zero bytes are written to privileged paths; the valid intake stays inside the intended base.",
      observed: probe.observed,
      verdict: probe.ok ? "PASS" : "FAIL",
      detail: probe.detail,
    });
  }

  // SEC-03 untrusted client commands rejected before authoritative mutation.
  {
    const authority = await run(["bun", "test", "packages/runtime/test/network/authority.test.ts"], {
      timeoutMs: 300_000,
    });
    const authorityOut = authority.stdout + authority.stderr;
    const authorityPass = /(\d+) pass/.exec(authorityOut)?.[1] ?? "0";
    const authorityFail = /(\d+) fail/.exec(authorityOut)?.[1] ?? "0";
    const authorityOk =
      !authority.timedOut && authority.code === 0 && authorityFail === "0" && authorityPass !== "0";
    const teeth = await run(
      ["bun", "run", "--cwd", "examples/blackwater-relay", "teeth:multiplayer"],
      { timeoutMs: 600_000 }
    );
    const teethOut = teeth.stdout + teeth.stderr;
    const forgedCounts = [
      /forged[_ ]rejected[=: ]*(\d+)/i.exec(teethOut)?.[0],
      /commands[_ ]rejected[=: ]*(\d+)/i.exec(teethOut)?.[0],
    ].filter(Boolean);
    const teethOk = !teeth.timedOut && teeth.code === 0;
    const ok = authorityOk && teethOk;
    record({
      case: "SEC-03-untrusted-commands",
      spec_ids: ["REQ-SEC-007", "TEETH-T24-003", "REQ-NET-009"],
      action: "Reproduce the T12 hostile-command suite (forged authoritative state, unowned entity moves, client_id forgery, replayed/malformed/oversized messages) and the T23 raw-WebSocket falsification teeth with counted rejections.",
      expected: "Server-side validation precedes every authoritative mutation; forged commands are rejected with counted rejections; the authoritative Koota snapshot is byte-identical across the attack window.",
      observed: `authority suite exit ${authority.code}: ${authorityPass} pass / ${authorityFail} fail; teeth:multiplayer exit ${teeth.code}${forgedCounts.length > 0 ? ` (counted rejections: ${forgedCounts.join(", ")})` : ""}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [authorityOk ? "" : tail(authority), teethOk ? "" : tail(teeth)].filter(Boolean).join(" :: "),
    });
  }

  // SEC-04 donor imports / identity / branding.
  {
    const audit = await run(["bun", "run", "donor:audit"], { timeoutMs: 120_000 });
    const scan = await run(["bun", "run", "donor:dependency-scan"], { timeoutMs: 120_000 });
    const brand = brandingScan();
    const auditOk = audit.code === 0 && audit.stdout.includes("0 errors");
    const scanOk = scan.code === 0;
    const ok = auditOk && scanOk && brand.ok;
    record({
      case: "SEC-04-donor-identity",
      spec_ids: ["REQ-DONOR-005", "REQ-DONOR-006", "REQ-SEC-006"],
      action: "Run donor:audit (MIT attribution + provenance + forbidden donor symbols), donor:dependency-scan (forbidden imports/dependencies/path mappings + runtime branding), and a public-surface branding sweep.",
      expected: "Donor identity appears only in provenance/attribution surfaces; zero donor imports or path mappings from first-party source; MIT notice preserved.",
      observed: `donor:audit exit ${audit.code} (${auditOk ? "0 errors" : "FAILED"}); donor:dependency-scan exit ${scan.code}; branding sweep: ${brand.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [auditOk ? "" : tail(audit), scanOk ? "" : tail(scan), brand.detail]
        .filter(Boolean)
        .join(" :: "),
    });
  }

  // SEC-05 production observability mutation absence.
  {
    const check = await run(["bun", "run", "test:production-observability"], { timeoutMs: 180_000 });
    const ok = !check.timedOut && check.code === 0 && check.stdout.includes("SUCCESS");
    record({
      case: "SEC-05-production-observability",
      spec_ids: ["REQ-SEC-005", "REQ-OBS-005"],
      action: "Inspect the mounted production observability surface with the T19 inspector, including both simulated regressions (dev control namespace exposed; injected mutation API).",
      expected: "Production surface carries zero privileged mutation APIs while reads stay available; the detector demonstrably fails both regressions.",
      observed: `exit ${check.code}, ${check.stdout.includes("SUCCESS") ? "inspector succeeded (surface clean, regressions detected)" : "INSPECTOR DID NOT SUCCEED"}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: ok ? "" : tail(check),
    });
  }

  // SEC-06 browser-facing source carries no credential access.
  {
    const scan = browserCredentialScan();
    record({
      case: "SEC-06-browser-credential-hygiene",
      spec_ids: ["REQ-SEC-001"],
      action: "Scan browser-facing source (game src, runtime src, browser adapter, game template) for process.env reads, import.meta.env, and credential-literal identifiers.",
      expected: "Zero credential access in anything that reaches a browser bundle; credentials resolve server/agent-side only.",
      observed: scan.observed,
      verdict: scan.ok ? "PASS" : "FAIL",
      detail: scan.detail,
    });
  }

  const pass = records.filter((r) => r.verdict === "PASS").length;
  const fail = records.filter((r) => r.verdict === "FAIL").length;
  for (const r of records) fs.appendFileSync(jsonlPath, JSON.stringify(r) + "\n");
  fs.appendFileSync(
    jsonlPath,
    JSON.stringify({
      type: "summary",
      run_id: runId,
      finished: new Date().toISOString(),
      pass,
      fail,
    }) + "\n"
  );
  console.log(`\n=== security matrix summary: ${pass} PASS / ${fail} FAIL ===`);
  console.log(fail === 0 ? "SECURITY_MATRIX_OK" : "SECURITY_MATRIX_FAILED");
  return fail === 0 ? 0 : 1;
}

process.exitCode = await main();
