import { describe, expect, it } from "bun:test";
import { DomHudRenderer, HudDomUnavailableError, HudModel, HUD_BASE_CSS } from "../src/index";

describe("DOM/CSS HUD conventions headless safety (T17)", () => {
  it("HudModel is pure data and import-safe with no DOM", () => {
    expect(typeof document).toBe("undefined");

    const model = new HudModel();
    const before = model.snapshot();
    expect(before).toEqual({
      health: 100,
      maxHealth: 100,
      score: 0,
      message: null,
      messageVisible: false,
      gameOver: false,
      revision: 0,
    });

    model.setHealth(40);
    model.addScore(25);
    model.showMessage("Wave 2 incoming");
    const mid = model.snapshot();
    expect(mid.health).toBe(40);
    expect(mid.score).toBe(25);
    expect(mid.messageVisible).toBe(true);
    expect(mid.revision).toBe(3);

    // Clamping and game-over semantics.
    model.setHealth(-10);
    expect(model.getHealth()).toBe(0);
    model.setGameOver(true);
    expect(model.isGameOver()).toBe(true);

    // Transient message expiry.
    model.expireTransient(Date.now() + 10_000);
    expect(model.snapshot().messageVisible).toBe(false);
  });

  it("DomHudRenderer refuses to construct without a DOM instead of crashing the server path", () => {
    expect(typeof document).toBe("undefined");
    const model = new HudModel();
    // Bun headless: no global document and no mount element.
    expect(() => new DomHudRenderer(model, undefined as unknown as HTMLElement)).toThrow(
      HudDomUnavailableError
    );
  });

  it("HUD stylesheet conventions are first-party CSS text with stable class names", () => {
    expect(HUD_BASE_CSS).toContain(".gauntlet-hud");
    expect(HUD_BASE_CSS).toContain(".gauntlet-hud__health-fill");
    expect(HUD_BASE_CSS).toContain(".gauntlet-hud__score");
    expect(HUD_BASE_CSS).not.toMatch(/url\(|@import/);
  });
});
