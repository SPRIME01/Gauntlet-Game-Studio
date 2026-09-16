/**
 * Blackwater Relay — headless boot for pure tests (T22, REQ-AUDIO-002).
 *
 * Boots the full game core (terrain, physics, navigation, spatial, Koota state,
 * scenarios, observability surface on an isolated target) with NO DOM, NO WebGL, and
 * the NullAudioBackend. Browser-only projections are simply absent.
 */

import { bootGameCore, type GameCore } from "./build";

/** The headless game handle: the authoritative core under a stable accessor. */
export type HeadlessGame = { core: GameCore };

let active: GameCore | null = null;

/** Boots an isolated headless game (one scheduler process-wide at a time). */
export async function bootHeadlessGame(
  options: { fixtureCorruptGate?: boolean } = {}
): Promise<HeadlessGame> {
  if (active) {
    active.dispose();
    active = null;
  }
  const target: Record<string, unknown> = {};
  const core = await bootGameCore({
    mode: "test",
    target,
    ...(options.fixtureCorruptGate ? { fixtureCorruptGate: options.fixtureCorruptGate } : {}),
  });
  active = core;
  return { core };
}

/** Disposes the active headless core (required between tests: single scheduler rule). */
export function disposeHeadlessGame(game: HeadlessGame): void {
  game.core.dispose();
  if (active === game.core) active = null;
}
