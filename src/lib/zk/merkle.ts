// FaceValue ZK — Poseidon Merkle helpers.
//
// These mirror EXACTLY what the `Resale` circuit computes so that values derived
// here verify against artifacts built from the same circuit:
//   leaf       = Poseidon(ticketSecret, 0)
//   nullifier  = Poseidon(ticketSecret, 1)
//   parent     = Poseidon(ordered(child, sibling))   // order set by pathIndex bit
//
// circomlibjs `buildPoseidon` is async (it instantiates a wasm field). We lazily
// build it once and reuse. All hashes are returned as decimal strings to match
// the snarkjs / fixtures convention.

// circomlibjs ships no bundled types; treat as any at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Poseidon = any;

let poseidonPromise: Promise<Poseidon> | null = null;

/** Lazily build (and cache) the Poseidon hasher from circomlibjs. */
export async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonPromise) {
    poseidonPromise = import("circomlibjs").then((m) => m.buildPoseidon());
  }
  return poseidonPromise;
}

/** Poseidon hash of decimal-string inputs -> decimal string of the field element. */
export async function poseidonHash(inputs: (string | bigint)[]): Promise<string> {
  const poseidon = await getPoseidon();
  const out = poseidon(inputs.map((x) => BigInt(x)));
  // poseidon.F.toString returns the canonical decimal representation.
  return poseidon.F.toString(out);
}

/** leaf = Poseidon(ticketSecret, 0). */
export async function computeLeaf(ticketSecret: string | bigint): Promise<string> {
  return poseidonHash([ticketSecret, BigInt(0)]);
}

/** nullifier = Poseidon(ticketSecret, 1). */
export async function computeNullifier(ticketSecret: string | bigint): Promise<string> {
  return poseidonHash([ticketSecret, BigInt(1)]);
}

/**
 * Fold a leaf up to the root using a Merkle authentication path.
 * `pathIndices[i]` selects ordering at level i: 0 => (acc, sibling),
 * 1 => (sibling, acc) — identical to the circuit's selector logic.
 */
export async function computeRoot(
  leaf: string | bigint,
  pathElements: (string | bigint)[],
  pathIndices: number[],
): Promise<string> {
  let acc = BigInt(leaf);
  for (let i = 0; i < pathElements.length; i++) {
    const sibling = BigInt(pathElements[i]);
    const ordered =
      pathIndices[i] === 0 ? [acc, sibling] : [sibling, acc];
    acc = BigInt(await poseidonHash(ordered));
  }
  return acc.toString();
}

/**
 * Build a full Poseidon Merkle tree from an ordered list of leaves and return
 * the root plus, for `targetIndex`, the authentication path (siblings +
 * direction bits). Used by the fixture script and available to the UI for
 * recomputing a membership path from issued secrets.
 *
 * The tree is padded to `depth` levels with zero leaves so it matches the
 * fixed-DEPTH circuit.
 */
export async function buildTree(
  leaves: (string | bigint)[],
  depth: number,
  targetIndex: number,
): Promise<{ root: string; pathElements: string[]; pathIndices: number[] }> {
  let level = leaves.map((l) => BigInt(l));
  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let idx = targetIndex;

  for (let d = 0; d < depth; d++) {
    // pad to even width with a zero leaf
    if (level.length % 2 === 1) level.push(BigInt(0));

    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push((level[siblingIdx] ?? BigInt(0)).toString());
    // direction bit: 0 if acc is the LEFT child, 1 if acc is the RIGHT child
    pathIndices.push(isRight ? 1 : 0);

    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(BigInt(await poseidonHash([level[i], level[i + 1]])));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return { root: level[0].toString(), pathElements, pathIndices };
}
