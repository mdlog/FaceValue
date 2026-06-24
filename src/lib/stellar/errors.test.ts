import { describe, it, expect } from "vitest";
import { mapContractError } from "./errors";

describe("mapContractError", () => {
  it("maps the nullifier-replay code to an 'already resold' message", () => {
    expect(mapContractError(8)).toMatch(/sudah dijual ulang|already resold/i);
  });
  it("maps proof-invalid", () => {
    expect(mapContractError(9)).toMatch(/proof/i);
  });
  it("falls back for unknown codes", () => {
    expect(mapContractError(999)).toMatch(/999/);
  });
});
