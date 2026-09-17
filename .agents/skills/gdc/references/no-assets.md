# Starting without source assets

Read this guide when the user has an idea or specification but no usable art, models, audio, or reference package.

1. List only assets required for the smallest complete playable loop. Defer decorative variety so asset work does not outrun gameplay proof.
2. Check accepted project assets first. Then compare licensed sourcing, simple procedural construction, reference-backed reconstruction, and DCC escalation against the actual representation needed.
3. Prefer simple project-owned procedural geometry for blockout and production only when it can meet the declared visual and gameplay acceptance criteria. Label temporary placeholders and keep them out of production acceptance.
4. Route environmental layout, architecture, vegetation, lighting, and atmosphere through `world.environment.compose`. Supply accepted kit asset IDs and a canonical terrain reference; do not ask 3dviz to invent terrain elevation or navmesh data.
5. Route open-web materials, HDRIs, textures, or models through `asset.source`. Record the source URI, author, retrieval metadata, license or authorization, and source hash. Reject unknown or incompatible provenance.
6. Use `asset.reconstruct.reference-image` only after a specific subject and suitable authorized reference exist. If no such image exists, request or source one explicitly rather than treating prose as an image.
7. Use `dcc.blender.process` only after recording the operation and why procedural, sourced, reconstruction, and optimization routes cannot perform it.
8. Give every shipped asset an `AssetRecord`, collider/LOD policy where its role requires one, budgets, measured values, and an acceptance state before runtime reliance.

State which route will supply each asset and why. Include licensing, provider cost, network access, credentials, and tool availability in pre-flight.
