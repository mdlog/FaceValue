// Deploy FaceValue to Soroban testnet: build → deploy → init(admin, vk_bytes) →
// register_event ×3 (cap + merkle_root from src/lib/zk/fixtures.json so the
// on-chain EventConfig matches the proof's public signals). Requires the
// `stellar` CLI on PATH and a configured identity (STELLAR_IDENTITY, default "default").
//
// Usage:  node scripts/soroban/deploy.mjs
// Then paste the printed NEXT_PUBLIC_FACEVALUE_CONTRACT_ID into .env.local.
//
// NOTE: Confirm the installed `stellar` CLI's flag names before running:
//   stellar contract deploy --help
//   stellar contract invoke --help
// The constructor-arg passing (`-- --admin … --vk_bytes …`) and `keys address`
// subcommand are as of stellar-cli 21.x; adjust if your version differs.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { serializeVerificationKey, fpToBe32, toHex } from "../zk/groth16-bytes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IDENT = process.env.STELLAR_IDENTITY || "default";
const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const WASM = path.join(ROOT, "target/wasm32v1-none/release/facevalue.wasm");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8", ...opts }).trim();

async function main() {
  const vk = JSON.parse(await readFile(path.join(ROOT, "public/circuits/verification_key.json"), "utf8"));
  const fixtures = JSON.parse(await readFile(path.join(ROOT, "src/lib/zk/fixtures.json"), "utf8"));
  const vkHex = toHex(serializeVerificationKey(vk));

  console.error("→ building contract…");
  sh("stellar", ["contract", "build"], { cwd: path.join(ROOT, "contracts/facevalue") });

  console.error("→ deploying…");
  const admin = sh("stellar", ["keys", "address", IDENT]);
  const contractId = sh("stellar", [
    "contract", "deploy", "--wasm", WASM, "--source", IDENT, "--network", NETWORK,
    "--", "--admin", admin, "--vk_bytes", vkHex,
  ]);
  console.error(`→ deployed: ${contractId}`);

  for (const [eventId, evt] of Object.entries(fixtures.events)) {
    const rootHex = toHex(fpToBe32(evt.merkleRoot));
    console.error(`→ register_event ${eventId} cap=${evt.perEventCap}…`);
    sh("stellar", [
      "contract", "invoke", "--id", contractId, "--source", IDENT, "--network", NETWORK,
      "--", "register_event", "--event_id", eventId, "--cap", evt.perEventCap, "--merkle_root", rootHex,
    ]);
  }

  console.error("\n✅ done. Add to .env.local:");
  console.log(`NEXT_PUBLIC_FACEVALUE_CONTRACT_ID=${contractId}`);
}
main().catch((e) => { console.error(`[fail] ${e.stack || e}`); process.exit(1); });
