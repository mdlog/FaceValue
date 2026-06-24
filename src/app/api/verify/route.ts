// FaceValue ZK — /api/verify
//
// Verifies a Groth16 proof against the circuit's verification_key.json using
// snarkjs.groth16.verify. This mirrors EXACTLY what the on-chain Soroban
// contract checks (BN254 Groth16 verify against the stored VK over public
// signals [perEventCap, merkleRoot, nullifierHash]).

import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VKEY_PATH = path.join(
  process.cwd(),
  "public",
  "circuits",
  "verification_key.json",
);

type Body = {
  proof?: unknown;
  publicSignals?: string[];
};

async function readVkey(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(VKEY_PATH, "utf8"));
  } catch {
    return null;
  }
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

  if (!body.proof || !Array.isArray(body.publicSignals)) {
    return NextResponse.json(
      { ok: false, reason: "missing proof or publicSignals" },
      { status: 400 },
    );
  }

  const vkey = await readVkey();
  if (!vkey) {
    return NextResponse.json({
      ok: false,
      unavailable: true,
      reason: "verification key not built (run: npm run zk:build)",
    });
  }

  try {
    const snarkjs = await import("snarkjs");
    const ok = await snarkjs.groth16.verify(
      vkey,
      body.publicSignals,
      body.proof,
    );
    return NextResponse.json({ ok });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, reason });
  }
}
