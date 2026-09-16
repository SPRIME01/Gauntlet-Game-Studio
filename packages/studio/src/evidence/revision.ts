/**
 * Project revision resolution for evidence freshness (T20, REQ-GAUNTLET-006).
 *
 * Freshness is determined from run/revision IDENTITY, never filename convention.
 * The authoritative revision of a working project is its git HEAD commit; explicit
 * overrides are supported for fixture/generated contexts. If no revision can be
 * resolved, evidence operations fail typed rather than guessing.
 */

import { spawnSync } from "node:child_process";

export class RevisionUnavailableError extends Error {
  readonly code = "REVISION_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "RevisionUnavailableError";
  }
}

export interface ResolveRevisionOptions {
  /** Explicit revision (commit SHA or immutable tag) that wins over git detection. */
  explicit?: string;
}

/** Resolves the immutable project revision used for evidence freshness. */
export function resolveProjectRevision(projectRoot: string, opts: ResolveRevisionOptions = {}): string {
  if (opts.explicit) return opts.explicit;
  const probe = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf-8" });
  if (probe.status === 0 && probe.stdout) {
    const sha = probe.stdout.trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  }
  throw new RevisionUnavailableError(
    `could not resolve project revision in '${projectRoot}' (git rev-parse HEAD failed: ${
      (probe.stderr || "no output").trim()
    }); pass an explicit --revision so evidence freshness has an identity to bind to`
  );
}

/** Short form used inside run IDs (identity is the full SHA; short is display-only). */
export function shortRevision(revision: string): string {
  return revision.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 12) || "unknown";
}
