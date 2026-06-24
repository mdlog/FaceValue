// FaceValue — snarkjs Groth16 (BN254) JSON → the EXACT byte layout the Soroban
// contract's bn254 `from_bytes` expects. Pure & browser-safe (no fs/node).
// Ported from scripts/zk/make-contract-fixture.mjs (which produced the committed
// contract golden vectors) — keep the two in sync; both are pinned by the
// golden-vector test in groth16-serialize.test.ts.
//
// Layout: Fp = be32; G1 = be32(X)||be32(Y); G2 = be32(X.c1)||be32(X.c0)||be32(Y.c1)||be32(Y.c0)
// (imaginary c1 FIRST; snarkjs stores [c0,c1] so each pair is swapped). Lengths are u32 BE.

export type SnarkG1 = [string, string, string];
export type SnarkG2 = [[string, string], [string, string], [string, string]];

export interface SnarkProof {
  pi_a: SnarkG1;
  pi_b: SnarkG2;
  pi_c: SnarkG1;
  protocol: string;
  curve: string;
}

export interface SnarkVerificationKey {
  vk_alpha_1: SnarkG1;
  vk_beta_2: SnarkG2;
  vk_gamma_2: SnarkG2;
  vk_delta_2: SnarkG2;
  IC: SnarkG1[];
  curve: string;
  nPublic: number;
}

/** decimal string → 32-byte big-endian (one BN254 Fp element). */
function fpToBe32(decimal: string): Uint8Array {
  let v = BigInt(decimal);
  if (v < 0n) throw new Error(`negative field element: ${decimal}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`field element does not fit in 32 bytes: ${decimal}`);
  return out;
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function u32Be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** G1 affine [x, y, "1"] → 64 bytes be32(x)||be32(y). */
function g1ToBytes(g: SnarkG1): Uint8Array {
  return concatBytes(fpToBe32(g[0]), fpToBe32(g[1]));
}

/** G2 affine [[x0,x1],[y0,y1],...] → 128 bytes be32(x1)||be32(x0)||be32(y1)||be32(y0). */
function g2ToBytes(g: SnarkG2): Uint8Array {
  const [[x0, x1], [y0, y1]] = g;
  return concatBytes(fpToBe32(x1), fpToBe32(x0), fpToBe32(y1), fpToBe32(y0));
}

export function serializeVerificationKey(vk: SnarkVerificationKey): Uint8Array {
  return concatBytes(
    g1ToBytes(vk.vk_alpha_1),
    g2ToBytes(vk.vk_beta_2),
    g2ToBytes(vk.vk_gamma_2),
    g2ToBytes(vk.vk_delta_2),
    u32Be(vk.IC.length),
    ...vk.IC.map(g1ToBytes),
  );
}

export function serializeProof(proof: SnarkProof): Uint8Array {
  return concatBytes(g1ToBytes(proof.pi_a), g2ToBytes(proof.pi_b), g1ToBytes(proof.pi_c));
}

export function serializePublicSignals(signals: string[]): Uint8Array {
  return concatBytes(u32Be(signals.length), ...signals.map(fpToBe32));
}
