/**
 * T17 real-browser audio gesture-unlock proof (REQ-AUDIO-001, REQ-BIND-012, TEETH-T17-001).
 *
 * Runs against the REAL system Chrome (/usr/bin/google-chrome) with NO autoplay-policy
 * bypass flags of any kind. Deterministic, loopback-only.
 *
 * Sequence (order matters, contamination-free):
 *   Phase 1 — TEETH-T17-001 attack, executed over a RAW CDP WebSocket BEFORE any Playwright
 *   attachment. Rationale (observed, documented): Playwright's context/page attachment
 *   itself causes Chrome to grant the page sticky user activation (Target.activateTarget
 *   behavior), which would make the "without a user gesture" leg unobservable. Raw
 *   Runtime.evaluate over CDP grants nothing, so the page keeps hasBeenActive=false and the
 *   real policy is observable: un-gestured unlock() must leave the backend explicitly
 *   locked/suspended with the context suspended, while unrelated game logic keeps ticking.
 *
 *   Phase 2 — REAL user gesture: Playwright connects over CDP to the same tab and performs
 *   a trusted input click on #unlock; the click handler calls unlock() inside the gesture.
 *   Expected: the backend reaches "ready" through real browser gesture policy, a synthesized
 *   sound intent plays, and the game heartbeat is unaffected.
 *
 * Exit codes: 0 = proof passed; 1 = hard failure; 2 = scoped environmental blockage
 * (gesture policy not observable in this environment; reported with precise evidence, never
 * a fake pass).
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CHROME_PATH = "/usr/bin/google-chrome";
const BUILD_DIR = join(REPO_ROOT, ".tmp", "t17-browser-bundle");
const PROFILE_DIR = join(REPO_ROOT, ".tmp", "t17-chrome-profile");

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** Scoped environmental blockage: policy cannot be observed here; never a fake pass. */
function block(message: string): never {
  console.error(`BLOCKED (scoped): ${message}`);
  process.exit(2);
}

function hasDisplay(): boolean {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function waitFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  what: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn().catch(() => null);
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`timed out waiting for ${what}`);
}

/** Minimal raw CDP page-target client (Runtime.evaluate only; grants no user activation). */
class RawCdpPage {
  private ws: WebSocket;
  private nextId = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  static async connect(port: number, urlSuffix: string): Promise<RawCdpPage> {
    const target = await waitFor(async () => {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string; url: string; webSocketDebuggerUrl: string;
      }>;
      return list.find((t) => t.type === "page" && t.url.startsWith(urlSuffix)) ?? null;
    }, 30000, `page target matching ${urlSuffix}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("raw cdp ws error"));
    });
    return new RawCdpPage(ws);
  }

  public evaluate<T>(expression: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const mid = ++this.nextId;
      const onMessage = (ev: MessageEvent) => {
        const data = JSON.parse(ev.data as string);
        if (data.id !== mid) return;
        this.ws.removeEventListener("message", onMessage);
        if (data.error) reject(new Error(`cdp ${data.error.message}`));
        else resolve(data.result?.result?.value as T);
      };
      this.ws.addEventListener("message", onMessage);
      this.ws.send(
        JSON.stringify({
          id: mid,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        })
      );
    });
  }

  public close(): void {
    this.ws.close();
  }
}

async function main(): Promise<void> {
  console.log("=== T17 browser audio gesture-unlock proof (real system Chrome, no autoplay bypass) ===");

  // 1. Environment preflight.
  if (!(await Bun.file(CHROME_PATH).exists())) {
    fail(`system Chrome not found at ${CHROME_PATH}`);
  }
  console.log(`OK: system Chrome present at ${CHROME_PATH}`);

  // 2. Bundle the browser entry with Bun (deterministic, offline).
  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "browser-entry.ts")],
    outdir: BUILD_DIR,
    target: "browser",
    format: "esm",
    naming: "entry.js",
    minify: false,
  });
  if (!build.success) {
    fail(`browser bundle failed: ${build.logs.map(String).join("\n")}`);
  }
  console.log(`OK: browser entry bundled to ${join(BUILD_DIR, "entry.js")}`);

  // 3. Serve fixture + bundle over loopback.
  const fixture = await Bun.file(join(import.meta.dir, "unlock-fixture.html")).text();
  const entryJs = await Bun.file(join(BUILD_DIR, "entry.js")).text();
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(fixture, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/entry.js") {
        return new Response(entryJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  console.log(`OK: fixture served at ${baseUrl}`);

  // 4. Launch the REAL system Chrome directly (headed when a display exists; headless=new
  // otherwise). The ONLY flags are profile/debugging/window basics — nothing touches
  // autoplay policy. Passing the fixture URL as a launch argument means Chrome itself opens
  // the tab, so no automation navigation ever grants it user activation.
  const headless = !hasDisplay();
  const debugPort = 30000 + Math.floor(Math.random() * 20000);
  const chromeArgs = [
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    `--remote-debugging-port=${debugPort}`,
    ...(headless ? ["--headless=new"] : []),
    baseUrl,
  ];
  console.log(
    `MODE: ${headless ? "headless=new (no display available)" : "headed (production-compatible)"}; ` +
    `chrome args: ${JSON.stringify(chromeArgs)}`
  );
  const chrome = spawn(CHROME_PATH, chromeArgs, { stdio: "ignore" });
  const chromeExited = new Promise<never>((_, reject) =>
    chrome.on("exit", (code) => reject(new Error(`chrome exited early with code ${code}`)))
  );

  try {
    await Promise.race([
      waitFor(async () => {
        const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        return version.Browser as string;
      }, 30000, "chrome devtools endpoint"),
      chromeExited,
    ]);

    // ---------------- Phase 1: TEETH-T17-001 — unlock attempt WITHOUT a gesture ----------------
    // Raw CDP only: Playwright is NOT attached yet, so nothing has granted activation.
    {
      const cdp = await Promise.race([
        RawCdpPage.connect(debugPort, baseUrl),
        chromeExited,
      ]);

      await Promise.race([
        waitFor(async () => {
          const ready = await cdp.evaluate(
            "Boolean(window.backend && window.game && document.getElementById('state')?.textContent === 'loaded')"
          );
          return ready === true ? true : null;
        }, 20000, "fixture page ready"),
        chromeExited,
      ]);

      const initial = await Promise.race([
        cdp.evaluate(`(() => ({
          state: window.backend.getState(),
          contextState: window.contextState(),
          unlockAttempted: window.backend.unlockWasAttempted,
          activation: { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive },
        }))()`),
        chromeExited,
      ]) as any;
      console.log(`PHASE1 initial: ${JSON.stringify(initial)}`);
      if (initial.state !== "locked") {
        fail(`expected fresh backend state "locked", got "${initial.state}"`);
      }
      if (initial.contextState !== "not-created") {
        fail(`expected no underlying AudioContext before unlock attempt, got "${initial.contextState}"`);
      }
      if (initial.activation.hasBeenActive !== false) {
        block(
          `page already has user activation (hasBeenActive=${initial.activation.hasBeenActive}) before any ` +
          `interaction; the gesture policy is not observable in this environment. Known automation artifact: ` +
          `re-run on an environment where tab creation does not grant activation. No bypass flags were used.`
        );
      }

      // THE ATTACK: unlock() invoked from a timer — no user activation anywhere.
      const ticksBefore = await Promise.race([
        cdp.evaluate(`window.game.ticks`),
        chromeExited,
      ]) as number;
      await Promise.race([
        cdp.evaluate(`window.attemptUnlockWithoutGesture()`),
        chromeExited,
      ]);
      await new Promise((r) => setTimeout(r, 900)); // beyond the 400ms observation window

      const afterAttack = await Promise.race([
        cdp.evaluate(`(() => ({
          state: window.backend.getState(),
          contextState: window.contextState(),
          ticks: window.game.ticks,
          crashed: window.game.crashed,
          diag: window.backend.getDiagnostics(),
        }))()`),
        chromeExited,
      ]) as any;
      console.log(`PHASE1 after un-gestured unlock attempt: ${JSON.stringify(afterAttack)}`);
      if (afterAttack.state === "ready" || afterAttack.contextState === "running") {
        fail(`audio reached ready/running WITHOUT a user gesture (autoplay policy bypassed?)`);
      }
      if (afterAttack.state !== "locked" && afterAttack.state !== "suspended") {
        fail(`unexpected backend state "${afterAttack.state}" after un-gestured attempt`);
      }
      if (afterAttack.crashed) {
        fail("game heartbeat crashed during un-gestured unlock attempt");
      }
      if (afterAttack.ticks <= ticksBefore + 10) {
        fail(`unrelated game logic stopped ticking during the attack (before=${ticksBefore}, after=${afterAttack.ticks})`);
      }
      // Suppressed intents while locked: playSound must be a dead handle, not a crash.
      const suppressedProbe = await Promise.race([
        cdp.evaluate(`(() => {
          const handle = window.backend.playSound({ soundEvent: "ui.confirm", volume: 0.5 });
          return { stopped: handle.stopped, diag: window.backend.getDiagnostics() };
        })()`),
        chromeExited,
      ]) as any;
      console.log(`PHASE1 playSound-while-locked: ${JSON.stringify(suppressedProbe)}`);
      if (!suppressedProbe.stopped || suppressedProbe.diag.intents_played !== 0) {
        fail("audio intent was played despite locked state (REQ-SAFE-007 violation)");
      }
      cdp.close();
      console.log("PASS: TEETH-T17-001 — un-gestured unlock leaves audio explicitly locked/suspended; game logic unaffected");
    }

    // ---------------- Phase 2: REAL user gesture unlock (Playwright trusted click) ----------------
    {
      const browser = await Promise.race([
        chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`),
        chromeExited,
      ]);
      const context = browser.contexts()[0];
      if (!context) fail("no browser context over CDP");
      const page = context.pages()[0];
      if (!page) fail("no page over CDP");

      const pre = await page.evaluate(() => ({
        state: window.backend.getState(),
        contextState: window.contextState(),
      }));
      console.log(`PHASE2 pre-click (still un-gestured result): ${JSON.stringify(pre)}`);
      if (pre.state === "ready" || pre.contextState === "running") {
        fail(`audio unexpectedly ready before the real gesture (${JSON.stringify(pre)})`);
      }

      // REAL trusted user gesture: Playwright dispatches native input events through the
      // browser input pipeline, granting document user activation to the click handler,
      // which calls unlock() inside the gesture.
      await page.click("#unlock");
      await page.waitForFunction(
        () => document.getElementById("state")?.textContent === "ready",
        undefined,
        { timeout: 5000 }
      );

      const post = await page.evaluate(() => ({
        state: window.backend.getState(),
        contextState: window.contextState(),
        diag: window.backend.getDiagnostics(),
        ticks: window.game.ticks,
        diagText: document.getElementById("diag")?.textContent ?? "",
      }));
      console.log(`PHASE2 after real click: ${JSON.stringify(post)}`);
      if (post.state !== "ready") {
        fail(`backend did not reach "ready" after a real user gesture (state="${post.state}")`);
      }
      if (post.contextState !== "running") {
        fail(`underlying context should be "running" after gesture, got "${post.contextState}"`);
      }
      if (post.diag.intents_played < 1) {
        fail(`expected at least one played intent after ready, diagnostics=${JSON.stringify(post.diag)}`);
      }
      if (!post.diagText.includes("played=true")) {
        fail(`expected playback handle active after gesture, diag text="${post.diagText}"`);
      }
      if (post.ticks < 10) {
        fail(`game heartbeat stopped after audio unlock (ticks=${post.ticks})`);
      }
      await browser.close(); // disconnects CDP session; chrome stays until cleanup
      console.log("PASS: real user gesture unlocks audio to ready through browser policy; playback participates");
    }

    console.log("SUCCESS: T17 browser audio gesture-unlock proof passed.");
  } finally {
    chrome.kill("SIGKILL");
    server.stop(true);
    rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  fail(`unexpected runner error: ${err instanceof Error ? err.stack : String(err)}`);
});
