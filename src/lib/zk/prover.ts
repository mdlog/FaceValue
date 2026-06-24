// FaceValue ZK — UI prover/verifier client.
//
// PROVING STRATEGY (documented choice):
//   The server route `/api/prove` is the PRIMARY, REAL Groth16 path. Running
//   snarkjs.fullProve in Node is reliable; the browser/Turbopack path for
//   snarkjs+wasm is fragile (worker/wasm bundling), so we delegate to the
//   server. The proof is still a genuine Groth16 proof over the BN254 circuit —
//   the same one the Soroban contract verifies on-chain. For the demo this is
//   disclosed as "server-side proving"; production would move this client-side.
//
//   The over-cap range constraint (resalePrice <= perEventCap) is what makes the
//   witness UNSATISFIABLE for a scalper price: fullProve then throws, the route
//   reports `overCap:true`, and that failure IS the enforcement.
//
// WITNESS SOURCING (build-safe by design):
//   The client does NOT statically import fixtures.json (it is a build artifact
//   that may be absent before `npm run zk:build`). `buildResaleInput` therefore
//   returns a minimal `{ resaleCents }` request and the SERVER expands it into a
//   full witness from its own fixtures.json (read via fs). If a caller already
//   has a full witness, it can pass that ResaleInput straight through.

import type { ProveOutcome, ProveRequest, Groth16Proof } from "./types";

/**
 * Build the request sent to `/api/prove` for the demo ticket at a chosen resale
 * price. Returns a server-resolved `{ resaleCents }` payload: the server looks
 * up the demo ticket's secret / Merkle path / event cap+root from fixtures.json
 * and assembles the real witness. Keeps the client free of the fixtures file so
 * the app always builds even before artifacts exist.
 */
export function buildResaleInput(resaleCents: number): ProveRequest {
  return { resaleCents: Math.round(resaleCents) };
}

/**
 * Produce a REAL Groth16 proof for a resale by POSTing the request to
 * `/api/prove`. On an over-cap (unsatisfiable witness) the server reports
 * `overCap:true`. On any transport/artifact failure returns
 * `ok:false, unavailable:true` so the caller can simulate.
 */
export async function proveResale(input: ProveRequest): Promise<ProveOutcome> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch("/api/prove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      reason: `prover unreachable: ${(e as Error).message}`,
      unavailable: true,
    };
  }

  let body: {
    ok?: boolean;
    overCap?: boolean;
    unavailable?: boolean;
    reason?: string;
    proof?: Groth16Proof;
    publicSignals?: string[];
  };
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "prover returned a non-JSON response", unavailable: true };
  }

  if (body.ok && body.proof && body.publicSignals) {
    return {
      ok: true,
      proof: body.proof,
      publicSignals: body.publicSignals,
      durationMs: Date.now() - started,
      mode: "server",
    };
  }

  // Distinguish a genuine over-cap rejection from infrastructure unavailability.
  if (body.overCap) {
    return {
      ok: false,
      overCap: true,
      reason:
        body.reason ??
        "the proof cannot be produced — resalePrice > cap is unsatisfiable",
    };
  }

  return {
    ok: false,
    reason: body.reason ?? "proving failed",
    unavailable: body.unavailable ?? true,
  };
}

/**
 * Verify a proof against the circuit's verification key — mirrors exactly what
 * the on-chain Soroban contract checks. Returns false on any failure.
 */
export async function verifyResale(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  try {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof, publicSignals }),
    });
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
