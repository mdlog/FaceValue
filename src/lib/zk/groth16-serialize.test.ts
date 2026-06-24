import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  serializeVerificationKey,
  serializePublicSignals,
  serializeProof,
  type SnarkVerificationKey,
} from "./groth16-serialize";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const vk = JSON.parse(
  readFileSync(`${ROOT}/public/circuits/verification_key.json`, "utf8"),
) as SnarkVerificationKey;
const fixtures = JSON.parse(
  readFileSync(`${ROOT}/src/lib/zk/fixtures.json`, "utf8"),
);
const rust = readFileSync(
  `${ROOT}/contracts/facevalue/src/bn254_real_fixture.rs`,
  "utf8",
);

/** Extract a `pub const NAME: [u8; N] = [ 0x.., .. ];` literal as bytes. */
function parseRustU8Array(src: string, name: string): Uint8Array {
  const m = src.match(new RegExp(`${name}:\\s*\\[u8;\\s*\\d+\\]\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`const ${name} not found`);
  const hex = m[1].match(/0x[0-9a-fA-F]{2}/g);
  if (!hex) throw new Error(`no bytes in ${name}`);
  return new Uint8Array(hex.map((h) => parseInt(h, 16)));
}

describe("groth16-serialize", () => {
  it("serializes the verification key byte-for-byte (708 B golden vector)", () => {
    const expected = parseRustU8Array(rust, "REAL_VK_BYTES");
    const got = serializeVerificationKey(vk);
    expect(got.length).toBe(708);
    expect([...got]).toEqual([...expected]);
  });

  it("serializes public signals byte-for-byte (100 B golden vector)", () => {
    const expected = parseRustU8Array(rust, "REAL_PUBLIC_SIGNALS_BYTES");
    const evt = fixtures.events[fixtures.demoTicket.eventId];
    const signals = [evt.perEventCap, evt.merkleRoot, fixtures.demoTicket.nullifierHash];
    const got = serializePublicSignals(signals);
    expect(got.length).toBe(100);
    expect([...got]).toEqual([...expected]);
  });

  it("serializes a proof to exactly 256 bytes", () => {
    // Structural check (a fresh proof is randomized; the VK + signals golden
    // vectors already prove g1/g2/fp encoding correctness, which serializeProof reuses).
    const dummy = {
      pi_a: ["1", "2", "1"],
      pi_b: [["1", "2"], ["3", "4"], ["1", "0"]],
      pi_c: ["5", "6", "1"],
      protocol: "groth16",
      curve: "bn128",
    } as const;
    expect(serializeProof(dummy as never).length).toBe(256);
  });
});
