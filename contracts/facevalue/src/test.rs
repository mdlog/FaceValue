#![cfg(test)]
extern crate std;

use soroban_sdk::{
    crypto::bn254::Fr,
    testutils::Address as _,
    Address, Bytes, BytesN, Env, String, Vec, U256,
};

use crate::{
    bn254_real_fixture as fx, Error, FaceValue, FaceValueClient, Groth16Verifier, Proof,
    PublicSignals, VerificationKey,
};

// ---------------------------------------------------------------------------
// All BN254 points/bytes used here come PRE-SERIALIZED from
// `scripts/zk/make-contract-fixture.mjs`, which runs the REAL snarkjs
// `groth16.fullProve` over `public/circuits/{resale.wasm, resale_final.zkey}`
// for the demo ticket at a fair price and converts the snarkjs decimal
// coordinates into the exact BN254 byte layout the contract's `from_bytes`
// expects. There is therefore no curve/ark dependency in the test crate —
// we feed genuine proof bytes straight in.
// ---------------------------------------------------------------------------

fn real_vk_bytes(env: &Env) -> Bytes {
    Bytes::from_slice(env, &fx::REAL_VK_BYTES)
}

fn real_proof_bytes(env: &Env) -> Bytes {
    Bytes::from_slice(env, &fx::REAL_PROOF_BYTES)
}

fn real_public_signals_bytes(env: &Env) -> Bytes {
    Bytes::from_slice(env, &fx::REAL_PUBLIC_SIGNALS_BYTES)
}

fn deploy(env: &Env, admin: &Address, vk_bytes: &Bytes) -> FaceValueClient<'static> {
    let id = env.register(FaceValue, (admin.clone(), vk_bytes.clone()));
    FaceValueClient::new(env, &id)
}

/// Build serialized public signals `[cap, root, nullifier]` from raw values,
/// for the negative tests that need a mismatched cap/root.
fn pub_signals_bytes(env: &Env, cap: i128, root: &BytesN<32>, nullifier: &BytesN<32>) -> Bytes {
    let cap_fr = Fr::from_u256(U256::from_u128(env, cap as u128));
    let root_fr = Fr::from_u256(U256::from_be_bytes(
        env,
        &Bytes::from_array(env, &root.to_array()),
    ));
    let null_fr = Fr::from_u256(U256::from_be_bytes(
        env,
        &Bytes::from_array(env, &nullifier.to_array()),
    ));
    let ps = PublicSignals {
        pub_signals: Vec::from_array(env, [cap_fr, root_fr, null_fr]),
    };
    ps.to_bytes(env)
}

fn real_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &fx::REAL_MERKLE_ROOT)
}

fn real_nullifier(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &fx::REAL_NULLIFIER)
}

const EVENT_ID: &str = "evt-aurora";

// ===========================================================================
// 1. Crypto path: the embedded BN254 verifier accepts OUR circuit's REAL proof.
// ===========================================================================

#[test]
fn embedded_verifier_accepts_real_bn254_proof_and_rejects_tampered() {
    let env = Env::default();

    let vk = VerificationKey::from_bytes(&env, &real_vk_bytes(&env)).unwrap();
    let proof = Proof::from_bytes(&env, &real_proof_bytes(&env));
    let ps = PublicSignals::from_bytes(&env, &real_public_signals_bytes(&env));

    // Real, valid BN254 proof from our circom/snarkjs pipeline -> true.
    let ok = Groth16Verifier::verify_proof(&env, &vk, &proof, &ps.pub_signals).unwrap();
    assert!(ok, "real BN254 Groth16 proof from resale.circom must verify");

    // Tamper a public signal -> false (sound).
    let mut tampered = Vec::new(&env);
    tampered.push_back(ps.pub_signals.get(0).unwrap());
    tampered.push_back(ps.pub_signals.get(1).unwrap());
    tampered.push_back(Fr::from_u256(U256::from_u32(&env, 1)));
    let bad = Groth16Verifier::verify_proof(&env, &vk, &proof, &tampered).unwrap();
    assert!(!bad, "tampered public signal must NOT verify");
}

#[test]
fn vk_proof_pubsignals_serde_roundtrip() {
    let env = Env::default();

    // VK round-trips byte-for-byte.
    let vk = VerificationKey::from_bytes(&env, &real_vk_bytes(&env)).unwrap();
    let vk_b = vk.to_bytes(&env);
    let vk2 = VerificationKey::from_bytes(&env, &vk_b).unwrap();
    assert_eq!(vk.alpha, vk2.alpha);
    assert_eq!(vk.ic, vk2.ic);
    assert_eq!(vk_b, real_vk_bytes(&env));

    // Proof round-trips.
    let proof = Proof::from_bytes(&env, &real_proof_bytes(&env));
    let p_b = proof.to_bytes(&env);
    let p2 = Proof::from_bytes(&env, &p_b);
    assert_eq!(proof.a, p2.a);
    assert_eq!(proof.b, p2.b);
    assert_eq!(proof.c, p2.c);
    assert_eq!(p_b, real_proof_bytes(&env));

    // PublicSignals round-trip.
    let ps = PublicSignals::from_bytes(&env, &real_public_signals_bytes(&env));
    let ps_b = ps.to_bytes(&env);
    let ps2 = PublicSignals::from_bytes(&env, &ps_b);
    assert_eq!(ps.pub_signals, ps2.pub_signals);
    assert_eq!(ps_b, real_public_signals_bytes(&env));
    assert_eq!(ps.pub_signals.len(), 3);
}

// ===========================================================================
// 2. END-TO-END HAPPY PATH (the headline success criterion):
//    register_event(real cap+root) then verify_resale(real BN254 proof) == true.
// ===========================================================================

#[test]
fn verify_resale_accepts_real_bn254_proof_end_to_end() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    // Register the event with the SAME cap + merkleRoot the proof's public
    // signals carry (perEventCap = 12000, merkleRoot = evt-aurora root).
    let event_id = String::from_str(&env, EVENT_ID);
    client.register_event(&event_id, &fx::REAL_CAP, &real_root(&env));

    // The headline assertion: the contract verifies a genuine FaceValue proof.
    let verified = client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
    assert!(verified, "verify_resale(real BN254 proof) must return true");

    // And the nullifier is now burned.
    assert!(client.is_nullified(&real_nullifier(&env)));
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // NullifierAlreadyUsed
fn verify_resale_real_proof_replay_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, EVENT_ID);
    client.register_event(&event_id, &fx::REAL_CAP, &real_root(&env));

    // First verify burns the nullifier.
    let first = client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
    assert!(first);

    // Replaying the exact same proof must revert (#8) — resold at most once.
    client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
}

// ===========================================================================
// 3. Business layer: registry, admin auth, nullifier set, signal binding.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // MalformedVerifyingKey
fn constructor_rejects_wrong_shape_vk() {
    let env = Env::default();
    let admin = Address::generate(&env);
    // A VK with only 3 IC points (=> 2 public signals) is the WRONG shape for the
    // FaceValue 3-public-signal circuit (needs 4 IC). __constructor must reject
    // it at deploy time. We synthesize a 3-IC VK by re-serializing the real VK
    // with its last IC point dropped.
    let real = VerificationKey::from_bytes(&env, &real_vk_bytes(&env)).unwrap();
    let mut ic3 = Vec::new(&env);
    for (i, g1) in real.ic.iter().enumerate() {
        if i < 3 {
            ic3.push_back(g1);
        }
    }
    let bad = VerificationKey {
        alpha: real.alpha.clone(),
        beta: real.beta.clone(),
        gamma: real.gamma.clone(),
        delta: real.delta.clone(),
        ic: ic3,
    };
    let _ = env.register(FaceValue, (admin, bad.to_bytes(&env)));
}

#[test]
fn register_event_and_read_back() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, EVENT_ID);
    let cap: i128 = 12000;
    let root = real_root(&env);
    client.register_event(&event_id, &cap, &root);

    let cfg = client.get_event(&event_id).unwrap();
    assert_eq!(cfg.cap, cap);
    assert_eq!(cfg.merkle_root, root);
    assert_eq!(client.admin(), admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // EventAlreadyRegistered
fn register_event_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, "evt-derby");
    let root = BytesN::from_array(&env, &[3u8; 32]);
    client.register_event(&event_id, &9000i128, &root);
    client.register_event(&event_id, &9000i128, &root); // panics
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // EventNotRegistered
fn verify_unregistered_event_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, "evt-ghost");
    client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    ); // panics #5
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // CapMismatch
fn verify_cap_mismatch_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, EVENT_ID);
    let root = real_root(&env);
    // Register with a cap that DOES NOT match the proof's public perEventCap.
    client.register_event(&event_id, &99999i128, &root);

    // public cap 12000 != registered 99999 -> #6 before any pairing work.
    client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // RootMismatch
fn verify_root_mismatch_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, EVENT_ID);
    let wrong_root = BytesN::from_array(&env, &[8u8; 32]);
    // cap matches the proof, root differs -> #7 before any pairing work.
    client.register_event(&event_id, &fx::REAL_CAP, &wrong_root);

    client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // NullifierAlreadyUsed
fn verify_replayed_nullifier_panics() {
    // Pre-seed the proof's nullifier as already-burned, then a verify with the
    // real proof must hit the reuse guard (#8) before the pairing.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let vk_bytes = real_vk_bytes(&env);
    let contract_id = env.register(FaceValue, (admin.clone(), vk_bytes));
    let client = FaceValueClient::new(&env, &contract_id);

    let event_id = String::from_str(&env, EVENT_ID);
    client.register_event(&event_id, &fx::REAL_CAP, &real_root(&env));

    let null = real_nullifier(&env);
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&crate::DataKey::Nullifier(null.clone()), &true);
    });
    assert!(client.is_nullified(&null));

    client.verify_resale(
        &event_id,
        &real_proof_bytes(&env),
        &real_public_signals_bytes(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")] // ProofInvalid
fn verify_tampered_proof_panics() {
    // A proof whose public signals are bound correctly (cap+root match) but whose
    // proof BYTES are corrupted must fail the pairing check -> #9.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));

    let event_id = String::from_str(&env, EVENT_ID);
    client.register_event(&event_id, &fx::REAL_CAP, &real_root(&env));

    // Use the real public signals (so cap/root/nullifier guards pass) but a
    // DIFFERENT, on-curve G1 for `a` (we reuse `c`'s bytes for `a`) so the
    // pairing equation no longer holds.
    let real = Proof::from_bytes(&env, &real_proof_bytes(&env));
    let bad = Proof {
        a: real.c.clone(), // wrong A -> pairing fails
        b: real.b.clone(),
        c: real.c.clone(),
    };
    let bad_bytes = bad.to_bytes(&env);

    client.verify_resale(&event_id, &bad_bytes, &real_public_signals_bytes(&env));
}

#[test]
fn nullifier_view_defaults_false() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));
    let null = BytesN::from_array(&env, &[5u8; 32]);
    assert!(!client.is_nullified(&null));
}

#[test]
fn register_requires_admin_auth() {
    // Without mock_all_auths, register_event must require the admin's auth.
    let env = Env::default();
    let admin = Address::generate(&env);
    let client = deploy(&env, &admin, &real_vk_bytes(&env));
    let event_id = String::from_str(&env, EVENT_ID);
    let root = real_root(&env);
    // try_register_event returns Err because admin.require_auth() is unsatisfied.
    let res = client.try_register_event(&event_id, &12000i128, &root);
    assert!(res.is_err(), "register_event must fail without admin auth");
}

// Silence unused-import warnings if a path changes.
#[allow(unused)]
fn _unused(_e: Error, _b: fn(&Env, i128, &BytesN<32>, &BytesN<32>) -> Bytes) {
    let _ = pub_signals_bytes;
}
