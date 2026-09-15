#!/usr/bin/env bun
/**
 * @gauntlet/studio-cli
 * Command-line interface for Gauntlet Game Studio.
 */

export const CLI_VERSION = "0.2.0";

if (import.meta.main) {
  console.log(`Gauntlet Game Studio CLI v${CLI_VERSION}`);
}
