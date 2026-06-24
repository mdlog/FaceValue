#![no_std]
//! FaceValue — Soroban Groth16 *verify-and-nullify* contract.
//!
//! Enforces ticket-resale price caps with a zero-knowledge proof. The circuit
//! (`circuits/resale.circom`, BN254 / circom default `--prime bn128`) proves:
//!   * the seller holds an issued ticket (Merkle membership), and
//!   * `resalePrice <= perEventCap` (a `LessEqThan` range constraint).
//!
//! An over-cap price makes the circuit **unsatisfiable**, so no proof can be
//! produced — that unsatisfiability *is* the on-chain price-cap enforcement.
//! On-chain we only ever see valid proofs; this contract additionally binds the
//! proof's public signals to a registered event and burns the nullifier so a
//! ticket can be resold at most once.
//!
//! Public signal order (snarkjs `publicSignals`) is fixed:
//!   `[perEventCap, merkleRoot, nullifierHash]`
//!
//! ## Reference / provenance
//! The Groth16 verifier (BN254 pairing check) and the serializable
//! `VerificationKey` / `Proof` / `PublicSignals` types follow the canonical
//! Stellar Groth16 verifier shape, matching `soroban-sdk = 25.3.x`:
//!   * the `e(-A,B)·e(alpha,beta)·e(vk_x,gamma)·e(C,delta) == 1` pairing check
//!     with `vk_x = ic[0] + Σ pubᵢ · ic[i+1]`.
//!
//! CURVE: this contract verifies on **BN254 (alt_bn128)** so it accepts the
//! EXACT proofs our circom/snarkjs pipeline produces (`verification_key.json`
//! has `"curve":"bn128"`). Soroban exposes BN254 crypto host functions
//! (`g1_mul`, `g1_add`, `pairing_check`) under `env.crypto().bn254()` from
//! Protocol 25/26 — see `soroban_sdk::crypto::bn254`. This achieves full
//! end-to-end curve coherence with the off-chain prover; see the README for the
//! snarkjs-JSON → BN254-bytes serialization the off-chain submitter performs.

extern crate alloc;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::{
        Bn254G1Affine, Bn254G2Affine, Fr, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE,
    },
    vec, Address, Bytes, BytesN, Env, String, Vec,
};

#[cfg(test)]
mod test;

/// Real BN254 Groth16 proof fixture (generated from our circom/snarkjs pipeline).
#[cfg(test)]
mod bn254_real_fixture;

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Verifying key bytes did not match `nPublic + 1` IC points, etc.
    MalformedVerifyingKey = 1,
    /// init/__constructor called twice.
    AlreadyInitialized = 2,
    /// A non-admin tried an admin-only call.
    NotAuthorized = 3,
    /// `register_event` for an event id that already exists.
    EventAlreadyRegistered = 4,
    /// `verify_resale` for an event id that was never registered.
    EventNotRegistered = 5,
    /// Public `perEventCap` signal != the cap registered for the event.
    CapMismatch = 6,
    /// Public `merkleRoot` signal != the root registered for the event.
    RootMismatch = 7,
    /// The nullifier has already been burned (ticket already resold).
    NullifierAlreadyUsed = 8,
    /// The Groth16 pairing check failed (invalid proof).
    ProofInvalid = 9,
}

// ----------------------------------------------------------------------------
// Groth16 types (BN254 / alt_bn128) — the same verifier shape as the canonical
// Stellar Groth16 example, but over BN254 so the on-chain pairing check accepts
// the EXACT proofs our circom/snarkjs (`"curve":"bn128"`) pipeline produces.
// Self-contained here so the contract has no path deps.
//
// BN254 serialized sizes (from `soroban_sdk::crypto::bn254`):
//   BN254_FP_SERIALIZED_SIZE = 32   (one base-field element, big-endian)
//   BN254_G1_SERIALIZED_SIZE = 64   (be32(X) || be32(Y))
//   BN254_G2_SERIALIZED_SIZE = 128  (Fp2 = be32(c1) || be32(c0); imaginary FIRST)
// `from_array(env, &[u8; N])` routes through the SDK's `from_bytes`.
// ----------------------------------------------------------------------------

/// Groth16 verifying key. Stored on-chain as bytes (see `to_bytes`/`from_bytes`).
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

impl VerificationKey {
    /// Serialize: alpha(G1) | beta(G2) | gamma(G2) | delta(G2) | ic_len(u32 BE) | ic[*](G1).
    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        bytes.append(&Bytes::from_slice(env, &self.alpha.to_array()));
        bytes.append(&Bytes::from_slice(env, &self.beta.to_array()));
        bytes.append(&Bytes::from_slice(env, &self.gamma.to_array()));
        bytes.append(&Bytes::from_slice(env, &self.delta.to_array()));
        let ic_len = self.ic.len() as u32;
        bytes.append(&Bytes::from_slice(env, &ic_len.to_be_bytes()));
        for g1 in self.ic.iter() {
            bytes.append(&Bytes::from_slice(env, &g1.to_array()));
        }
        bytes
    }

    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Error> {
        let mut pos = 0usize;
        let alpha = Bn254G1Affine::from_array(env, &take::<BN254_G1_SERIALIZED_SIZE>(bytes, &mut pos));
        let beta = Bn254G2Affine::from_array(env, &take::<BN254_G2_SERIALIZED_SIZE>(bytes, &mut pos));
        let gamma = Bn254G2Affine::from_array(env, &take::<BN254_G2_SERIALIZED_SIZE>(bytes, &mut pos));
        let delta = Bn254G2Affine::from_array(env, &take::<BN254_G2_SERIALIZED_SIZE>(bytes, &mut pos));
        let ic_len = u32::from_be_bytes(take::<4>(bytes, &mut pos)) as usize;
        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(Bn254G1Affine::from_array(
                env,
                &take::<BN254_G1_SERIALIZED_SIZE>(bytes, &mut pos),
            ));
        }
        Ok(VerificationKey {
            alpha,
            beta,
            gamma,
            delta,
            ic,
        })
    }
}

/// Groth16 proof.
#[derive(Clone)]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

impl Proof {
    /// Serialize: a(G1) | b(G2) | c(G1).
    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        bytes.append(&Bytes::from_slice(env, &self.a.to_array()));
        bytes.append(&Bytes::from_slice(env, &self.b.to_array()));
        bytes.append(&Bytes::from_slice(env, &self.c.to_array()));
        bytes
    }

    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Self {
        let mut pos = 0usize;
        let a = Bn254G1Affine::from_array(env, &take::<BN254_G1_SERIALIZED_SIZE>(bytes, &mut pos));
        let b = Bn254G2Affine::from_array(env, &take::<BN254_G2_SERIALIZED_SIZE>(bytes, &mut pos));
        let c = Bn254G1Affine::from_array(env, &take::<BN254_G1_SERIALIZED_SIZE>(bytes, &mut pos));
        Proof { a, b, c }
    }
}

/// Public signals as a length-prefixed list of 32-byte big-endian field elements.
/// For FaceValue the order is `[perEventCap, merkleRoot, nullifierHash]`.
#[derive(Clone)]
pub struct PublicSignals {
    pub pub_signals: Vec<Fr>,
}

impl PublicSignals {
    pub fn to_bytes(&self, env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        let len = self.pub_signals.len() as u32;
        bytes.append(&Bytes::from_slice(env, &len.to_be_bytes()));
        for fr in self.pub_signals.iter() {
            bytes.append(&fr.to_u256().to_be_bytes());
        }
        bytes
    }

    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Self {
        let mut pos = 0usize;
        let len = u32::from_be_bytes(take::<4>(bytes, &mut pos)) as usize;
        let mut pub_signals = Vec::new(env);
        for _ in 0..len {
            let arr = take::<32>(bytes, &mut pos);
            let u256 =
                soroban_sdk::U256::from_be_bytes(env, &Bytes::from_array(env, &arr));
            pub_signals.push_back(Fr::from_u256(u256));
        }
        PublicSignals { pub_signals }
    }
}

/// Take a fixed-size array out of `bytes` at `pos`, advancing `pos`.
fn take<const N: usize>(bytes: &Bytes, pos: &mut usize) -> [u8; N] {
    let start = *pos as u32;
    let end = (*pos + N) as u32;
    let mut arr = [0u8; N];
    bytes.slice(start..end).copy_into_slice(&mut arr);
    *pos += N;
    arr
}

/// Stateless Groth16 verifier over BN254 — identical math to the canonical
/// Stellar `groth16_verifier` example, run on the BN254 host functions: checks
/// `e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1`
/// where `vk_x = ic[0] + Σ pub_signals[i] · ic[i+1]`.
pub struct Groth16Verifier;

impl Groth16Verifier {
    pub fn verify_proof(
        env: &Env,
        vk: &VerificationKey,
        proof: &Proof,
        pub_signals: &Vec<Fr>,
    ) -> Result<bool, Error> {
        let bn = env.crypto().bn254();

        // vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(Error::MalformedVerifyingKey);
        }
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bn.g1_mul(&v, &s);
            vk_x = bn.g1_add(&vk_x, &prod);
        }

        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = -proof.a.clone();
        let vp1 = vec![env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
        let vp2 = vec![
            env,
            proof.b.clone(),
            vk.beta.clone(),
            vk.gamma.clone(),
            vk.delta.clone(),
        ];
        Ok(bn.pairing_check(vp1, vp2))
    }
}

// ----------------------------------------------------------------------------
// FaceValue business layer
// ----------------------------------------------------------------------------

/// Per-event registration: the price cap (USDC cents as i128) and the Merkle
/// root of issued-ticket leaves. `cap`/`root` are bound to the proof's public
/// signals at verify time.
#[contracttype]
#[derive(Clone)]
pub struct EventConfig {
    /// Price cap in USDC cents (e.g. $120.00 -> 12000). Mirrors the circuit's
    /// `perEventCap` public signal, which is a field element of the same value.
    pub cap: i128,
    /// Merkle root of issued-ticket leaves, 32-byte big-endian field element.
    pub merkle_root: BytesN<32>,
}

/// Storage keys.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Stored serialized verifying key bytes.
    Vk,
    /// event_id (String) -> EventConfig.
    Event(String),
    /// nullifier (BytesN<32>) -> () present means "burned".
    Nullifier(BytesN<32>),
}

/// Emitted when the admin registers an event's cap + Merkle root.
/// Topics: `("evt_reg", event_id)`.
#[contractevent(topics = ["evt_reg"])]
#[derive(Clone)]
pub struct EventRegistered {
    #[topic]
    pub event_id: String,
    pub cap: i128,
    pub merkle_root: BytesN<32>,
}

/// Emitted on a successful `verify_resale` (proof valid + nullifier burned).
/// Topics: `("resale", event_id)`.
#[contractevent(topics = ["resale"])]
#[derive(Clone)]
pub struct ResaleVerified {
    #[topic]
    pub event_id: String,
    pub cap: i128,
    pub nullifier: BytesN<32>,
}

#[contract]
pub struct FaceValue;

#[contractimpl]
impl FaceValue {
    /// Initialize: store the admin and the serialized Groth16 verifying key.
    ///
    /// `vk_bytes` is the output of `VerificationKey::to_bytes` for the
    /// `resale.circom` verifying key (built off-chain from
    /// `public/circuits/verification_key.json`).
    pub fn __constructor(env: Env, admin: Address, vk_bytes: Bytes) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_err(&env, Error::AlreadyInitialized);
        }
        // Validate the VK parses (and has the expected shape: 3 public signals
        // => 4 IC points) so a bad key fails fast at deploy, not at verify time.
        let vk = VerificationKey::from_bytes(&env, &vk_bytes)
            .unwrap_or_else(|_| panic_err(&env, Error::MalformedVerifyingKey));
        if vk.ic.len() != 4 {
            // [perEventCap, merkleRoot, nullifierHash] => nPublic = 3 => ic_len = 4
            panic_err(&env, Error::MalformedVerifyingKey);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vk, &vk_bytes);
    }

    /// Alias of `__constructor` for SDKs/flows that prefer an explicit init call.
    /// No-op-safe: errors if already initialized.
    pub fn init(env: Env, admin: Address, vk_bytes: Bytes) {
        Self::__constructor(env, admin, vk_bytes);
    }

    /// Admin-only: register (or it errors if already present) an event's price
    /// cap and issued-ticket Merkle root. The `cap`/`merkle_root` here are the
    /// values the proof's public signals will be checked against.
    pub fn register_event(
        env: Env,
        event_id: String,
        cap: i128,
        merkle_root: BytesN<32>,
    ) {
        let admin = Self::require_admin(&env);
        admin.require_auth();

        let key = DataKey::Event(event_id.clone());
        if env.storage().persistent().has(&key) {
            panic_err(&env, Error::EventAlreadyRegistered);
        }
        let cfg = EventConfig {
            cap,
            merkle_root: merkle_root.clone(),
        };
        env.storage().persistent().set(&key, &cfg);

        EventRegistered {
            event_id,
            cap,
            merkle_root,
        }
        .publish(&env);
    }

    /// Verify a resale proof and burn its nullifier.
    ///
    /// `public_signals` MUST be `[perEventCap, merkleRoot, nullifierHash]`
    /// (serialized via `PublicSignals::to_bytes`). This:
    ///   1. looks up the registered `EventConfig` for `event_id` (errors if none);
    ///   2. asserts `public[0] == cfg.cap` and `public[1] == cfg.merkle_root`
    ///      (binds the proof to *this* event's cap + issued set);
    ///   3. asserts `public[2]` (nullifier) is unused;
    ///   4. runs the BN254 Groth16 pairing check against the stored VK;
    ///   5. on success: burns the nullifier, emits a `resale` event, returns true.
    ///
    /// Any failed check panics with the corresponding `Error` (so the host
    /// transaction reverts) — the contract never silently accepts an invalid or
    /// replayed proof.
    pub fn verify_resale(
        env: Env,
        event_id: String,
        proof_bytes: Bytes,
        public_signals: Bytes,
    ) -> bool {
        // 1. Event must be registered.
        let cfg: EventConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Event(event_id.clone()))
            .unwrap_or_else(|| panic_err(&env, Error::EventNotRegistered));

        let pub_sig = PublicSignals::from_bytes(&env, &public_signals);
        if pub_sig.pub_signals.len() != 3 {
            panic_err(&env, Error::MalformedVerifyingKey);
        }
        let cap_signal = pub_sig.pub_signals.get(0).unwrap();
        let root_signal = pub_sig.pub_signals.get(1).unwrap();
        let nullifier_signal = pub_sig.pub_signals.get(2).unwrap();

        // 2a. public perEventCap == registered cap.
        let cap_fr = i128_to_fr(&env, cfg.cap);
        if cap_signal != cap_fr {
            panic_err(&env, Error::CapMismatch);
        }
        // 2b. public merkleRoot == registered root.
        let root_fr = bytes32_to_fr(&env, &cfg.merkle_root);
        if root_signal != root_fr {
            panic_err(&env, Error::RootMismatch);
        }

        // 3. nullifier unused. Use the 32-byte field repr as the storage key.
        let nullifier_bytes: BytesN<32> = nullifier_signal.to_bytes();
        let null_key = DataKey::Nullifier(nullifier_bytes.clone());
        if env.storage().persistent().has(&null_key) {
            panic_err(&env, Error::NullifierAlreadyUsed);
        }

        // 4. Groth16 pairing check against the stored VK.
        let vk_bytes: Bytes = env.storage().instance().get(&DataKey::Vk).unwrap();
        let vk = VerificationKey::from_bytes(&env, &vk_bytes)
            .unwrap_or_else(|_| panic_err(&env, Error::MalformedVerifyingKey));
        let proof = Proof::from_bytes(&env, &proof_bytes);

        let ok = Groth16Verifier::verify_proof(&env, &vk, &proof, &pub_sig.pub_signals)
            .unwrap_or_else(|_| panic_err(&env, Error::MalformedVerifyingKey));
        if !ok {
            panic_err(&env, Error::ProofInvalid);
        }

        // 5. Burn nullifier, emit, return.
        env.storage().persistent().set(&null_key, &true);
        ResaleVerified {
            event_id,
            cap: cfg.cap,
            nullifier: nullifier_bytes,
        }
        .publish(&env);
        true
    }

    // ---- views -------------------------------------------------------------

    /// Whether a nullifier has been burned (ticket already resold).
    pub fn is_nullified(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    /// Fetch a registered event's config (cap + root), if any.
    pub fn get_event(env: Env, event_id: String) -> Option<EventConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::Event(event_id))
    }

    /// The admin address.
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    // ---- internal ----------------------------------------------------------

    fn require_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_err(env, Error::NotAuthorized))
    }
}

/// Panic with a typed contract error (so the host returns it cleanly).
fn panic_err(env: &Env, e: Error) -> ! {
    panic_with_error(env, e)
}

#[inline(always)]
fn panic_with_error(env: &Env, e: Error) -> ! {
    soroban_sdk::panic_with_error!(env, e);
}

/// Convert a non-negative `i128` (USDC cents) into a BN254 `Fr` field
/// element, matching how the circuit encodes `perEventCap` (a small integer
/// decimal string). Negative caps are nonsensical and are rejected.
fn i128_to_fr(env: &Env, v: i128) -> Fr {
    if v < 0 {
        panic_err(env, Error::CapMismatch);
    }
    let u = soroban_sdk::U256::from_u128(env, v as u128);
    Fr::from_u256(u)
}

/// Interpret a 32-byte big-endian value as a BN254 `Fr` field element.
fn bytes32_to_fr(env: &Env, b: &BytesN<32>) -> Fr {
    let u = soroban_sdk::U256::from_be_bytes(env, &Bytes::from_array(env, &b.to_array()));
    Fr::from_u256(u)
}
