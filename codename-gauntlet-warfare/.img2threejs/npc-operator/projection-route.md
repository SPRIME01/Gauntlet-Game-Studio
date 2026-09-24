# Projection-route decision

- Decision: **projection NOT required** for this subject.
- Reason: no patterned, painted, or decal surface exists anywhere on the depicted figure. Every
  identity surface is a solid albedo (matte-white plastic head/hands, matte-black textile,
  satin-black polymer). Per the rule of thumb ("solid albedo for flat paint, real reference crop
  for patterned finishes"), solid PBR albedo from measured values is the correct finish route.
- Projecting the photo's pixels would bake photographic shading into albedo (de-lighting an
  all-black-on-white subject has poor SNR) while the actual likeness risk is geometric
  (proportions, pouch placement, pad/boot shapes) — carried by the spec + review gates instead.
- Identity-defining features are geometric (vest layout, pouch rows, holster rig, knee pads,
  boots) and are gated by `featureReviewTargets` + turntable/silhouette gates, not by texture.
