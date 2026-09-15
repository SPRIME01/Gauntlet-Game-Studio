import { describe, it, expect } from "bun:test";
import { CONTRACTS_VERSION } from "./index";

describe("@gauntlet/contracts baseline", () => {
  it("exports a valid semver version", () => {
    expect(CONTRACTS_VERSION).toBe("0.2.0");
  });
});
