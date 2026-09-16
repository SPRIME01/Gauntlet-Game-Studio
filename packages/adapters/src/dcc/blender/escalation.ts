/**
 * DCC escalation rationale (T18, REQ-BLENDER-002).
 *
 * Before Blender execution the request MUST record why lower-cost or more
 * agent-editable eligible routes are insufficient when that reason is not
 * self-evident from the capability. A request without a recorded rationale
 * (or with an empty "rejected lighter routes" list) is blocked — it must
 * travel a lighter route instead.
 */

export interface RejectedRoute {
  /** The lighter/agent-editable route that was considered. */
  route: string;
  /** Why it cannot satisfy the request. */
  reason: string;
}

export interface EscalationRationale {
  requested_operation: string;
  reason: string;
  rejected_routes: RejectedRoute[];
}

export type EscalationValidation =
  | { ok: true; rationale: EscalationRationale }
  | { ok: false; code: "ESCALATION_RATIONALE_REQUIRED"; message: string; details: string[] };

export const ESCALATION_RATIONALE_REQUIRED = "ESCALATION_RATIONALE_REQUIRED";

/** The lighter routes a DCC escalation request is expected to have considered. */
export const LIGHTER_ROUTE_HINTS = [
  "procedural-three-animation",
  "asset.source",
  "asset.reconstruct.reference-image",
  "asset.optimize",
  "world.composition",
] as const;

export function validateEscalationRationale(raw: unknown): EscalationValidation {
  const details: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: ESCALATION_RATIONALE_REQUIRED,
      message:
        "The dcc.blender.process route requires a recorded escalation rationale: why lighter/agent-editable " +
        "routes are insufficient (REQ-BLENDER-002). Provide inputs.escalation_rationale " +
        "{ requested_operation, reason, rejected_routes[] }.",
      details: ["inputs.escalation_rationale missing or not an object"],
    };
  }
  const raw2 = raw as Record<string, unknown>;
  const requested = typeof raw2["requested_operation"] === "string" ? raw2["requested_operation"].trim() : "";
  const reason = typeof raw2["reason"] === "string" ? raw2["reason"].trim() : "";
  const rejected = Array.isArray(raw2["rejected_routes"]) ? raw2["rejected_routes"] : [];
  if (requested.length === 0) details.push("requested_operation must name the operation that needs DCC escalation");
  if (reason.length < 20) details.push("reason must state (non-trivially) why lighter routes are insufficient");
  if (rejected.length === 0) {
    details.push("rejected_routes must list at least one considered lighter route and why it cannot satisfy the request");
  }
  const normalized: RejectedRoute[] = [];
  for (const entry of rejected) {
    if (entry === null || typeof entry !== "object") {
      details.push("every rejected_routes entry must be { route, reason }");
      continue;
    }
    const e = entry as Record<string, unknown>;
    const route = typeof e["route"] === "string" ? e["route"].trim() : "";
    const routeReason = typeof e["reason"] === "string" ? e["reason"].trim() : "";
    if (!route || !routeReason) {
      details.push("every rejected_routes entry needs both route and reason");
      continue;
    }
    normalized.push({ route, reason: routeReason });
  }
  if (details.length > 0) {
    return {
      ok: false,
      code: ESCALATION_RATIONALE_REQUIRED,
      message: `Escalation rationale is missing or incomplete (REQ-BLENDER-002): record why lower-cost or more agent-editable eligible routes are insufficient before Blender execution.`,
      details,
    };
  }
  return { ok: true, rationale: { requested_operation: requested, reason, rejected_routes: normalized } };
}
