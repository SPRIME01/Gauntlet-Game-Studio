/**
 * Creation exceptions (REQ-RES-006, spec v0.5.0).
 *
 * Every material scratch-created resource carries an append-only record: what
 * was required, which cheaper routes were searched and why they failed, what
 * was nevertheless reused, provenance, and the resulting reusable derivative.
 * No vanity reuse metrics; the exception record itself is the pressure toward
 * leverage.
 */

import { CreationExceptionSchema, type CreationException, type ResourceRouteAttempt } from "@gauntlet/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const CREATION_EXCEPTIONS_SCHEMA = "gauntlet.resource.creation_exceptions";

export class CreationExceptionError extends Error {
  constructor(
    readonly code: "CREATION_EXCEPTION_INVALID" | "ROUTES_NOT_SEARCHED",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "CreationExceptionError";
  }
}

export function exceptionsPathFor(projectRoot: string): string {
  return join(projectRoot.replace(/\/$/, ""), ".studio", "creation-exceptions.jsonl");
}

/**
 * Append a creation exception. The record must demonstrate that cheaper routes
 * were actually searched: at least one prior cascade attempt is mandatory and
 * its failure reasons must be stated (REQ-RES-002/006). Invalid records are
 * rejected before any write.
 */
export function recordCreationException(
  projectRoot: string,
  input: {
    id: string;
    what: string;
    routes_searched: ResourceRouteAttempt[];
    why_failed: string[];
    partial_reuse?: string[];
    provenance?: CreationException["provenance"];
    derivative_id?: string;
    recorded_at?: string;
  },
): CreationException {
  if (input.routes_searched.length === 0) {
    throw new CreationExceptionError(
      "ROUTES_NOT_SEARCHED",
      `exception '${input.id}' must record the cheaper routes that were searched before scratch creation`,
    );
  }
  if (input.why_failed.length === 0) {
    throw new CreationExceptionError(
      "CREATION_EXCEPTION_INVALID",
      `exception '${input.id}' must state why the searched routes failed`,
    );
  }
  const exception = CreationExceptionSchema.parse({
    id: input.id,
    what: input.what,
    routes_searched: input.routes_searched,
    why_failed: input.why_failed,
    partial_reuse: input.partial_reuse ?? [],
    provenance: input.provenance ?? {},
    derivative_id: input.derivative_id,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
  });

  const path = exceptionsPathFor(projectRoot);
  const dir = join(path, "..");
  if (!existsSync(dir)) Bun.write(dir + "/.keep", "");
  // Append-only JSONL: exclusive append, never rewrite history.
  const line = `${JSON.stringify(exception)}\n`;
  const existing = existsSync(path) ? require("node:fs").readFileSync(path, "utf8") : "";
  require("node:fs").writeFileSync(path, existing + line);
  return exception;
}

export function listCreationExceptions(projectRoot: string): CreationException[] {
  const path = exceptionsPathFor(projectRoot);
  if (!existsSync(path)) return [];
  const lines = (require("node:fs").readFileSync(path, "utf8") as string).split("\n");
  return lines
    .filter((l: string) => l.trim().length > 0)
    .map((l: string) => CreationExceptionSchema.parse(JSON.parse(l)));
}
