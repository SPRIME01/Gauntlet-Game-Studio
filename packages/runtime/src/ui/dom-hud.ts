/**
 * DOM/CSS HUD renderer conventions (T17).
 *
 * Headless-safety contract:
 * - Importing this module NEVER requires a DOM (no top-level `document` access).
 * - DomHudRenderer requires an explicit HTMLElement mount at construction; constructing it
 *   without a DOM throws HudDomUnavailableError instead of crashing server paths.
 * - The renderer is an execution projection of HudModel: it never writes back into the
 *   model or into game semantics, and it can be torn down/recreated at any time.
 * - All styling is first-party CSS text (HUD_BASE_CSS) attached in a <style> element
 *   scoped under .gauntlet-hud — no external CSS dependencies.
 */

import type { HudModel, HudStateSnapshot } from "./hud-state";

/** Error thrown when DOM HUD binding is requested without a DOM environment. */
export class HudDomUnavailableError extends Error {
  constructor(detail: string) {
    super(`DOM HUD unavailable in this environment: ${detail}`);
    this.name = "HudDomUnavailableError";
  }
}

/** First-party HUD stylesheet. Class names are stable conventions for specialist UI handoff. */
export const HUD_BASE_CSS = `
.gauntlet-hud, .gauntlet-hud * { box-sizing: border-box; margin: 0; padding: 0; }
.gauntlet-hud {
  position: absolute; inset: 0; pointer-events: none;
  font-family: system-ui, sans-serif; color: #eef2f7;
  display: flex; flex-direction: column; justify-content: space-between;
  z-index: 10;
}
.gauntlet-hud__topbar {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 12px 16px; gap: 16px;
}
.gauntlet-hud__health { min-width: 180px; }
.gauntlet-hud__health-bar {
  height: 10px; border-radius: 5px; background: rgba(20, 26, 34, 0.75);
  overflow: hidden; border: 1px solid rgba(238, 242, 247, 0.35);
}
.gauntlet-hud__health-fill {
  height: 100%; width: 100%; background: #46d17f;
  transition: width 120ms linear;
}
.gauntlet-hud__health-fill[data-low="true"] { background: #e05252; }
.gauntlet-hud__health-text { font-size: 12px; margin-top: 4px; opacity: 0.9; }
.gauntlet-hud__score { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.gauntlet-hud__message {
  align-self: center; padding: 8px 18px; border-radius: 6px;
  background: rgba(20, 26, 34, 0.85); font-size: 15px;
}
.gauntlet-hud__message[hidden] { display: none; }
.gauntlet-hud__gameover {
  align-self: center; margin-bottom: 18vh; text-align: center;
  font-size: 34px; font-weight: 800; letter-spacing: 2px;
}
.gauntlet-hud__gameover[hidden] { display: none; }
`.trim();

const HUD_ROOT_CLASS = "gauntlet-hud";

export interface DomHudRendererOptions {
  /** Document used for element creation; defaults to globalThis.document. */
  readonly doc?: Document;
}

/**
 * Renders HudModel snapshots into a mounted DOM subtree. DOM-required by construction;
 * never construct on headless/server paths.
 */
export class DomHudRenderer {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly scoreText: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;
  private lastRevision = -1;
  private disposed = false;

  constructor(public readonly model: HudModel, mount: HTMLElement, options: DomHudRendererOptions = {}) {
    const doc = options.doc ?? (typeof document !== "undefined" ? document : undefined);
    if (!doc) {
      throw new HudDomUnavailableError("no DOM document is available (headless environment)");
    }
    if (!mount) {
      throw new HudDomUnavailableError("no mount element was provided");
    }
    this.doc = doc;
    this.root = this.buildRoot(doc);
    mount.appendChild(this.root);

    this.healthFill = this.query(".gauntlet-hud__health-fill");
    this.healthText = this.query(".gauntlet-hud__health-text");
    this.scoreText = this.query(".gauntlet-hud__score");
    this.messageEl = this.query(".gauntlet-hud__message");
    this.gameOverEl = this.query(".gauntlet-hud__gameover");

    this.render();
  }

  /**
   * One-way render of the current model snapshot. Cheap: skips DOM writes entirely when
   * the model revision is unchanged.
   */
  public render(): HudStateSnapshot {
    if (this.disposed) {
      throw new HudDomUnavailableError("renderer was disposed");
    }
    const snap = this.model.snapshot();
    if (snap.revision === this.lastRevision) {
      return snap;
    }
    this.lastRevision = snap.revision;

    const pct = snap.maxHealth > 0 ? (snap.health / snap.maxHealth) * 100 : 0;
    (this.healthFill as HTMLElement).style.width = `${pct}%`;
    this.healthFill.setAttribute("data-low", String(snap.health / snap.maxHealth <= 0.25));
    this.healthText.textContent = `${Math.round(snap.health)} / ${snap.maxHealth}`;
    this.scoreText.textContent = String(snap.score);
    if (snap.messageVisible && snap.message !== null) {
      this.messageEl.textContent = snap.message;
      this.messageEl.removeAttribute("hidden");
    } else {
      this.messageEl.setAttribute("hidden", "");
    }
    if (snap.gameOver) {
      this.gameOverEl.removeAttribute("hidden");
    } else {
      this.gameOverEl.setAttribute("hidden", "");
    }
    return snap;
  }

  /** Removes the HUD subtree. The HudModel remains authoritative and untouched. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  private buildRoot(doc: Document): HTMLElement {
    ensureStylesheet(doc);
    const root = doc.createElement("div");
    root.className = HUD_ROOT_CLASS;
    root.innerHTML = `
      <div class="gauntlet-hud__topbar">
        <div class="gauntlet-hud__health">
          <div class="gauntlet-hud__health-bar"><div class="gauntlet-hud__health-fill"></div></div>
          <div class="gauntlet-hud__health-text">100 / 100</div>
        </div>
        <div class="gauntlet-hud__score">0</div>
      </div>
      <div class="gauntlet-hud__message" hidden></div>
      <div class="gauntlet-hud__gameover" hidden>GAME OVER</div>
    `.trim();
    return root;
  }

  private query(selector: string): HTMLElement {
    const el = this.root.querySelector(selector);
    if (!el) {
      throw new HudDomUnavailableError(`HUD template is missing element '${selector}'`);
    }
    return el as HTMLElement;
  }
}

function ensureStylesheet(doc: Document): void {
  if (doc.querySelector("style[data-gauntlet-hud-css]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-gauntlet-hud-css", "");
  style.textContent = HUD_BASE_CSS;
  doc.head.appendChild(style);
}
