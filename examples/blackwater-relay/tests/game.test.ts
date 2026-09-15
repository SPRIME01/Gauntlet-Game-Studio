import { describe, expect, it } from "bun:test";
import { createGame, GameInstance } from "../src/index";

describe("Generated Game Conformance", () => {
  it("initializes game instance independently", () => {
    const game = createGame();
    expect(game).toBeInstanceOf(GameInstance);
    expect(game.isRunning()).toBe(false);

    game.start();
    expect(game.isRunning()).toBe(true);

    game.stop();
    expect(game.isRunning()).toBe(false);
  });
});
