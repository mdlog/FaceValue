# FaceValue — Soroban Groth16 verify-and-nullify contract (BN254)

A [Soroban](https://soroban.stellar.org) smart contract that **verifies a Groth16
zero-knowledge proof and burns its nullifier**, enforcing per-event ticket-resale
price caps on Stellar.

It verifies on **BN254 (alt_bn128)** so it accepts the **exact** proofs our
circom + snarkjs pipeline produces — full end-to-end curve coherence between the
off-chain prover and the on-chain verifier.

The companion circuit (`../../circuits/resale.circom`) proves, in zero knowledge,
that a seller:

1. **holds an issued ticket** — Merkle membership of `Poseidon(ticketSecret, 0)`
   under the event's `merkleRoot`; and
2. **is pricing at or below the cap** — a `LessEqThan(32)` range constraint
   `resalePrice <= perEventCap`.

Because (2) is a hard constraint, an **over-cap price makes the circuit
unsatisfiable** — no valid witness, so no proof can be produced. That
unsatisfiability *is* the price-cap enforcement; on-chain we therefore only ever
see valid (in-cap) proofs. This contract additionally **binds** each proof to a
registered event and **nullifies** the ticket so it can be resold at most once.

Public signal order (snarkjs `publicSignals`, fixed):

```
[ perEventCap, merkleRoot, nullifierHash ]
```

---

## Curve: BN254 (alt_bn128) — matches the circom/snarkjs artifacts

The off-chain prover (`../../circuits/resale.circom` + snarkjs, circom's default
prime) is **BN254 / bn128**: `public/circuits/verification_key.json` has
`"curve": "bn128"`, `nPublic: 3`. This contract verifies on the **same** curve, so
it accepts those proofs **byte-for-byte** with no curve translation in the math.

Soroban exposes BN254 crypto host functions from **Protocol 25/26**:
`g1_add`, `g1_mul`, and `pairing_check` under `env.crypto().bn254()` (see
`soroban_sdk::crypto::bn254` in `soroban-sdk = 25.3.x`). The verifier uses
`Bn254G1Affine` / `Bn254G2Affine` / `Fr` and the standard Groth16 pairing check.

**Therefore the circuit artifacts are the default circom/snarkjs (BN254) ones** —
no `--prime` override is needed. Run the off-chain pipeline (`npm run zk:build` →
`public/circuits/{resale.wasm, resale_final.zkey, verification_key.json}`), prove
with `snarkjs.groth16.fullProve`, and feed the result to this contract via the
serialization documented below. A BLS12-381 vkey/proof would NOT verify here.

### Reference provenance

This contract uses the canonical Stellar Groth16 verifier shape
(`e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1` with
`vk_x = ic[0] + Σ pubᵢ · ic[i+1]`), run on the BN254 host functions of
`soroban-sdk = 25.3.x` (`src/crypto/bn254.rs`). The serializable
`VerificationKey` / `Proof` / `PublicSignals` types and the stored-VK /
nullifier-set / event-registry storage pattern follow the same example structure,
ported from BLS12-381 to BN254.

---

## Public interface

| fn | who | what |
|----|-----|------|
| `__constructor(admin, vk_bytes)` / `init(admin, vk_bytes)` | deployer | Store admin + the serialized Groth16 verifying key. Validates the VK parses and has exactly **4 IC points** (3 public signals + 1). |
| `register_event(event_id, cap, merkle_root)` | admin (auth required) | Register an event's price cap (USDC cents as `i128`) and issued-ticket Merkle root (`BytesN<32>`). Errors if already registered. Emits `EventRegistered`. |
| `verify_resale(event_id, proof_bytes, public_signals) -> bool` | anyone | Verify + nullify (see below). Emits `ResaleVerified` on success. |
| `is_nullified(nullifier) -> bool` | view | Whether a nullifier has been burned. |
| `get_event(event_id) -> Option<EventConfig>` | view | The registered `{cap, merkle_root}`. |
| `admin() -> Address` | view | The admin address. |

### `verify_resale` flow

`public_signals` is `PublicSignals::to_bytes([perEventCap, merkleRoot, nullifierHash])`.

1. Look up the registered `EventConfig` for `event_id` — panic `EventNotRegistered (#5)` if none.
2. Assert `public[0] == cfg.cap` — else `CapMismatch (#6)`. (Binds the proof to *this* event's cap.)
3. Assert `public[1] == cfg.merkle_root` — else `RootMismatch (#7)`. (Binds the proof to *this* event's issued set.)
4. Assert `public[2]` (nullifier) is unused — else `NullifierAlreadyUsed (#8)`.
5. Run the BN254 Groth16 pairing check against the stored VK — `false` → panic `ProofInvalid (#9)`.
6. On success: **burn** the nullifier, emit `ResaleVerified`, return `true`.

Every failure panics with a typed `Error` so the host transaction reverts — the
contract never silently accepts an invalid or replayed proof. Checks 2–4 run
*before* the (expensive) pairing, so cheap binding/replay failures short-circuit.

### Errors

```
1 MalformedVerifyingKey   2 AlreadyInitialized     3 NotAuthorized
4 EventAlreadyRegistered  5 EventNotRegistered     6 CapMismatch
7 RootMismatch            8 NullifierAlreadyUsed   9 ProofInvalid
```

### Storage

- instance: `Admin: Address`, `Vk: Bytes` (serialized verifying key)
- persistent: `Event(String) -> EventConfig{cap: i128, merkle_root: BytesN<32>}`
- persistent: `Nullifier(BytesN<32>) -> bool` (present ⇒ burned)

---

## Build

> **Toolchain note (important):** `soroban-sdk` 25.x **rejects the
> `wasm32-unknown-unknown` target on Rust 1.82+** (it enables `reference-types` /
> `multi-value`, unsupported by the Soroban env) and requires the
> **`wasm32v1-none`** target (Rust ≥ 1.84). Add it once:
>
> ```bash
> rustup target add wasm32v1-none
> ```

```bash
# wasm (deployable)
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/facevalue.wasm  (~27 KB)

# tests (native host target; feeds pre-serialized BN254 proof bytes)
cargo test --release
```

`stellar contract build` also works if the Stellar CLI is installed (it targets
`wasm32v1-none` by default).

### Build status (this environment)

- `cargo build --target wasm32v1-none --release` → **OK** (`facevalue.wasm`, ~27 KB, 0 warnings).
- `cargo test --release` → **OK** (14/14 tests pass, including the real-proof
  `verify_resale` happy path on a genuine BN254 proof from `resale.circom`).
- `cargo build --target wasm32-unknown-unknown --release` → **fails by design**:
  soroban-sdk 25.x build script aborts on that target for Rust ≥ 1.82. Use
  `wasm32v1-none` (the supported target). This is not a code blocker — it is the
  expected toolchain requirement.

---

## Tests

`src/test.rs` covers (14 tests), all on a **real BN254 proof from our circuit**:

- **End-to-end happy path** (the headline) —
  `verify_resale_accepts_real_bn254_proof_end_to_end`: deploy with the real
  `verification_key.json`, `register_event` with the matching cap + Merkle root,
  then `verify_resale(real proof, [perEventCap, merkleRoot, nullifierHash])`
  returns **`true`** and the nullifier is burned.
- **Real crypto path** —
  `embedded_verifier_accepts_real_bn254_proof_and_rejects_tampered`: the embedded
  BN254 `Groth16Verifier::verify_proof` returns `true` on the genuine proof and
  `false` on a tampered public signal.
- **Replay / soundness** — replaying the exact same proof reverts `#8`
  (`NullifierAlreadyUsed`); a corrupted proof reverts `#9` (`ProofInvalid`).
- **Serde round-trip** — VK / Proof / PublicSignals `to_bytes`↔`from_bytes` are
  byte-for-byte stable against the generated fixture.
- **Business layer** — register + read-back, duplicate-register rejection,
  admin-auth requirement, unregistered-event rejection, cap mismatch (`#6`), root
  mismatch (`#7`), wrong-shape VK rejection (`#1`), and default nullifier view.

### Regenerating the real-proof fixture

The proof bytes live in `src/bn254_real_fixture.rs`, generated by
`scripts/zk/make-contract-fixture.mjs`. From the project root (`facevalue/`):

```bash
node scripts/zk/make-contract-fixture.mjs > /tmp/fixture.rs
# then paste the emitted constants into contracts/facevalue/src/bn254_real_fixture.rs
```

The script runs `snarkjs.groth16.fullProve` over
`public/circuits/{resale.wasm, resale_final.zkey}` with the demo ticket from
`src/lib/zk/fixtures.json` at a fair price (resalePrice `11500` ≤ cap `12000`),
asserts `snarkjs.groth16.verify` passes, then converts the decimal coordinates
into the BN254 byte layout below.

---

## Off-chain → on-chain wiring (how the app feeds this contract)

The app proves with snarkjs (BN254) and the contract verifies the **same** proof
on BN254 — no curve translation. The submitter only re-encodes the snarkjs
**decimal** coordinates into the BN254 byte layout below. A reference
implementation is `scripts/zk/make-contract-fixture.mjs` (the `g1ToBytes` /
`g2ToBytes` / `fpToBe32` helpers).

### BN254 byte format (from `soroban_sdk::crypto::bn254`)

| element | size | layout |
|---------|------|--------|
| `Bn254Fp` (base-field coord) | 32 B | `be32(x)` — big-endian integer |
| `Fr` / public signal | 32 B | `be32(x)` |
| `Bn254G1Affine` | 64 B | `be32(X) ‖ be32(Y)` |
| `Bn254G2Affine` | 128 B | `be32(X.c1) ‖ be32(X.c0) ‖ be32(Y.c1) ‖ be32(Y.c0)` |

> **G2 ordering — the one gotcha.** Each `Fp2` coordinate is encoded
> **imaginary part first**: `be32(c1) ‖ be32(c0)`. snarkjs JSON stores each `Fp2`
> as `[c0, c1]`, so you **swap the pair** when serializing (`vk_beta_2`,
> `vk_gamma_2`, `vk_delta_2`, `pi_b`). G1 needs no swap. (Point-at-infinity is all
> zeros; flag bits must be unset — snarkjs points never set them.)

### What to send

- **`vk_bytes`** (constructor): for each point in `verification_key.json`
  (`vk_alpha_1` → G1, `vk_beta_2`/`vk_gamma_2`/`vk_delta_2` → G2, `IC[*]` → G1),
  encode as above, then concatenate in `VerificationKey::to_bytes` order:
  `alpha(64) ‖ beta(128) ‖ gamma(128) ‖ delta(128) ‖ ic_len(u32 BE) ‖ ic[*](64)`.
  For the FaceValue circuit (`nPublic = 3`) `ic_len = 4`, giving **708 bytes**.
- **`proof_bytes`**: `pi_a` (G1) ‖ `pi_b` (G2) ‖ `pi_c` (G1) → **256 bytes**.
- **`public_signals`**: `len(u32 BE) ‖ each signal as be32`. For FaceValue the
  three signals are `[perEventCap, merkleRoot, nullifierHash]` (decimal
  field-element strings → `be32`) → **100 bytes**. This order is fixed by the
  circuit's `component main {public [perEventCap, merkleRoot, nullifierHash]}`.

The `i128 cap` registered via `register_event` must equal the integer value of
the `perEventCap` public signal (USDC cents; `$120.00 -> 12000`). The 32-byte
`merkle_root` must equal the big-endian field repr of the `merkleRoot` signal.

> `settle_usdc` (SAC transfer of the resale proceeds) is intentionally **omitted**
> for now to keep the WASM lean and the build clean; it would be a SAC
> `token::Client` call gated behind a stored token address, mirroring
> `privacy-pools`' `deposit`/`withdraw` token transfers.
