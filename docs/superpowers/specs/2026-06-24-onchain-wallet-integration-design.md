# On-chain Wallet Integration — Design Spec

- **Date:** 2026-06-24
- **Status:** Approved design (pre-implementation)
- **Topic:** Connect a Stellar wallet and submit the real `verify_resale` invocation to the FaceValue Soroban contract on testnet.

---

## 1. Context & current state

FaceValue proves each ticket resale is at/below a public face-value cap with a Groth16 (BN254) proof, then a Soroban contract verifies the proof and burns a nullifier (anti double-sell). Today:

- The Groth16 **proving + verification path is real** (`/api/prove`, `/api/verify`, snarkjs).
- The Soroban contract (`contracts/facevalue`) **compiles and passes tests** (incl. verifying a real BN254 proof) but is **NOT deployed** — the `stellar` CLI is absent in the build env, and the resale verdict shows a *derived* tx-like hash, not a real testnet tx.
- There is **no wallet integration of any kind** (no Stellar SDK, no Freighter, no wallet kit in `package.json`). `/wallet` is a *ticket* wallet (mock stubs), not a crypto-account connection.

This spec adds: connect a Stellar wallet, and on an accepted resale, submit & sign a **real** `verify_resale` transaction to Soroban testnet.

## 2. Goals / Non-goals

**Goals**
- Connect/disconnect a Stellar wallet via **Stellar Wallets Kit** (Freighter, xBull, Albedo, Lobstr, Hana, Ledger).
- On an accepted (under-cap, proof-valid) resale, **serialize the proof → BN254 bytes**, build the `verify_resale` invocation, **simulate** via Soroban RPC, have the **wallet sign**, **submit**, and show the **real tx hash** + on-chain verdict.
- Ship a **deploy script** that puts the contract on testnet (build → deploy → `init` with `vk_bytes` → `register_event ×3`) and emits a `CONTRACT_ID`.
- **Graceful degradation**: with no `CONTRACT_ID` or no connected wallet, the app behaves exactly as today (derived hash, clearly labelled). The app and CI never break.

**Non-goals (out of scope)**
- USDC / token settlement on-chain. The contract has **no payment path**; settlement stays mock. (Would be a separate, larger feature.)
- Moving proving client-side (stays server-side at `/api/prove`).
- Replacing the existing simulated/derived-hash flow (it remains as the fallback).
- Wiring `/door` and `/audit` to live chain reads (could be a follow-up using `is_nullified` / events; not in this spec).

## 3. Decisions (locked via brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Deploy-later**: I write frontend + deploy script; deploy runs when `stellar` CLI / Bash available; `CONTRACT_ID` pasted into `.env.local`. | CLI absent in this env. |
| D2 | **Stellar Wallets Kit** (`@creit.tech/stellar-wallets-kit`). | Multi-wallet, best UX, not locked to one extension. |
| D3 | **Approach A — augment + graceful fallback** (not replace). | Matches the app's existing fallback philosophy; CI/demo never break; ZK stays load-bearing. |
| D4 | **Scope = `verify_resale` submission only.** | Contract is verify-and-nullify only; no payment path. YAGNI. |
| D5 | **Serialization is a pure client-side TS util.** | No secrets (proof + signals already reach the client today); enables cross-language test vs the contract's known-good fixture. |

## 4. Architecture

New layer `src/lib/stellar/` + a serializer in `src/lib/zk/`. Everything is **config-driven** and **degrades gracefully**.

```
resale UI ──► /api/prove ──► { proof(JSON), publicSignals=[cap,root,nullifier] }
                                   │
                                   ▼
                    src/lib/zk/groth16-serialize.ts
                    serializeProof()      → proofBytes (256 B)
                    serializePublicSignals() → signalsBytes
                                   │
              isOnChainConfigured() && wallet connected?
                       │ yes                         │ no
                       ▼                             ▼
        src/lib/stellar/submit.ts            existing derived-hash verdict
        build verify_resale invocation         (labelled "simulated/derived")
        → RPC.simulate (prepareTransaction)
        → wallet.signTransaction (Wallets Kit)
        → RPC.sendTransaction → poll getTransaction
                       │
                       ▼
        real tx hash + on-chain verdict (success | mapped contract error)
```

**Over-cap path is unchanged**: no proof can be produced, so there is nothing to submit — enforcement remains the ZK unsatisfiability. This preserves the "ZK is load-bearing" narrative.

## 5. Components (one responsibility each)

### 5.1 `src/lib/stellar/config.ts`
- Reads public env (client-safe): `NEXT_PUBLIC_FACEVALUE_CONTRACT_ID`, `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`.
- Exports `getStellarConfig()` and `isOnChainConfigured(): boolean` (true only when a non-empty `CONTRACT_ID` + RPC URL are present).
- No dependency on the SDK (pure env reads) so it is cheap to import anywhere.

### 5.2 `src/lib/stellar/wallet.tsx` (client component)
- `WalletProvider` React context + `useWallet()` hook.
- Wraps **Stellar Wallets Kit**, instantiated **lazily / client-only** (the kit touches `window`; guard with `typeof window` / `useEffect`).
- Surface: `{ address: string | null, connect(): Promise<void>, disconnect(): void, signTransaction(xdr, opts): Promise<{ signedTxXdr: string }>, connecting: boolean, error: string | null }`.
- `connect()` opens the kit modal, stores the selected wallet id + address; persists last-used wallet id to `localStorage` for reconnect.
- Network passphrase comes from config (default testnet).

### 5.3 `src/lib/zk/groth16-serialize.ts` (pure, no React, no SDK)
Converts snarkjs JSON → the exact byte layout the contract's `from_bytes` expects. Exports:
- `serializeProof(proofJson): Uint8Array` → `a(G1,64) | b(G2,128) | c(G1,64)` = **256 bytes**.
- `serializePublicSignals(signals: string[]): Uint8Array` → `u32-BE len | each field be32` (for FaceValue: len=3).
- `serializeVerificationKey(vkJson): Uint8Array` → `alpha(G1) | beta(G2) | gamma(G2) | delta(G2) | ic_len(u32-BE) | ic[*](G1)` (used by the deploy script to produce `vk_bytes`).

**Encoding rules (must match the contract byte-for-byte):**
- Field element: decimal string → `BigInt` → **32-byte big-endian** (left-pad). Reject values ≥ field modulus is not required (snarkjs outputs are already reduced); we just left-pad to 32.
- **G1** = `be32(X) || be32(Y)` (64 B). Drop the snarkjs projective 3rd coord (`z = "1"`).
- **G2** = `be32(X.c1) || be32(X.c0) || be32(Y.c1) || be32(Y.c0)` (128 B) — **imaginary component FIRST** (the contract comment at `lib.rs:87` and the canonical snarkjs→Solidity G2 swap). snarkjs G2 coord is `[c0, c1]`, so emit `c1` then `c0`. Drop the projective `[1,0]` 3rd coord.
- All multi-byte integers (length prefixes) are **big-endian**.

### 5.4 `src/lib/stellar/submit.ts`
- `submitVerifyResale({ contractId, rpcUrl, networkPassphrase, address, signTransaction, eventId, proof, publicSignals }) → Promise<SubmitResult>`.
- Steps (via `@stellar/stellar-sdk`):
  1. `const server = new rpc.Server(rpcUrl)`; `const account = await server.getAccount(address)`.
  2. `const op = new Contract(contractId).call("verify_resale", eventIdScVal, proofBytesScVal, signalsBytesScVal)` where args are `nativeToScVal(eventId, {type:"string"})`, `nativeToScVal(proofBytes, {type:"bytes"})`, `nativeToScVal(signalsBytes, {type:"bytes"})`.
  3. `let tx = new TransactionBuilder(account, {fee, networkPassphrase}).addOperation(op).setTimeout(30).build()`.
  4. `tx = await server.prepareTransaction(tx)` (simulate; attaches footprint + resource fees). A simulation that *errors* (e.g. a contract panic) is caught here and mapped — we can detect the revert **before** asking the user to sign.
  5. `const { signedTxXdr } = await signTransaction(tx.toXDR(), { address, networkPassphrase })`.
  6. `const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase))`.
  7. Poll `server.getTransaction(sent.hash)` until `SUCCESS`/`FAILED`.
- `verify_resale` is **permissionless** (no `require_auth` on a specific address) — the connected wallet is just the **source account / fee payer / signer**. No extra auth entries expected; simulation confirms.
- Returns `{ status: "success" | "reverted" | "error", hash?: string, contractError?: ContractErrorCode, message: string }`.

### 5.5 `src/components/connect-wallet.tsx` (client)
- "Connect Wallet" button → when connected shows truncated address (`GABC…7Q2X`) with a disconnect affordance.
- Lives in `TopNav`. **Responsive**: on mobile it sits in the header next to the hamburger (icon + short address); full label at `sm+`. Reuses `HashMono`-style truncation.

### 5.6 `scripts/soroban/deploy.mjs` (run later, needs `stellar` CLI)
- `stellar contract build` (target `wasm32v1-none`).
- `stellar contract deploy` the wasm → capture `CONTRACT_ID`.
- Compute `vk_bytes` hex via `serializeVerificationKey(verification_key.json)` and call `init(admin, vk_bytes)` (admin = the deploying identity).
- For each of the 3 events: read `cap` (cents → i128) and `merkle_root` from `src/lib/zk/fixtures.json` (so the on-chain `EventConfig` matches the proof's `publicSignals`), call `register_event(event_id, cap, merkle_root)`.
- Print `CONTRACT_ID` and the exact `.env.local` lines to paste.
- **Critical invariant:** `register_event` cap/root MUST equal the circuit's `perEventCap`/`merkleRoot` for that `eventId`, else `verify_resale` reverts with `CapMismatch(6)` / `RootMismatch(7)`. Source both from `fixtures.json`.

### 5.7 `.env.example`
```
NEXT_PUBLIC_FACEVALUE_CONTRACT_ID=
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

### 5.8 Edits to existing files
- `src/app/layout.tsx`: wrap `{children}` in `<WalletProvider>`; render `<ConnectWallet/>` in `TopNav` area.
- `src/components/top-nav.tsx`: slot the connect button (desktop: right of nav; mobile: in header / menu).
- `src/app/resale/page.tsx`: after a real accepted proof, if configured + connected, run the on-chain submit as an explicit step in the existing stepper ("Submitting to Soroban · wallet signs"), then render the real tx hash via `TxStamp`. Preserve all current states for the fallback path.
- `README.md`: deploy steps + env vars + updated REAL/MOCK table (on-chain submission becomes real once deployed).

## 6. Contract interface reference (from `contracts/facevalue/src/lib.rs`)

- `__constructor(env, admin: Address, vk_bytes: Bytes)` / `init(...)` alias — stores admin + VK (validates `ic.len() == 4`, i.e. 3 public signals).
- `register_event(env, event_id: String, cap: i128, merkle_root: BytesN<32>)` — admin-only.
- `verify_resale(env, event_id: String, proof_bytes: Bytes, public_signals: Bytes) -> bool` — the user-facing call.
- Views: `is_nullified(nullifier) -> bool`, `get_event(event_id) -> Option<EventConfig>`, `admin() -> Address`.
- Public signal order: `[perEventCap, merkleRoot, nullifierHash]`.

**Error codes** (mapped to UI messages):

| Code | Name | UI message |
|---|---|---|
| 5 | EventNotRegistered | "Event belum terdaftar di kontrak." |
| 6 | CapMismatch | "Cap on-chain tidak cocok (deploy/register salah)." |
| 7 | RootMismatch | "Merkle root on-chain tidak cocok." |
| 8 | NullifierAlreadyUsed | "Tiket sudah dijual ulang on-chain — ditolak." (valid anti-double-sell demo) |
| 9 | ProofInvalid | "Proof ditolak kontrak." (should not happen for a valid proof) |

## 7. Data flow detail (accepted resale)

1. `proveResale(buildResaleInput(priceCents))` → `{ ok:true, proof, publicSignals }`.
2. `serializeProof(proof)`, `serializePublicSignals(publicSignals)`.
3. Branch:
   - **Configured + connected** → `submitVerifyResale(...)`:
     - simulate; if it reverts, stop and show the mapped error (no signature requested).
     - else wallet signs → send → poll → on `SUCCESS` show **real `hash`** + "nullifier burned on-chain".
   - **Else** → existing behavior: `txHash` derived from the nullifier public signal; show the `simulated`/derived label.
4. The over-cap (rejected) path never reaches step 2–3 (no proof exists).

## 8. Graceful-degradation matrix

| `CONTRACT_ID` set? | Wallet connected? | Resale accept behavior |
|---|---|---|
| no | – | Current derived-hash verdict, labelled. Connect button still works (informational). |
| yes | no | Verdict shown; a "Connect wallet to submit on-chain" CTA appears; derived hash used if user skips. |
| yes | yes | Real `verify_resale` submitted + signed; real tx hash shown. |

## 9. Error handling

- **Wallet not installed / user rejects** → inline error, **no state change**, resale verdict (off-chain) still stands.
- **Config absent** → on-chain step hidden; informational note.
- **RPC / network error** → surfaced; off-chain proof verdict remains valid.
- **Contract revert** (simulate or final) → mapped per §6 table; the `NullifierAlreadyUsed` case is rendered as a *legitimate* "already resold" outcome.

## 10. Testing strategy

- **TDD the serializer** (`src/lib/zk/groth16-serialize.test.ts`):
  - Cross-check `serializeProof` / `serializeVerificationKey` / `serializePublicSignals` output against the **known-good byte arrays in `contracts/facevalue/src/bn254_real_fixture.rs`** (Rust↔TS cross-language vector) — proves the bytes are correct **without** a testnet.
  - **Dependency/risk:** this requires the snarkjs JSON that *produced* those fixture bytes. If it is not committed, regenerate via `npm run zk:build` (which writes `src/lib/zk/fixtures.json` and proving artifacts) and capture the matching `proof.json`/`public.json`; if still unavailable, fall back to structural tests (length 256/exact prefixes, G2 ordering round-trip) + a manual testnet smoke. Resolve in the plan's first task.
  - Edge cases: short field elements left-pad to 32; G2 component order; length prefix endianness.
- **Build/typecheck**: `npm run build` green (incl. SDK bundling — see §11).
- **Manual testnet smoke** (deferred until deployed): connect → accepted resale → sign → see tx on a testnet explorer; second submit of the same ticket → `NullifierAlreadyUsed`.

## 11. Risks & deferred work (honest)

- **Next 16 / Turbopack bundling**: `@stellar/stellar-sdk` is large and has Node-ish deps. Before writing `wallet.tsx` / `submit.ts`, **read `node_modules/next/dist/docs/`** (per `AGENTS.md`: "this is NOT the Next.js you know") for client-component + external-package guidance; the wallet/submit code is **client-side**, and we may need `next.config.ts` adjustments (e.g. `serverExternalPackages` only affects server — client bundling of the SDK must just work or be tree-shaken). Verify with a real build.
- **Deploy + `npm install` + build are gated** on the Bash classifier recovering AND the `stellar` CLI being installed. Code is written first; runtime verification follows. The deploy script is provided but unexecuted in this env.
- **Nullifier single-use**: once one accept succeeds on-chain, re-submitting the same demo ticket reverts (`NullifierAlreadyUsed`) — intentional; UI treats it as "Refused / already resold."
- **Wallets Kit SSR**: must be client-only; guard all `window` access.

## 12. File manifest (new + changed)

**New**
- `src/lib/stellar/config.ts`
- `src/lib/stellar/wallet.tsx`
- `src/lib/stellar/submit.ts`
- `src/lib/zk/groth16-serialize.ts`
- `src/lib/zk/groth16-serialize.test.ts`
- `src/components/connect-wallet.tsx`
- `scripts/soroban/deploy.mjs`
- `.env.example`

**Changed**
- `src/app/layout.tsx`, `src/components/top-nav.tsx`, `src/app/resale/page.tsx`, `README.md`, `package.json` (+2 deps).
