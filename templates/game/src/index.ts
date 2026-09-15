/**
 * Game Entry Point
 * Conforms to Gauntlet Game Studio independent project contract.
 */

export interface GameConfig {
  canvas?: HTMLCanvasElement;
  debug?: boolean;
}

export class GameInstance {
  private running = false;

  constructor(public readonly config: GameConfig = {}) {}

  public start(): void {
    this.running = true;
  }

  public stop(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }
}

export function createGame(config?: GameConfig): GameInstance {
  return new GameInstance(config);
}
