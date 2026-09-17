# How-To Guide: Add a New Studio Capability

This guide provides a step-by-step procedure for declaring and implementing a new studio capability in Gauntlet Game Studio. It covers writing the `CapabilityDescriptor`, adding positive and negative affordance triggers, registering it in the studio catalog, implementing an adapter, and adding automated verification.

---

## 1. Goal & Requirements

You want to expose a new specialized capability (e.g., `world.water` for procedural ocean water and buoyancy) so that coding agents can route requests to it without coupling the request to a specific third-party library.

---

## 2. Step 1: Define the `CapabilityDescriptor`

Open [`packages/studio/src/capabilities/catalog.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/catalog.ts).
Add your new capability descriptor to `CAPABILITY_CATALOG`:

```typescript
{
  id: "world.water",
  summary: "Procedural ocean and river surface generation with real-time buoyancy wave sampling. Produces water render meshes and buoyancy height queries.",
  use_when: [
    "ocean simulation",
    "water surface",
    "river mesh",
    "buoyancy physics"
  ],
  do_not_use_when: [
    "terrain heightfield elevation", // Negative boundary: terrain owns dry land
    "underwater post-processing shaders",
    "particle fluid dynamics"
  ],
  inputs: [
    "water_plane_dimensions",
    "wave_amplitude",
    "wave_frequency"
  ],
  outputs: [
    "water_render_mesh",
    "buoyancy_sampler_handle"
  ],
  verification: [
    "deterministic_wave_sample_check",
    "water_material_transparency_check"
  ],
  providers: [
    "water.gerstner"
  ]
}
```

### Constraints to Keep in Mind:
- `id`: Lowercase dotted namespace (e.g. `world.water`).
- `summary`: Must be between 120 and 500 characters.
- `do_not_use_when`: Must declare nearest confusing boundaries to prevent router false matches.

---

## 3. Step 2: Register in `CapabilityRegistry`

Open [`packages/studio/src/capabilities/registry.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/registry.ts). Ensure the catalog is loaded into the default registry:

```typescript
export const defaultCapabilityRegistry = new CapabilityRegistry(CAPABILITY_CATALOG);
```

Run the capabilities linter to confirm the metadata conforms to all studio rules:
```bash
bun run studio -- capabilities lint
```
*If your description is too short, too long, or lacks negative boundaries, the linter will output an actionable error.*

---

## 4. Step 3: Implement the Provider Adapter

Create an adapter in [`packages/adapters/src/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/), for example `packages/adapters/src/water/gerstner.ts`:

```typescript
import * as THREE from "three";
import type { CapabilityRequest, CapabilityResult } from "@gauntlet/contracts";

export function runGerstnerWaterPipeline(request: CapabilityRequest): CapabilityResult {
  const width = (request.inputs.width as number) || 100;
  const depth = (request.inputs.depth as number) || 100;

  // Build the Three.js water plane projection
  const geometry = new THREE.PlaneGeometry(width, depth, 32, 32);
  const material = new THREE.MeshStandardMaterial({
    color: 0x1c3b57,
    roughness: 0.1,
    metalness: 0.8,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ocean-water-surface";

  return {
    id: `result-${request.id}`,
    request_id: request.id,
    provider: "water.gerstner",
    status: "success",
    artifacts: [],
    diagnostics: { vertices: geometry.attributes.position.count }
  };
}
```

Export your adapter from [`packages/adapters/src/index.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/index.ts).

---

## 5. Step 4: Validate Capability Routing

Add an automated unit test in [`packages/studio/test/capabilities/catalog.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/capabilities/):

```typescript
import { test, expect } from "bun:test";
import { routeCapability } from "@gauntlet/studio";

test("routes water surface intent to world.water", () => {
  const resolution = routeCapability({
    id: "req-test-water",
    project_id: "test",
    capability_id: "world.water",
    intent: "Create ocean water surface around the island",
    acceptance: ["water surface rendered"]
  });

  expect(resolution.status).toBe("routed");
  expect(resolution.capability.id).toBe("world.water");
  expect(resolution.provider).toBe("water.gerstner");
});

test("rejects world.water for terrain elevation", () => {
  expect(() => {
    routeCapability({
      id: "req-test-water-bad",
      project_id: "test",
      capability_id: "world.water",
      intent: "Compute terrain heightfield elevation",
      acceptance: ["elevation computed"]
    });
  }).toThrow();
});
```

Run the tests:
```bash
bun test packages/studio/test/capabilities/
```

You have successfully declared, implemented, and verified a new studio capability.
