/**
 * @gauntlet/contracts
 * Authoritative studio contracts, domain types, schemas, and envelopes.
 */

export const CONTRACTS_VERSION = "0.2.0";

export * from "./types";
export * from "./schemas";
export * from "./errors";

import * as S from "./schemas";

/**
 * Validation helpers returning structured result or throwing descriptive errors.
 */
export function validateCapabilityDescriptor(data: unknown) {
  return S.CapabilityDescriptorSchema.parse(data);
}

export function validateCapabilityRequest(data: unknown) {
  return S.CapabilityRequestSchema.parse(data);
}

export function validateCapabilityResult(data: unknown) {
  return S.CapabilityResultSchema.parse(data);
}

export function validateAgentHandoff(data: unknown) {
  return S.AgentHandoffSchema.parse(data);
}

export function validateAssetRecord(data: unknown) {
  return S.AssetRecordSchema.parse(data);
}

export function validateTerrainHeightfield(data: unknown) {
  return S.TerrainHeightfieldSchema.parse(data);
}

export function validateRuntimeReadiness(data: unknown) {
  return S.RuntimeReadinessSchema.parse(data);
}

export function validateNetworkEnvelope(data: unknown) {
  return S.NetworkEnvelopeSchema.parse(data);
}

export function validateObservationRun(data: unknown) {
  return S.ObservationRunSchema.parse(data);
}

export function validateEvidenceManifest(data: unknown) {
  return S.EvidenceManifestSchema.parse(data);
}

export function validateSettlementRecord(data: unknown) {
  return S.SettlementRecordSchema.parse(data);
}

export function validateStudioResult(data: unknown) {
  return S.StudioResultSchema.parse(data);
}
