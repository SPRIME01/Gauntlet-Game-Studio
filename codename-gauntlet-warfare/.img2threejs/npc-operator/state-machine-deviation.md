# Forge state-machine deviation note (2026-09-19)

The img2threejs state checklist (character profile) is generator-centric: its
build-current-pass step expects `forge/stage3_build/generate_threejs_factory.py` to
emit the factory from `object-sculpt-spec.json`. That generator produced the ORIGINAL
blockout factory which this pass supersedes.

Per operator instruction ("iterative refinement of the existing model rather than a
completely fresh generation"), the v2 build is a parametric rewrite of the existing
factory preserving the settled structural contract — not a spec regeneration — so the
in-order checklist cannot be completed without running a command that would overwrite
the settled v2 implementation. Per SKILL.md: "The state file is a resumability index,
not visual evidence: renders, specs, review history, and deterministic gates remain
the authoritative artifacts."

Authoritative artifacts for this pass (all under .img2threejs/npc-operator/):
- correction-history-v2.json (19 recorded iterations v6-v26 with measurements)
- turnaround-profiles.json + turnaround-landmarks.json (proportion authority)
- spec-v2-turnaround.md (spec delta + acceptance definition)
- analysis-turnaround.md (intake observation)
- render/v26-optimized/ (final renders + review.json + meshes.json)
- review-sheets/cmp-v25-*.png, cmp-v26-* (vision-judge evidence, passes 1-6)
- blender-verify-v26.json (headless Blender import verification)
- gate-self-intersection-v25/v26.json (instrument-limited gate evidence)

State file left at step=build-current-pass (pass=blockout) with this deviation note;
do not run the blockout generator against this target without operator instruction.
