// FaceValue ZK — shared types for the resale prover/verifier.
//
// Money is encoded as integer USDC cents in decimal strings ("$120.00" -> "12000").
// Field elements (secrets, roots, hashes) are also decimal strings to stay exact
// across the JS BigInt / snarkjs boundary.

/**
 * Witness inputs for the `Resale` circuit. Field/index arrays are length `DEPTH`
 * (10). Public signals — in snarkjs order — are
 * `[perEventCap, merkleRoot, nullifierHash]`.
 */
export interface ResaleInput {
  /** PRIVATE — the asking price, in USDC cents, decimal string. */
  resalePrice: string;
  /** PRIVATE — the ticket's secret pre-image, decimal string. */
  ticketSecret: string;
  /** PRIVATE — Merkle authentication path siblings (DEPTH entries). */
  pathElements: string[];
  /** PRIVATE — 0/1 per level, selects the hashing order at that level. */
  pathIndices: number[];
  /** PUBLIC — regulated per-event cap, USDC cents, decimal string. */
  perEventCap: string;
  /** PUBLIC — Merkle root of the issued-ticket set, decimal string. */
  merkleRoot: string;
  /** PUBLIC — Poseidon(ticketSecret, 1), the spend nullifier, decimal string. */
  nullifierHash: string;
}

/** snarkjs Groth16 proof object (pi_a / pi_b / pi_c + protocol/curve metadata). */
export type Groth16Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
};

/**
 * Outcome of an attempt to produce a real proof.
 * - `ok:true`  -> a real Groth16 proof + its public signals.
 * - `ok:false` -> the witness was unsatisfiable (over-cap, `overCap:true`) or
 *   the proving stack was unavailable (artifacts missing / network error).
 */
export type ProveOutcome =
  | {
      ok: true;
      proof: Groth16Proof;
      publicSignals: string[];
      durationMs: number;
      mode: "browser" | "server";
    }
  | {
      ok: false;
      reason: string;
      /** true when the price exceeded the cap (range constraint failed). */
      overCap?: boolean;
      /** true when artifacts/route were unavailable — caller may simulate. */
      unavailable?: boolean;
    };

/**
 * What the client hands to `proveResale`. Either a full `ResaleInput` witness
 * (when real fixtures are present client-side) or a minimal `{resaleCents}`
 * request that the SERVER expands into a witness from its own fixtures.json
 * (the build-safe default — the client never statically imports fixtures).
 */
export type ProveRequest = ResaleInput | { resaleCents: number };

/** Shape of `src/lib/zk/fixtures.json` (produced by scripts/zk/make-fixtures.mjs). */
export interface Fixtures {
  depth: number;
  events: Record<string, { perEventCap: string; merkleRoot: string }>;
  demoTicket: {
    eventId: string;
    ticketSecret: string;
    leaf: string;
    nullifierHash: string;
    pathElements: string[];
    pathIndices: number[];
  };
}
