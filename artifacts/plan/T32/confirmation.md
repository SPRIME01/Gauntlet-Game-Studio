# T32 Independent Adversarial Confirmation

Verifier: independent adversarial agent (fresh context; received prereg, requirements, implementation,
fresh evidence; did not receive builder conclusions as authority). Date: 2026-10-04.

## Verdict

CONFIRM. All four frozen falsifiers reproduced independently (own 44-test attack suite + live CLI attacks
including a fake `godot` binary on PATH and byte-identical regeneration after deliberate file mutation);
full workspace green at the exact T32 commit (475/475 via clean git-archive extraction, isolating the
commit from concurrent work); production mutation lockout holds on every consumer-facing surface; authority
separation holds; projections deterministic; reference runtime untouched.

## Hardening findings (recorded; fixes applied in the same cycle)

1. Newline injection into generated project.godot / world_builder.gd via free-text fields — FIXED:
   manifest.id/game_id now schema-constrained to ^[a-z0-9_.-]+$; generated-file text sanitized
   (newlines/quotes/control chars stripped); dead ternary removed from generated GDScript.
2. Vacuous Android SDK probe — FIXED: removed the meaningless check; availability detail now states
   explicitly that SDK/signing presence is verified by the export itself, not claimed here.
3. Untyped CLI --target — FIXED: validated against the target enum before preflight (UNKNOWN_TARGET).
4. Inspector coverage gaps (Symbol keys, depth-capped nested control) — RECORDED as defense-in-depth
   limitation: the adapter's read allowlist held in every attack, so no consumer surface was exposed.
5. collider.params opaque record — FIXED: typed to string|number|boolean so terrain data cannot be
   smuggled into world composition.
6. Key-order leakage — RECORDED: determinism is per-document (the claimed and gated property), not
   content-canonicalized.
7. Evidence-hygiene note (confirmation.md referenced before existing) — resolved by this file.
