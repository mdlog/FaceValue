// FaceValue ZK — /api/prove
//
// REAL Groth16 proving in the Node runtime. Loads the circuit wasm + proving
// zkey from public/circuits and runs snarkjs.groth16.fullProve over the posted
// witness. The over-cap range constraint (resalePrice <= perEventCap) makes the
// witness unsatisfiable for a scalper price: fullProve throws and we report
// `overCap:true`. That failure IS the enforcement.
//
// snarkjs is opted out of bundling via serverExternalPackages in next.config.ts
// and imported dynamically so it never enters the client bundle.

import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";
// Proving is request-time work; never prerender/cache.
export const dynamic = "force-dynamic";

const CIRCUITS_DIR = path.join(process.cwd(), "public", "circuits");
const WASM_PATH = path.join(CIRCUITS_DIR, "resale.wasm");
const ZKEY_PATH = path.join(CIRCUITS_DIR, "resale_final.zkey");

type Body = {
  // Either a full witness...
  resalePrice?: string | number;
  ticketSecret?: string;
  pathElements?: string[];
  pathIndices?: number[];
  perEventCap?: string;
  merkleRoot?: string;
  nullifierHash?: string;
  // ...or a convenience cents value (the route looks up fixtures itself).
  resaleCents?: number;
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Build a full witness from {resaleCents} using server-side fixtures. */
async function witnessFromCents(resaleCents: number) {
  // fixtures.json lives in src/lib/zk and is a build artifact; read via fs so a
  // missing file is a graceful runtime condition rather than a bundling error.
  const fxPath = path.join(process.cwd(), "src", "lib", "zk", "fixtures.json");
  if (!(await fileExists(fxPath))) return null;
  const fx = JSON.parse(await fs.readFile(fxPath, "utf8"));
  const demo = fx.demoTicket;
  const evt = fx.events?.[demo?.eventId];
  if (!demo || !evt) return null;
  return {
    resalePrice: String(Math.round(resaleCents)),
    ticketSecret: demo.ticketSecret,
    pathElements: demo.pathElements,
    pathIndices: demo.pathIndices,
    perEventCap: evt.perEventCap,
    merkleRoot: evt.merkleRoot,
    nullifierHash: demo.nullifierHash,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid JSON body" },
      { status: 400 },
    );
  }

  // Artifacts must exist for a REAL proof. If not, tell the client to fall back.
  if (!(await fileExists(WASM_PATH)) || !(await fileExists(ZKEY_PATH))) {
    return NextResponse.json({
      ok: false,
      unavailable: true,
      reason: "circuit artifacts not built (run: npm run zk:build)",
    });
  }

  // Assemble the circuit inputs.
  let inputs: Record<string, unknown> | null = null;
  if (body.ticketSecret && body.pathElements && body.merkleRoot) {
    inputs = {
      resalePrice: String(body.resalePrice ?? "0"),
      ticketSecret: body.ticketSecret,
      pathElements: body.pathElements,
      pathIndices: body.pathIndices,
      perEventCap: body.perEventCap,
      merkleRoot: body.merkleRoot,
      nullifierHash: body.nullifierHash,
    };
  } else if (typeof body.resaleCents === "number") {
    inputs = await witnessFromCents(body.resaleCents);
  }

  if (!inputs) {
    return NextResponse.json({
      ok: false,
      unavailable: true,
      reason: "no witness inputs and fixtures unavailable",
    });
  }

  try {
    // Dynamic import keeps snarkjs out of the client bundle (and works with
    // serverExternalPackages: native require at runtime).
    const snarkjs = await import("snarkjs");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      WASM_PATH,
      ZKEY_PATH,
    );
    return NextResponse.json({ ok: true, proof, publicSignals });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // An unsatisfiable witness (price > cap, or a bad membership path) surfaces
    // as an assert/constraint failure from the wasm witness calculator.
    const lower = reason.toLowerCase();
    const overCap =
      lower.includes("assert") ||
      lower.includes("constraint") ||
      lower.includes("not satisf") ||
      lower.includes("line:") ||
      lower.includes("error in template");
    return NextResponse.json({
      ok: false,
      overCap,
      reason: overCap
        ? "the proof cannot be produced — resalePrice > cap is unsatisfiable"
        : reason,
    });
  }
}
