# T30 Independent Adversarial Confirmation — two rounds

## Round 1 (initial): REJECT
The reservoir intake/acceptance/reuse path applied no accepted-license-set or unknown-license
rejection — a cc-by-nc-4.0 or unknown-licensed resource became production-reusable, falsifying
REQ-RES-003 (prereg claim "unknown licenses are unusable"). Holes H1-H9 preserved in
correction-round1/findings.md. All fixed in commit d4567db (correction round 1).

## Round 2 (fresh verification): CONFIRM
45/45 own-attack pass (124 assertions) plus 19/19 repo suite. H1 fixed on all API paths; H2-H5, H8,
H9 fixed; H4 cascade order restored and verified. Honest residual recorded: a hand-poisoned
reservoir/index.json resolves at R1 (trust-model limitation identical to the settled AssetRegistry's
read-time acceptance trust; index.json is git-reviewed); R1 require_license is case-sensitive
(fails safe); fully-verified composite ingredients cannot yet become the chosen route (fail-closed;
R4 chosen-route wiring recorded as known limitation). Verdict: REQ-RES-001..006 settled.
