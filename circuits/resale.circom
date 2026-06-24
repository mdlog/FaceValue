pragma circom 2.2.0;

// FaceValue resale circuit.
//
// Proves, in zero knowledge, that:
//   1. The prover holds a ticket secret whose leaf is a member of the
//      issued-ticket Merkle tree for an event (computedRoot === merkleRoot).
//   2. The public nullifierHash is the canonical nullifier of that secret,
//      so a ticket can only be resold once (computedNullifier === nullifierHash).
//   3. The requested resalePrice is <= the event's perEventCap.
//
// The price bound is enforced as a HARD constraint (le.out === 1). An over-cap
// price makes the constraint system UNSATISFIABLE, so the witness/proof simply
// cannot be produced. That failure IS the enforcement: there is no path to a
// valid proof for a scalper price.
//
// Money is encoded as integer USDC cents (field elements): $120.00 -> 12000.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Selects the ordered pair (left, right) for one Merkle level.
// index === 0 -> current node is the LEFT child  -> (cur, sibling)
// index === 1 -> current node is the RIGHT child -> (sibling, cur)
// index is constrained to be boolean.
template DualMux() {
    signal input in[2];   // in[0] = current hash, in[1] = sibling
    signal input s;       // path index bit
    signal output out[2];

    s * (1 - s) === 0;    // s is boolean

    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// One Merkle level: hash the ordered pair with Poseidon(2).
template MerkleLevel() {
    signal input cur;
    signal input sibling;
    signal input index;   // 0 or 1
    signal output root;

    component mux = DualMux();
    mux.in[0] <== cur;
    mux.in[1] <== sibling;
    mux.s <== index;

    component h = Poseidon(2);
    h.inputs[0] <== mux.out[0];
    h.inputs[1] <== mux.out[1];

    root <== h.out;
}

template Resale(DEPTH) {
    // ---- private inputs ----
    signal input resalePrice;            // USDC cents
    signal input ticketSecret;           // the ticket's secret (membership witness)
    signal input pathElements[DEPTH];    // Merkle sibling hashes, leaf -> root
    signal input pathIndices[DEPTH];     // 0/1 position bits, leaf -> root

    // ---- public inputs ----
    signal input perEventCap;            // USDC cents (public)
    signal input merkleRoot;             // issued-ticket tree root (public)
    signal input nullifierHash;          // canonical nullifier (public)

    // ---- leaf = Poseidon(2)([ticketSecret, 0]) ----
    component leafH = Poseidon(2);
    leafH.inputs[0] <== ticketSecret;
    leafH.inputs[1] <== 0;
    signal leaf;
    leaf <== leafH.out;

    // ---- nullifier = Poseidon(2)([ticketSecret, 1]) ----
    component nullH = Poseidon(2);
    nullH.inputs[0] <== ticketSecret;
    nullH.inputs[1] <== 1;
    nullifierHash === nullH.out;

    // ---- Merkle inclusion: fold leaf up to the root ----
    component levels[DEPTH];
    signal hashes[DEPTH + 1];
    hashes[0] <== leaf;
    for (var i = 0; i < DEPTH; i++) {
        levels[i] = MerkleLevel();
        levels[i].cur <== hashes[i];
        levels[i].sibling <== pathElements[i];
        levels[i].index <== pathIndices[i];
        hashes[i + 1] <== levels[i].root;
    }
    merkleRoot === hashes[DEPTH];

    // ---- price range: resalePrice <= perEventCap (HARD constraint) ----
    var PRICE_BITS = 32;
    component le = LessEqThan(PRICE_BITS);
    le.in[0] <== resalePrice;
    le.in[1] <== perEventCap;
    le.out === 1;
}

component main {public [perEventCap, merkleRoot, nullifierHash]} = Resale(10);
