import { describe, it, expect } from "vitest";
import { mapContractError, extractContractError } from "./errors";

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

describe("extractContractError", () => {
  it("extracts the error code from a canonical host-error string", () => {
    expect(extractContractError("Error(Contract, #8)")).toBe(8);
  });
  it("extracts large error codes", () => {
    expect(extractContractError("Error(Contract, #999)")).toBe(999);
  });
  it("returns undefined when no host-error string is present", () => {
    expect(extractContractError("no contract error here")).toBeUndefined();
  });
  it("anchors to the host-error shape and ignores unrelated #-prefixed numbers", () => {
    expect(
      extractContractError('{"foo":"#42","detail":"Error(Contract, #6)"}')
    ).toBe(6);
  });
});
