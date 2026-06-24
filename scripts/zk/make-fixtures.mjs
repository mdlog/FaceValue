#!/usr/bin/env node
/**
 * Generate src/lib/zk/fixtures.json for the FaceValue demo.
 *
 * Builds a DEPTH=10 Poseidon Merkle tree of issued-ticket leaves for each event,
 * picks one member ticket as the "demo ticket", and emits its membership witness
 * (pathElements + pathIndices) plus its canonical nullifier. Hashing matches the
 * circuit EXACTLY:
 *   leaf      = Poseidon([secret, 0])
 *   nullifier = Poseidon([secret, 1])
 *   parent    = Poseidon([left, right])  (left/right by position bit)
 *
 * Run with:  node scripts/zk/make-fixtures.mjs   (or `npm run zk:fixtures`).
 *
 * Output shape (FIXED — consumed by src/lib/zk/prover.ts):
 * {
 *   "depth": 10,
 *   "events": {
 *     "evt-aurora": { "perEventCap": "12000", "merkleRoot": "<dec>" },
 *     "evt-derby":  { "perEventCap": "<dec>",  "merkleRoot": "<dec>" },
 *     "evt-hamlet": { "perEventCap": "<dec>",  "merkleRoot": "<dec>" }
 *   },
 *   "demoTicket": {
 *     "eventId": "evt-aurora",
 *     "ticketSecret": "<dec>",
 *     "leaf": "<dec>",
 *     "nullifierHash": "<dec>",
 *     "pathElements": ["<dec>", ... x10],
 *     "pathIndices": [0, 1, ... x10]
 *   }
 * }
 */
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "src", "lib", "zk", "fixtures.json");

const DEPTH = 10;

// BN254 scalar field prime — keep secrets well within range.
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Deterministic "issued ticket secret": stable across runs so the committed
// fixtures and the on-chain demo agree. NOT secure entropy — demo only.
function secretFor(eventId, idx) {
  const h = createHash("sha256")
    .update(`facevalue/${eventId}/ticket/${idx}`)
    .digest("hex");
  return BigInt("0x" + h) % FIELD;
}

// Events with their per-event resale cap, in USDC cents.
//   evt-aurora: $120.00, evt-derby: $90.00, evt-hamlet: $250.00
const EVENTS = [
  { id: "evt-aurora", cap: "12000", issued: 6, demoIndex: 2 },
  { id: "evt-derby", cap: "9000", issued: 5, demoIndex: 0 },
  { id: "evt-hamlet", cap: "25000", issued: 7, demoIndex: 4 },
];

// The event we surface as the live demo ticket.
const DEMO_EVENT_ID = "evt-aurora";

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // Poseidon over bigints -> bigint.
  const H2 = (a, b) => F.toObject(poseidon([a, b]));

  const leafOf = (secret) => H2(secret, 0n);
  const nullifierOf = (secret) => H2(secret, 1n);

  // Zero value used to pad the tree up to a full DEPTH=10. Using a fixed,
  // hashed "empty leaf" sentinel keeps padded subtrees deterministic.
  const ZERO_LEAF = F.toObject(poseidon([0n, 0n]));

  // Precompute the "all-empty" subtree roots per level so padding is cheap and
  // consistent for any index in a sparse-ish fixed-depth tree.
  const zeros = new Array(DEPTH + 1);
  zeros[0] = ZERO_LEAF;
  for (let i = 1; i <= DEPTH; i++) {
    zeros[i] = H2(zeros[i - 1], zeros[i - 1]);
  }

  // Build a fixed-depth Merkle tree from an array of leaves (left-packed),
  // padding the remainder of each level with the canonical empty subtree roots.
  // Returns { root, witnessFor(idx) -> { pathElements, pathIndices } }.
  function buildTree(leaves) {
    // levels[0] = leaves layer (length up to 2^DEPTH conceptually, but we only
    // materialize the populated prefix plus on-demand zeros).
    let level = leaves.slice();
    const layers = [level];
    for (let d = 0; d < DEPTH; d++) {
      const next = [];
      const cur = layers[d];
      const width = Math.ceil(cur.length / 2) * 2; // round up to even
      for (let i = 0; i < width; i += 2) {
        const left = i < cur.length ? cur[i] : zeros[d];
        const right = i + 1 < cur.length ? cur[i + 1] : zeros[d];
        next.push(H2(left, right));
      }
      // If a layer is empty, its parent is a single empty-subtree node.
      if (next.length === 0) next.push(zeros[d + 1]);
      layers.push(next);
    }
    const root = layers[DEPTH][0];

    function witnessFor(idx) {
      const pathElements = [];
      const pathIndices = [];
      let pos = idx;
      for (let d = 0; d < DEPTH; d++) {
        const cur = layers[d];
        const isRight = pos & 1; // 1 if current node is the right child
        const siblingPos = isRight ? pos - 1 : pos + 1;
        const sibling =
          siblingPos < cur.length ? cur[siblingPos] : zeros[d];
        pathElements.push(sibling.toString());
        pathIndices.push(isRight);
        pos = Math.floor(pos / 2);
      }
      return { pathElements, pathIndices };
    }

    return { root, witnessFor };
  }

  const events = {};
  let demoTicket = null;

  for (const ev of EVENTS) {
    const secrets = [];
    const leaves = [];
    for (let i = 0; i < ev.issued; i++) {
      const s = secretFor(ev.id, i);
      secrets.push(s);
      leaves.push(leafOf(s));
    }
    const tree = buildTree(leaves);
    events[ev.id] = {
      perEventCap: ev.cap,
      merkleRoot: tree.root.toString(),
    };

    if (ev.id === DEMO_EVENT_ID) {
      const idx = ev.demoIndex;
      const secret = secrets[idx];
      const leaf = leaves[idx];
      const witness = tree.witnessFor(idx);
      const nullifierHash = nullifierOf(secret);
      demoTicket = {
        eventId: ev.id,
        ticketSecret: secret.toString(),
        leaf: leaf.toString(),
        nullifierHash: nullifierHash.toString(),
        pathElements: witness.pathElements,
        pathIndices: witness.pathIndices,
      };

      // Self-check: recompute the root from the witness exactly like the circuit
      // folds it, and assert it equals the published root. Catches any ordering
      // mismatch between this script and resale.circom before we ship fixtures.
      let cur = leaf;
      for (let d = 0; d < DEPTH; d++) {
        const sib = BigInt(witness.pathElements[d]);
        const bit = witness.pathIndices[d];
        const left = bit ? sib : cur; // bit=1 -> cur is RIGHT child
        const right = bit ? cur : sib;
        cur = H2(left, right);
      }
      if (cur.toString() !== tree.root.toString()) {
        throw new Error(
          `Witness self-check FAILED for ${ev.id}: recomputed root ${cur} != ${tree.root}`
        );
      }
    }
  }

  if (!demoTicket) {
    throw new Error(`Demo event ${DEMO_EVENT_ID} not found in EVENTS.`);
  }

  const fixtures = { depth: DEPTH, events, demoTicket };
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  await fsp.writeFile(OUT, JSON.stringify(fixtures, null, 2) + "\n");

  console.log("[zk:fixtures] wrote", OUT);
  console.log("[zk:fixtures] events:", Object.keys(events).join(", "));
  console.log(
    "[zk:fixtures] demo ticket:",
    demoTicket.eventId,
    "nullifier",
    demoTicket.nullifierHash.slice(0, 12) + "..."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[zk:fixtures] FAILED:", err);
  process.exit(1);
});
