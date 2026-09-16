/**
 * Gauntlet settlement bridge (T20).
 * Frozen expectation/registration comparison producing SettlementRecords
 * (settled | blocked | failed | incomplete), channel-appropriate verification,
 * cross-channel contradiction logic, and REQ-GAUNTLET-004 blockage classification.
 */

export * from "./expectation";
export * from "./checks";
export * from "./settle";
