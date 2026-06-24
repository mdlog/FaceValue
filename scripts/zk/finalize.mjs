// Finalize the Groth16 setup with a known-good BN254 ptau, then prove end-to-end.
import * as snarkjs from "snarkjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const B = path.join(ROOT, "build/zk");
const PUB = path.join(ROOT, "public/circuits");
const PTAU = path.join(ROOT, "build/ptau/pot14_final.ptau");
fs.mkdirSync(PUB, { recursive: true });

const r1cs = path.join(B, "resale.r1cs");
const wasm = path.join(B, "resale_js/resale.wasm");
const z0 = path.join(B, "resale_0000.zkey");
const zf = path.join(B, "resale_final.zkey");
const vkPath = path.join(B, "verification_key.json");

console.log("[finalize] groth16 setup (r1cs + pot14) ...");
await snarkjs.zKey.newZKey(r1cs, PTAU, z0);
console.log("[finalize] phase-2 contribute (deterministic demo entropy) ...");
await snarkjs.zKey.contribute(z0, zf, "facevalue-demo", "facevalue-deterministic-demo-entropy");
const vkey = await snarkjs.zKey.exportVerificationKey(zf);
fs.writeFileSync(vkPath, JSON.stringify(vkey, null, 2));

// copy artifacts the app reads
fs.copyFileSync(wasm, path.join(PUB, "resale.wasm"));
fs.copyFileSync(zf, path.join(PUB, "resale_final.zkey"));
fs.writeFileSync(path.join(PUB, "verification_key.json"), JSON.stringify(vkey, null, 2));
console.log("[finalize] artifacts -> public/circuits/ :", fs.readdirSync(PUB).join(", "));
console.log("[finalize] vkey curve:", vkey.curve, "| nPublic:", vkey.nPublic);

// ---- end-to-end proof test using committed fixtures ----
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/zk/fixtures.json"), "utf8"));
const d = fx.demoTicket;
const ev = fx.events[d.eventId];
const witness = (priceCents) => ({
  resalePrice: String(priceCents),
  ticketSecret: d.ticketSecret,
  pathElements: d.pathElements,
  pathIndices: d.pathIndices,
  perEventCap: ev.perEventCap,
  merkleRoot: ev.merkleRoot,
  nullifierHash: d.nullifierHash,
});

console.log("\n[test] FAIR $115 (<= cap $120) — expect a real proof that verifies:");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness(11500), wasm, zf);
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log("  publicSignals [cap, root, nullifier]:", publicSignals.map((s) => s.slice(0, 12) + "…"));
console.log("  groth16.verify ->", ok, "| proof.curve:", proof.curve);

console.log("\n[test] SCALPER $210 (> cap $120) — expect proof generation to FAIL (unsatisfiable):");
let scalperFailed = false;
try {
  await snarkjs.groth16.fullProve(witness(21000), wasm, zf);
  console.log("  ⚠ UNEXPECTED: a proof was generated for an over-cap price!");
} catch (e) {
  scalperFailed = true;
  console.log("  ✓ proof generation threw as expected:", String(e.message || e).split("\n")[0]);
}

console.log("\n[result] fair_verifies =", ok, "| scalper_unprovable =", scalperFailed,
  "| ENFORCEMENT_REAL =", ok && scalperFailed);
process.exit(ok && scalperFailed ? 0 : 1);
