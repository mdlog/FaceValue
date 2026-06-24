#!/usr/bin/env node
/**
 * FaceValue ZK build pipeline.
 *
 * 1. Compile circuits/resale.circom with the local circom binary (.localbin/circom)
 *    -> r1cs + wasm + sym into build/zk/.
 * 2. Locate (or download) a Powers-of-Tau file large enough for the circuit.
 * 3. Run a groth16 setup (with a deterministic contribution) -> resale_final.zkey.
 * 4. Export verification_key.json.
 * 5. Copy resale.wasm + resale_final.zkey + verification_key.json into public/circuits/.
 *
 * Run with:  node scripts/zk/build.mjs
 * (or `npm run zk:build`).
 *
 * Pure Node, no shelling out to npx — snarkjs is imported programmatically.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/zk -> project root is two levels up.
const ROOT = path.resolve(__dirname, "..", "..");

const CIRCOM = path.join(ROOT, ".localbin", "circom");
const CIRCUIT = path.join(ROOT, "circuits", "resale.circom");
const BUILD_DIR = path.join(ROOT, "build", "zk");
const PTAU_DIR = path.join(ROOT, "build", "ptau");
const PUBLIC_DIR = path.join(ROOT, "public", "circuits");

const R1CS = path.join(BUILD_DIR, "resale.r1cs");
const WASM = path.join(BUILD_DIR, "resale_js", "resale.wasm");
const ZKEY_0 = path.join(BUILD_DIR, "resale_0000.zkey");
const ZKEY_FINAL = path.join(BUILD_DIR, "resale_final.zkey");
const VKEY = path.join(BUILD_DIR, "verification_key.json");

// Candidate ptau files, smallest-first. The resale circuit is ~3k constraints,
// so power 14 (16384) is comfortably large; we fall back upward if needed.
// Hermez ceremony files are widely mirrored and snarkjs-compatible.
const PTAU_CANDIDATES = [
  {
    power: 14,
    name: "powersOfTau28_hez_final_14.ptau",
    url: "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau",
  },
  {
    power: 15,
    name: "powersOfTau28_hez_final_15.ptau",
    url: "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau",
  },
];

function log(...args) {
  console.log("[zk:build]", ...args);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${res.status}`);
  }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function exists(p) {
  return fs.existsSync(p);
}

// Look for an already-present ptau anywhere we know about before downloading.
function findExistingPtau() {
  const searchDirs = [
    PTAU_DIR,
    path.join(ROOT, "node_modules", "snarkjs", "build"),
    // contract-agent clones the reference verifier here, which ships a ptau.
    "/tmp/soroban-examples/groth16_verifier/data/auxiliary",
  ];
  for (const dir of searchDirs) {
    if (!exists(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith(".ptau")) {
        return path.join(dir, e);
      }
    }
  }
  return null;
}

async function downloadPtau() {
  await ensureDir(PTAU_DIR);
  for (const cand of PTAU_CANDIDATES) {
    const dest = path.join(PTAU_DIR, cand.name);
    if (exists(dest)) {
      log(`Using cached ptau ${dest}`);
      return dest;
    }
    log(`Downloading ${cand.name} (power ${cand.power}) ...`);
    try {
      const res = await fetch(cand.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(dest, buf);
      log(`Saved ${dest} (${buf.length} bytes)`);
      return dest;
    } catch (err) {
      log(`Failed to download ${cand.name}: ${err.message}; trying next.`);
    }
  }
  throw new Error(
    "Could not obtain a Powers-of-Tau file. Place one in build/ptau/ manually " +
      "(e.g. powersOfTau28_hez_final_14.ptau) and re-run."
  );
}

// snarkjs needs a ptau whose 2^power >= number of constraints. Verify the one
// we picked is big enough; if not, escalate to the next candidate / fail loud.
async function resolvePtau() {
  const existing = findExistingPtau();
  let ptau = existing ?? (await downloadPtau());

  // Read constraint count from the r1cs to sanity-check ptau size.
  const info = await snarkjs.r1cs.info(R1CS);
  const constraints = info.nConstraints;
  log(`Circuit constraints: ${constraints}`);

  // Power inferred from filename if present, else conservatively accept.
  const m = path.basename(ptau).match(/final_(\d+)\.ptau$/);
  if (m) {
    const power = Number(m[1]);
    if (2 ** power < constraints) {
      log(
        `ptau power ${power} (max ${2 ** power}) too small for ${constraints} constraints; downloading a larger one.`
      );
      ptau = await downloadPtau();
    }
  }
  return ptau;
}

async function main() {
  if (!exists(CIRCOM)) {
    throw new Error(`circom binary not found at ${CIRCOM}`);
  }
  await ensureDir(BUILD_DIR);
  await ensureDir(PUBLIC_DIR);

  // 1. Compile.
  log("Compiling resale.circom ...");
  run(CIRCOM, [
    CIRCUIT,
    "--r1cs",
    "--wasm",
    "--sym",
    "-o",
    BUILD_DIR,
    "-l",
    path.join(ROOT, "node_modules"),
  ]);
  if (!exists(R1CS) || !exists(WASM)) {
    throw new Error("Compilation did not produce r1cs/wasm artifacts.");
  }

  // 2. Resolve a ptau big enough.
  const ptau = await resolvePtau();
  log(`Using ptau: ${ptau}`);

  // 3. groth16 setup + a deterministic contribution -> final zkey.
  log("groth16 setup ...");
  await snarkjs.zKey.newZKey(R1CS, ptau, ZKEY_0);

  log("Contributing to phase 2 (deterministic entropy for reproducible demo) ...");
  // Deterministic entropy so repeated builds yield a stable zkey for the demo.
  // For a production trusted setup you would gather real, secret entropy.
  const entropy = createHash("sha256")
    .update("facevalue-demo-phase2-contribution")
    .digest("hex");
  await snarkjs.zKey.contribute(
    ZKEY_0,
    ZKEY_FINAL,
    "facevalue-demo",
    entropy
  );

  // Verify the final zkey against the r1cs + ptau.
  log("Verifying final zkey ...");
  const ok = await snarkjs.zKey.verifyFromR1cs(R1CS, ptau, ZKEY_FINAL);
  if (!ok) {
    throw new Error("Final zkey failed verification against r1cs/ptau.");
  }

  // 4. Export verification key.
  log("Exporting verification_key.json ...");
  const vkey = await snarkjs.zKey.exportVerificationKey(ZKEY_FINAL);
  await fsp.writeFile(VKEY, JSON.stringify(vkey, null, 2));

  // 5. Copy artifacts the app reads.
  log("Copying artifacts into public/circuits/ ...");
  await fsp.copyFile(WASM, path.join(PUBLIC_DIR, "resale.wasm"));
  await fsp.copyFile(ZKEY_FINAL, path.join(PUBLIC_DIR, "resale_final.zkey"));
  await fsp.copyFile(VKEY, path.join(PUBLIC_DIR, "verification_key.json"));

  log("Done. Artifacts:");
  log(`  ${path.join(PUBLIC_DIR, "resale.wasm")}`);
  log(`  ${path.join(PUBLIC_DIR, "resale_final.zkey")}`);
  log(`  ${path.join(PUBLIC_DIR, "verification_key.json")}`);

  // snarkjs spins up worker threads; exit cleanly so the process doesn't hang.
  process.exit(0);
}

main().catch((err) => {
  console.error("[zk:build] FAILED:", err);
  process.exit(1);
});
