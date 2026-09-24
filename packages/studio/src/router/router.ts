import {
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityResult,
  AgentHandoff,
  ArtifactRef,
  validateCapabilityRequest,
  validateCapabilityResult,
  validateAgentHandoff,
} from "@gauntlet/contracts";
import { CapabilityRegistry, defaultCapabilityRegistry } from "../capabilities/registry";
import { StudioConfig } from "../config";

export class RoutingError extends Error {
  code = "ROUTING_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "RoutingError";
  }
}

export class PrematureSettlementError extends Error {
  code = "PREMATURE_SETTLEMENT_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "PrematureSettlementError";
  }
}

export interface RouteResolution {
  status: "routed" | "blocked";
  capability: CapabilityDescriptor;
  provider: string;
  is_agent_handoff: boolean;
  handoff?: AgentHandoff;
  reason?: string;
}

/** Provider details are resolved only after capability routing. */
const AGENT_SKILL_ENTRYPOINTS: Readonly<Record<string, string>> = {
  "agent-skill.img2threejs": "vendor/skills/img2threejs/SKILL.md",
  "agent-skill.3dviz": "vendor/skills/3dviz-pro-max/SKILL.md",
};

function instructionsRefForProvider(provider: string): string {
  const instructionsRef = AGENT_SKILL_ENTRYPOINTS[provider];
  if (!instructionsRef) {
    throw new RoutingError(`Agent-skill provider '${provider}' has no registered executable instructions entrypoint.`);
  }
  return instructionsRef;
}

/**
 * Capability-first router. Identifies stable capability before loading provider details.
 */
export function routeCapability(
  request: CapabilityRequest,
  registry: CapabilityRegistry = defaultCapabilityRegistry,
  config?: StudioConfig
): RouteResolution {
  validateCapabilityRequest(request);

  // 1. Resolve candidate capability
  let candidate: CapabilityDescriptor | undefined;

  if (registry.has(request.capability_id)) {
    candidate = registry.get(request.capability_id);
  } else {
    // Attempt intent-based matching
    const intentLower = request.intent.toLowerCase();

    // Specific disambiguation: depicted object/character reconstruction vs world/scene composition (REQ-ROUTE-004)
    const isObjectReconstruct =
      intentLower.includes("reconstruct") ||
      intentLower.includes("transceiver") ||
      intentLower.includes("rover") ||
      intentLower.includes("character") ||
      intentLower.includes("prop") ||
      intentLower.includes("depicted object") ||
      (request.reference_ids && request.reference_ids.length > 0);

    const isSceneComposition =
      intentLower.includes("scene composition") ||
      intentLower.includes("world layout") ||
      intentLower.includes("environment") ||
      intentLower.includes("atmosphere") ||
      intentLower.includes("lighting setup") ||
      intentLower.includes("architecture");

    if (isObjectReconstruct && !isSceneComposition) {
      candidate = registry.get("asset.reconstruct");
    } else if (isSceneComposition && !isObjectReconstruct) {
      candidate = registry.get("world.composition");
    } else {
      // General search across positive triggers and negative affordances
      for (const cap of registry.list()) {
        const positiveMatch = cap.use_when.some((t) => intentLower.includes(t.toLowerCase()));
        const negativeMatch = cap.do_not_use_when.some((t) => intentLower.includes(t.toLowerCase()));

        if (positiveMatch && !negativeMatch) {
          candidate = cap;
          break;
        }
      }
    }
  }

  if (!candidate) {
    throw new RoutingError(
      `No eligible capability could be resolved for capability_id '${request.capability_id}' with intent: "${request.intent}"`
    );
  }

  // 2. Check negative affordances against intent to prevent false matches (REQ-ROUTE-002)
  const intentLower = request.intent.toLowerCase();
  for (const neg of candidate.do_not_use_when) {
    if (intentLower.includes(neg.toLowerCase())) {
      throw new RoutingError(
        `Capability '${candidate.id}' rejected by negative affordance: "${neg}". Intent violates capability boundary.`
      );
    }
  }

  // 3. Provider selection and fallback policy (REQ-ROUTE-003, REQ-ROUTE-005)
  let selectedProvider = candidate.providers[0];
  if (request.preferred_provider && candidate.providers.includes(request.preferred_provider)) {
    selectedProvider = request.preferred_provider;
  } else if (config?.providers && config.providers[candidate.id]) {
    const configured = config.providers[candidate.id];
    if (candidate.providers.includes(configured)) {
      selectedProvider = configured;
    }
  }

  // 4. Determine if route requires AgentHandoff (REQ-SKILL-004)
  const isAgentSkill = selectedProvider.startsWith("agent-skill.");
  let handoff: AgentHandoff | undefined;

  if (isAgentSkill) {
    handoff = {
      request_id: request.id,
      skill_id: selectedProvider.replace("agent-skill.", ""),
      instructions_ref: instructionsRefForProvider(selectedProvider),
      expected_outputs: candidate.outputs,
      acceptance: request.acceptance,
      reference_ids: request.reference_ids,
    };
    validateAgentHandoff(handoff);
  }

  return {
    status: "routed",
    capability: candidate,
    provider: selectedProvider,
    is_agent_handoff: isAgentSkill,
    handoff,
  };
}

/**
 * Settle an AgentHandoff after real agent produces accepted output (REQ-SKILL-004).
 * Creating a handoff does NOT equal completion; accepted artifacts are required.
 */
export function settleAgentHandoff(
  handoff: AgentHandoff,
  provider: string,
  artifacts: ArtifactRef[],
  diagnostics: Record<string, unknown> = {}
): CapabilityResult {
  validateAgentHandoff(handoff);

  if (!artifacts || artifacts.length === 0) {
    throw new PrematureSettlementError(
      `Cannot settle AgentHandoff for request '${handoff.request_id}' without accepted artifacts. Real outputs required.`
    );
  }

  const result: CapabilityResult = {
    id: `res-${handoff.request_id}`,
    request_id: handoff.request_id,
    provider,
    status: "success",
    artifacts,
    diagnostics: {
      ...diagnostics,
      settled_skill: handoff.skill_id,
      acceptance_evaluated: handoff.acceptance,
    },
  };

  validateCapabilityResult(result);
  return result;
}
