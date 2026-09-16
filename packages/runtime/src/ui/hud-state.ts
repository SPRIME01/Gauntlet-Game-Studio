/**
 * First-party DOM/CSS HUD conventions — semantic state model (T17).
 *
 * The HUD model is pure data and lives here in the runtime so UI can participate in gameplay
 * consequences without any DOM dependency. Importing this module in a headless/server
 * environment is explicitly supported; DOM binding is a separate, opt-in renderer
 * (see ./dom-hud) that must never be constructed on server paths.
 */

export interface HudStateSnapshot {
  readonly health: number;
  readonly maxHealth: number;
  readonly score: number;
  /** Current transient message, or null. */
  readonly message: string | null;
  /** True when a message is currently displayed. */
  readonly messageVisible: boolean;
  /** True when the game-over state is displayed. */
  readonly gameOver: boolean;
  /** Monotonic revision counter; increments on every semantic change. */
  readonly revision: number;
}

export interface HudModelOptions {
  readonly maxHealth?: number;
  readonly startHealth?: number;
  /** How long transient messages stay visible, in ms. Default 2500. */
  readonly messageTtlMs?: number;
}

const DEFAULT_MAX_HEALTH = 100;

/**
 * HudModel: authoritative HUD state as pure data. No DOM, no provider types.
 * Changes are observable via revision counter so renderers can diff cheaply.
 */
export class HudModel {
  private health: number;
  private readonly maxHealth: number;
  private score = 0;
  private message: string | null = null;
  private messageUntil = 0;
  private gameOver = false;
  private revision = 0;
  private readonly messageTtlMs: number;

  constructor(options: HudModelOptions = {}) {
    this.maxHealth = options.maxHealth ?? DEFAULT_MAX_HEALTH;
    this.health = Math.min(options.startHealth ?? this.maxHealth, this.maxHealth);
    this.messageTtlMs = options.messageTtlMs ?? 2500;
  }

  /** Apply semantic damage/heal. Clamped to [0, maxHealth]. */
  public setHealth(value: number): void {
    const next = Math.min(this.maxHealth, Math.max(0, value));
    if (next !== this.health) {
      this.health = next;
      this.touch();
    }
  }

  public getHealth(): number {
    return this.health;
  }

  public getMaxHealth(): number {
    return this.maxHealth;
  }

  public addScore(delta: number): void {
    if (delta !== 0) {
      this.score = Math.max(0, this.score + delta);
      this.touch();
    }
  }

  public getScore(): number {
    return this.score;
  }

  /** Show a transient message (e.g. pickups, wave announcements). */
  public showMessage(text: string): void {
    this.message = text;
    this.messageUntil = Date.now() + this.messageTtlMs;
    this.touch();
  }

  public clearMessage(): void {
    if (this.message !== null) {
      this.message = null;
      this.messageUntil = 0;
      this.touch();
    }
  }

  public setGameOver(value: boolean): void {
    if (value !== this.gameOver) {
      this.gameOver = value;
      this.touch();
    }
  }

  public isGameOver(): boolean {
    return this.gameOver;
  }

  /**
   * Expire the transient message if its TTL elapsed. Call from any cadence (render loop,
   * scheduler tick); pure bookkeeping.
   */
  public expireTransient(now: number = Date.now()): void {
    if (this.message !== null && now >= this.messageUntil) {
      this.message = null;
      this.touch();
    }
  }

  /** Pure-data snapshot for renderers, diagnostics, and tests. */
  public snapshot(): HudStateSnapshot {
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      score: this.score,
      message: this.message,
      messageVisible: this.message !== null,
      gameOver: this.gameOver,
      revision: this.revision,
    };
  }

  private touch(): void {
    this.revision++;
  }
}
