# Mavon Engine Donor Provenance & Classification

## 1. Upstream Identity
- **Repository**: `https://github.com/MavonEngine/Core.git`
- **Tracked Branch**: `dev`
- **Donor HEAD Commit**: `20d4a4db7b5ec08f8f1cc5aeb8be4707fa0ef67c`
- **Local Quarantine Path**: `.tmp/donor/Core` (gitignored, non-authoritative)
- **License**: MIT (see [LICENSE](./LICENSE))
- **Attribution Class**: `temporary_donor` and `copied_code`

## 2. Mechanism Classification Matrix
In accordance with `REQ-DONOR-001`, `REQ-DONOR-002`, `REQ-DONOR-003`, and `REQ-DONOR-005`:

| Subsystem / Mechanism | Source Path | Classification | Target in Gauntlet | Justification / Governing Spec |
|---|---|---|---|---|
| `BaseWorld` / `World` | `packages/core/src/World/` | **DISCARD** | None (Koota ECS) | REQ-DONOR-003, REQ-BIND-002. Monolithic OO world violates semantic authority separation. |
| `GameObject` / `Actor` / `LivingActor` | `packages/core/src/World/` | **DISCARD** | None (Koota Traits) | REQ-DONOR-003, REQ-GOAL-003. Class hierarchy violates pure trait-based state invariants. |
| `packages/editor` | `packages/editor/` | **DISCARD** | Studio CLI / Web | REQ-DONOR-003. Editor is out-of-scope; studio authoring is headless/CLI-driven. |
| `packages/bootstrap` | `packages/bootstrap/` | **DISCARD** | None (Bun monorepo) | REQ-DONOR-003, REQ-TOPOLOGY-001. Bespoke bootstrap replaced by native Bun monorepo. |
| `Particles` | `packages/core/src/Particles/` | **NOT_NEEDED** | `three.quarks` | REQ-DONOR-003, REQ-SCENE-003. Pinned package dependency replaces custom particle shaders. |
| `UI` / ObjectLabel | `packages/core/src/ui/` | **NOT_NEEDED** | DOM / Web | REQ-DONOR-003. Web-standard DOM overlay used for UI. |
| `BandwidthTracker` | `packages/core/src/Networking/Server/Stats/BandwidthTracker.ts` | **TRANSPLANT** | `packages/runtime/src/diagnostics/bandwidth.ts` | REQ-DONOR-005, REQ-OBS-001. Clean network diagnostic tracking adapted to Gauntlet Runtime. |
| `LatencySimulator` | `packages/core/src/Networking/Server/LatencySimulator.ts` | **TRANSPLANT** | `packages/runtime/src/diagnostics/latency-sim.ts` | REQ-DONOR-005, REQ-NET-003. Network jitter/latency simulation adapted for headless simulation testing. |
| Command Sequencing Ideas | `packages/core/src/Networking/Server/Commands.ts` | **REWRITE_FROM_CONCEPT** | `packages/runtime/src/network/` | REQ-DONOR-005, REQ-NET-002. Packet sequence tracking adapted to Koota network actions. |

## 3. White-Labeling & Isolation Policy
- All public types, runtime classes, log outputs, and telemetry are strictly branded as **Gauntlet Game Studio / Gauntlet Runtime**.
- No runtime module or test ever imports from `.tmp/donor/` or any `@mavon/*` package.
- Full independent build, test, and verification passes with `.tmp/donor/` absent.
