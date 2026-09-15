# Preregistration: T02 - Studio Contracts and Schemas

**Task**: T02  
**Proof Level**: P2  
**Governing Requirement**: REQ-OUT-005 ("Provider-specific output MUST be normalized into studio contracts before downstream systems rely on it.")  
**Timestamp**: 2026-09-15T18:56:00Z  
**Status**: FROZEN BEFORE EVALUATION  

---

## 1. Claim Statement
The `packages/contracts` package implements complete, strict TypeScript types and runtime validation schemas (using Zod) for all normative domain entities specified in Section `core_domain_model`:
- `CapabilityDescriptor`
- `CapabilityRequest`
- `CapabilityResult`
- `AgentHandoff`
- `AssetRecord`
- `RuntimeReadiness`
- `TerrainHeightfield`
- `AudioBackendState`
- `NetworkEnvelope`
- `ObservationRun`
- `EvidenceManifest`
- `SettlementRecord`
- `StudioResult`

These contracts are strictly provider-neutral. Any provider-specific or runtime-specific fields written directly into core fields (e.g. `mavonGameObject`, `needleComponent`, raw DCC pointers) are rejected by schema validation.

## 2. Falsification Conditions
The implementation shall be considered FALSIFIED and REJECTED if any of the following occur:
1. **Provider Authority Leak (Teeth Attack 1)**:
   A provider-specific field (such as `mavonGameObject`, `needleComponent`, `unityAssetId`, or vendor command) can be passed directly as a root field in `CapabilityRequest` or `CapabilityResult` without triggering schema validation failure.
2. **Missing Evidence Correlation (Teeth Attack 2)**:
   An `EvidenceManifest` can be parsed/instantiated without a valid `run_id`, `project_revision`, `requirement_ids`, or empty/missing artifact records.
3. **Terrain Heightfield Ambiguity**:
   A `TerrainHeightfield` can be instantiated without canonical ordered elevation samples, row/column dimensions, world-space extents, or explicit axis orientation.
4. **Unready Runtime Bypass**:
   `RuntimeReadiness` resolves state as `ready` while one or more required asynchronous subsystems are in `booting` or `failed` states.

## 3. Verification Method
- Automated test suite in `packages/contracts/src/schemas.test.ts` testing:
  - Valid entities against all schemas
  - Rejection of malformed / missing required fields
  - Rejection of provider-leaking fields (strict schemas)
  - Edge cases: negative heights, invalid enums, non-monotonic network sequence numbers
- Direct teeth attacks matching the declared plan teeth.
