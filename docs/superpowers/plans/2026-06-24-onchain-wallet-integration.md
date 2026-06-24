# On-chain Wallet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a Stellar wallet and, on an accepted resale, submit + sign a real `verify_resale` transaction to the FaceValue Soroban contract on testnet — degrading gracefully to today's behavior when unconfigured.

**Architecture:** A new `src/lib/stellar/` layer (config, wallet provider, submit client) plus a pure `src/lib/zk/groth16-serialize.ts` that converts snarkjs JSON → the exact BN254 byte layout the contract expects. The resale page calls `/api/prove` (unchanged), serializes the proof, and — only when a `CONTRACT_ID` is configured AND a wallet is connected — simulates → signs (Stellar Wallets Kit) → submits via Soroban RPC. Otherwise the existing derived-hash verdict is shown.

**Tech Stack:** Next.js 16.2.9 (App Router, Turbopack), React 19, TypeScript (strict), `@creit.tech/stellar-wallets-kit`, `@stellar/stellar-sdk`, `vitest` (new dev dep), snarkjs (existing, server-only).

## Global Constraints

- **Next.js is non-standard** (per `AGENTS.md`): before writing client-bundling-sensitive code (Tasks 4, 5), read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.
- **TypeScript strict**; path alias `@/* → ./src/*` (`tsconfig.json`).
- Wallet + submit code is **client-side**; mark `"use client"` and guard every `window`/`localStorage` access.
- `snarkjs` is in `serverExternalPackages` (server-only, `next.config.ts`). `@stellar/stellar-sdk` runs **client-side** and must bundle in the browser — verify with a real build.
- **Public signal order is fixed:** `[perEventCap, merkleRoot, nullifierHash]`.
- **Byte layout (verbatim from the contract & `make-contract-fixture.mjs`):** Fp = 32-byte big-endian; G1 = `be32(X)||be32(Y)` (64 B); G2 = `be32(X.c1)||be32(X.c0)||be32(Y.c1)||be32(Y.c0)` (128 B, **imaginary c1 FIRST**; snarkjs stores `[c0,c1]` so each pair is swapped); length prefixes are u32 big-endian.
- **Env vars** (client-readable, `NEXT_PUBLIC_` prefix): `NEXT_PUBLIC_FACEVALUE_CONTRACT_ID`, `NEXT_PUBLIC_SOROBAN_RPC_URL` (default `https://soroban-testnet.stellar.org`), `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` (default `Test SDF Network ; September 2015` — copy verbatim, includes spaces + a semicolon).
- **Graceful degradation:** with no `CONTRACT_ID` or no connected wallet, behavior is exactly as today; the build and CI never break.
- **Contract entry point:** `verify_resale(event_id: String, proof_bytes: Bytes, public_signals: Bytes) -> bool` (permissionless — wallet is just source/fee-payer/signer). Admin/deploy: `init(admin: Address, vk_bytes: Bytes)`, `register_event(event_id: String, cap: i128, merkle_root: BytesN<32>)`. Error codes: 5 EventNotRegistered, 6 CapMismatch, 7 RootMismatch, 8 NullifierAlreadyUsed, 9 ProofInvalid.
- **Demo `eventId` for resale = `evt-aurora`** (the demo ticket `tkt-AUR-0482`'s event); cap/root come from `src/lib/zk/fixtures.json`.

---

### Task 1: Branch, dependencies, test runner, env example

**Files:**
- Modify: `package.json` (deps + `test` script)
- Create: `vitest.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: a `feat/onchain-wallet` branch; `npm test` runs vitest with `@/*` alias resolution; installed `@creit.tech/stellar-wallets-kit`, `@stellar/stellar-sdk`, dev `vitest`.

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b feat/onchain-wallet`
Expected: `Switched to a new branch 'feat/onchain-wallet'`

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @creit.tech/stellar-wallets-kit @stellar/stellar-sdk
npm install -D vitest
```
Expected: installs succeed; `package.json` gains the three packages.

- [ ] **Step 3: Add the test script to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create `vitest.config.ts`** (resolves the `@/*` alias used across `src`)

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `.env.example`**

```bash
# Soroban / Stellar — on-chain verify_resale submission.
# Leave CONTRACT_ID empty until the contract is deployed (see scripts/soroban/deploy.mjs).
# With it empty the app falls back to the simulated/derived verdict.
NEXT_PUBLIC_FACEVALUE_CONTRACT_ID=
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

- [ ] **Step 6: Verify the build still passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`, all routes generated (no regression from adding deps).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .env.example
git commit -m "chore: add stellar-sdk, wallets-kit, vitest + env example"
```

---

### Task 2: Groth16 → BN254 byte serializer (TDD against golden vectors)

Port the proven serialization from `scripts/zk/make-contract-fixture.mjs` into a typed, browser-safe module, and prove it byte-for-byte against the committed contract fixtures.

**Files:**
- Create: `src/lib/zk/groth16-serialize.ts`
- Test: `src/lib/zk/groth16-serialize.test.ts`
- Read (sources of truth): `public/circuits/verification_key.json`, `src/lib/zk/fixtures.json`, `contracts/facevalue/src/bn254_real_fixture.rs`

**Interfaces:**
- Produces:
  - `type SnarkG1 = [string, string, string]`
  - `type SnarkG2 = [[string, string], [string, string], [string, string]]`
  - `interface SnarkProof { pi_a: SnarkG1; pi_b: SnarkG2; pi_c: SnarkG1; protocol: string; curve: string }`
  - `interface SnarkVerificationKey { vk_alpha_1: SnarkG1; vk_beta_2: SnarkG2; vk_gamma_2: SnarkG2; vk_delta_2: SnarkG2; IC: SnarkG1[]; curve: string; nPublic: number }`
  - `serializeProof(proof: SnarkProof): Uint8Array` (256 B)
  - `serializePublicSignals(signals: string[]): Uint8Array`
  - `serializeVerificationKey(vk: SnarkVerificationKey): Uint8Array`

- [ ] **Step 1: Write the failing test**

`src/lib/zk/groth16-serialize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  serializeVerificationKey,
  serializePublicSignals,
  serializeProof,
  type SnarkVerificationKey,
} from "./groth16-serialize";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const vk = JSON.parse(
  readFileSync(`${ROOT}/public/circuits/verification_key.json`, "utf8"),
) as SnarkVerificationKey;
const fixtures = JSON.parse(
  readFileSync(`${ROOT}/src/lib/zk/fixtures.json`, "utf8"),
);
const rust = readFileSync(
  `${ROOT}/contracts/facevalue/src/bn254_real_fixture.rs`,
  "utf8",
);

/** Extract a `pub const NAME: [u8; N] = [ 0x.., .. ];` literal as bytes. */
function parseRustU8Array(src: string, name: string): Uint8Array {
  const m = src.match(new RegExp(`${name}:\\s*\\[u8;\\s*\\d+\\]\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`const ${name} not found`);
  const hex = m[1].match(/0x[0-9a-fA-F]{2}/g);
  if (!hex) throw new Error(`no bytes in ${name}`);
  return new Uint8Array(hex.map((h) => parseInt(h, 16)));
}

describe("groth16-serialize", () => {
  it("serializes the verification key byte-for-byte (708 B golden vector)", () => {
    const expected = parseRustU8Array(rust, "REAL_VK_BYTES");
    const got = serializeVerificationKey(vk);
    expect(got.length).toBe(708);
    expect([...got]).toEqual([...expected]);
  });

  it("serializes public signals byte-for-byte (100 B golden vector)", () => {
    const expected = parseRustU8Array(rust, "REAL_PUBLIC_SIGNALS_BYTES");
    const evt = fixtures.events[fixtures.demoTicket.eventId];
    const signals = [evt.perEventCap, evt.merkleRoot, fixtures.demoTicket.nullifierHash];
    const got = serializePublicSignals(signals);
    expect(got.length).toBe(100);
    expect([...got]).toEqual([...expected]);
  });

  it("serializes a proof to exactly 256 bytes", () => {
    // Structural check (a fresh proof is randomized; the VK + signals golden
    // vectors already prove g1/g2/fp encoding correctness, which serializeProof reuses).
    const dummy = {
      pi_a: ["1", "2", "1"],
      pi_b: [["1", "2"], ["3", "4"], ["1", "0"]],
      pi_c: ["5", "6", "1"],
      protocol: "groth16",
      curve: "bn128",
    } as const;
    expect(serializeProof(dummy as never).length).toBe(256);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './groth16-serialize'` (or "serializeVerificationKey is not a function").

- [ ] **Step 3: Implement `src/lib/zk/groth16-serialize.ts`**

```ts
// FaceValue — snarkjs Groth16 (BN254) JSON → the EXACT byte layout the Soroban
// contract's bn254 `from_bytes` expects. Pure & browser-safe (no fs/node).
// Ported from scripts/zk/make-contract-fixture.mjs (which produced the committed
// contract golden vectors) — keep the two in sync; both are pinned by the
// golden-vector test in groth16-serialize.test.ts.
//
// Layout: Fp = be32; G1 = be32(X)||be32(Y); G2 = be32(X.c1)||be32(X.c0)||be32(Y.c1)||be32(Y.c0)
// (imaginary c1 FIRST; snarkjs stores [c0,c1] so each pair is swapped). Lengths are u32 BE.

export type SnarkG1 = [string, string, string];
export type SnarkG2 = [[string, string], [string, string], [string, string]];

export interface SnarkProof {
  pi_a: SnarkG1;
  pi_b: SnarkG2;
  pi_c: SnarkG1;
  protocol: string;
  curve: string;
}

export interface SnarkVerificationKey {
  vk_alpha_1: SnarkG1;
  vk_beta_2: SnarkG2;
  vk_gamma_2: SnarkG2;
  vk_delta_2: SnarkG2;
  IC: SnarkG1[];
  curve: string;
  nPublic: number;
}

/** decimal string → 32-byte big-endian (one BN254 Fp element). */
function fpToBe32(decimal: string): Uint8Array {
  let v = BigInt(decimal);
  if (v < 0n) throw new Error(`negative field element: ${decimal}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`field element does not fit in 32 bytes: ${decimal}`);
  return out;
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function u32Be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** G1 affine [x, y, "1"] → 64 bytes be32(x)||be32(y). */
function g1ToBytes(g: SnarkG1): Uint8Array {
  return concatBytes(fpToBe32(g[0]), fpToBe32(g[1]));
}

/** G2 affine [[x0,x1],[y0,y1],...] → 128 bytes be32(x1)||be32(x0)||be32(y1)||be32(y0). */
function g2ToBytes(g: SnarkG2): Uint8Array {
  const [[x0, x1], [y0, y1]] = g;
  return concatBytes(fpToBe32(x1), fpToBe32(x0), fpToBe32(y1), fpToBe32(y0));
}

export function serializeVerificationKey(vk: SnarkVerificationKey): Uint8Array {
  return concatBytes(
    g1ToBytes(vk.vk_alpha_1),
    g2ToBytes(vk.vk_beta_2),
    g2ToBytes(vk.vk_gamma_2),
    g2ToBytes(vk.vk_delta_2),
    u32Be(vk.IC.length),
    ...vk.IC.map(g1ToBytes),
  );
}

export function serializeProof(proof: SnarkProof): Uint8Array {
  return concatBytes(g1ToBytes(proof.pi_a), g2ToBytes(proof.pi_b), g1ToBytes(proof.pi_c));
}

export function serializePublicSignals(signals: string[]): Uint8Array {
  return concatBytes(u32Be(signals.length), ...signals.map(fpToBe32));
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm test`
Expected: PASS — all three `groth16-serialize` tests green (VK and public-signals match the golden vectors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zk/groth16-serialize.ts src/lib/zk/groth16-serialize.test.ts
git commit -m "feat: snarkjs→BN254 serializer, verified vs contract golden vectors"
```

---

### Task 3: Stellar config + `isOnChainConfigured`

**Files:**
- Create: `src/lib/stellar/config.ts`
- Test: `src/lib/stellar/config.test.ts`

**Interfaces:**
- Produces:
  - `interface StellarConfig { contractId: string; rpcUrl: string; networkPassphrase: string }`
  - `getStellarConfig(): StellarConfig`
  - `isOnChainConfigured(): boolean` (true iff `contractId` and `rpcUrl` are non-empty)

- [ ] **Step 1: Write the failing test**

`src/lib/stellar/config.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { getStellarConfig, isOnChainConfigured } from "./config";

const KEYS = [
  "NEXT_PUBLIC_FACEVALUE_CONTRACT_ID",
  "NEXT_PUBLIC_SOROBAN_RPC_URL",
  "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("stellar config", () => {
  it("is not configured when contract id is absent", () => {
    expect(isOnChainConfigured()).toBe(false);
  });

  it("is configured when contract id + rpc are present", () => {
    process.env.NEXT_PUBLIC_FACEVALUE_CONTRACT_ID = "CABC123";
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    expect(isOnChainConfigured()).toBe(true);
    expect(getStellarConfig().contractId).toBe("CABC123");
  });

  it("defaults rpc + passphrase to testnet", () => {
    const c = getStellarConfig();
    expect(c.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(c.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement `src/lib/stellar/config.ts`**

```ts
// Reads NEXT_PUBLIC_ env (inlined by Next at build for the client). Pure — no SDK
// import — so it's cheap to import anywhere, including server components.

export interface StellarConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

const DEFAULT_RPC = "https://soroban-testnet.stellar.org";
const DEFAULT_PASSPHRASE = "Test SDF Network ; September 2015";

export function getStellarConfig(): StellarConfig {
  return {
    contractId: process.env.NEXT_PUBLIC_FACEVALUE_CONTRACT_ID ?? "",
    rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || DEFAULT_RPC,
    networkPassphrase:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || DEFAULT_PASSPHRASE,
  };
}

export function isOnChainConfigured(): boolean {
  const c = getStellarConfig();
  return c.contractId.trim().length > 0 && c.rpcUrl.trim().length > 0;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm test`
Expected: PASS — 3 config tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stellar/config.ts src/lib/stellar/config.test.ts
git commit -m "feat: stellar config + isOnChainConfigured"
```

---

### Task 4: Wallet provider (Stellar Wallets Kit)

**Files:**
- Create: `src/lib/stellar/wallet.tsx`
- Read first: `node_modules/next/dist/docs/` (client components), `node_modules/@creit.tech/stellar-wallets-kit/build/index.d.ts` (confirm the installed API)

**Interfaces:**
- Consumes: `getStellarConfig` from `@/lib/stellar/config`.
- Produces:
  - `WalletProvider({ children }): JSX.Element`
  - `useWallet(): { address: string | null; connecting: boolean; error: string | null; connect(): Promise<void>; disconnect(): void; signTransaction(xdr: string): Promise<string> }` (`signTransaction` returns the signed XDR string).

- [ ] **Step 1: Confirm the installed Wallets Kit API**

Run: `sed -n '1,80p' node_modules/@creit.tech/stellar-wallets-kit/build/index.d.ts`
Expected: confirm names used below exist — `StellarWalletsKit`, `WalletNetwork`, `allowAllModules`, `FREIGHTER_ID`, `ISupportedWallet`, and method shapes `openModal({ onWalletSelected })`, `setWallet(id)`, `getAddress(): Promise<{ address }>`, `signTransaction(xdr, { address, networkPassphrase }): Promise<{ signedTxXdr }>`. If any differ, adapt the code in Step 2 to the installed signatures.

- [ ] **Step 2: Implement `src/lib/stellar/wallet.tsx`**

```tsx
"use client";

import * as React from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
  type ISupportedWallet,
} from "@creit.tech/stellar-wallets-kit";
import { getStellarConfig } from "@/lib/stellar/config";

interface WalletCtx {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const Ctx = React.createContext<WalletCtx | null>(null);
const LS_KEY = "fv:walletId";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { networkPassphrase } = getStellarConfig();
  const [address, setAddress] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const kitRef = React.useRef<StellarWalletsKit | null>(null);

  // Client-only: the kit touches window. Instantiate lazily after mount.
  const getKit = React.useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!kitRef.current) {
      kitRef.current = new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        selectedWalletId: window.localStorage.getItem(LS_KEY) ?? FREIGHTER_ID,
        modules: allowAllModules(),
      });
    }
    return kitRef.current;
  }, []);

  const connect = React.useCallback(async () => {
    const kit = getKit();
    if (!kit) return;
    setConnecting(true);
    setError(null);
    try {
      await kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);
          window.localStorage.setItem(LS_KEY, option.id);
          const { address } = await kit.getAddress();
          setAddress(address);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "wallet connection failed");
    } finally {
      setConnecting(false);
    }
  }, [getKit]);

  const disconnect = React.useCallback(() => {
    setAddress(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(LS_KEY);
  }, []);

  const signTransaction = React.useCallback(
    async (xdr: string): Promise<string> => {
      const kit = getKit();
      if (!kit || !address) throw new Error("wallet not connected");
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        address,
        networkPassphrase,
      });
      return signedTxXdr;
    },
    [getKit, address, networkPassphrase],
  );

  const value: WalletCtx = {
    address,
    connecting,
    error,
    connect,
    disconnect,
    signTransaction,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}
```

- [ ] **Step 3: Verify it typechecks / builds**

Run: `npm run build`
Expected: `✓ Compiled successfully`. If Turbopack errors on bundling the kit, consult `node_modules/next/dist/docs/` for client-bundling guidance and adjust (e.g. dynamic import of the kit inside `getKit`). Re-run until green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stellar/wallet.tsx
git commit -m "feat: wallet provider via stellar-wallets-kit (client-only)"
```

---

### Task 5: Soroban submit client (`verify_resale`)

**Files:**
- Create: `src/lib/stellar/submit.ts`
- Test: `src/lib/stellar/submit.test.ts` (pure error-mapping only)
- Read first: `node_modules/@stellar/stellar-sdk/types/index.d.ts` (confirm `rpc` namespace + method names)

**Interfaces:**
- Consumes: `getStellarConfig` (`@/lib/stellar/config`); `serializeProof`, `serializePublicSignals` (`@/lib/zk/groth16-serialize`); a `signTransaction(xdr) => Promise<string>` (from `useWallet`).
- Produces:
  - `type SubmitStatus = "success" | "reverted" | "error"`
  - `interface SubmitResult { status: SubmitStatus; hash?: string; contractError?: number; message: string }`
  - `mapContractError(code: number): string`
  - `submitVerifyResale(args: { address: string; signTransaction: (xdr: string) => Promise<string>; eventId: string; proof: import("@/lib/zk/groth16-serialize").SnarkProof; publicSignals: string[] }): Promise<SubmitResult>`

- [ ] **Step 1: Write the failing test (error mapping)**

`src/lib/stellar/submit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapContractError } from "./submit";

describe("mapContractError", () => {
  it("maps the nullifier-replay code to an 'already resold' message", () => {
    expect(mapContractError(8)).toMatch(/sudah dijual ulang|already resold/i);
  });
  it("maps proof-invalid", () => {
    expect(mapContractError(9)).toMatch(/proof/i);
  });
  it("falls back for unknown codes", () => {
    expect(mapContractError(999)).toMatch(/999/);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './submit'`.

- [ ] **Step 3: Confirm the installed stellar-sdk API**

Run: `node -e "const s=require('@stellar/stellar-sdk'); console.log(typeof s.rpc, typeof s.TransactionBuilder, typeof s.Contract, typeof s.nativeToScVal, typeof s.BASE_FEE)"`
Expected: prints object/function for each. If the RPC server lives under `SorobanRpc` instead of `rpc` in the installed version, use that name in Step 4.

- [ ] **Step 4: Implement `src/lib/stellar/submit.ts`**

```ts
import {
  TransactionBuilder,
  Contract,
  nativeToScVal,
  BASE_FEE,
  rpc,
} from "@stellar/stellar-sdk";
import { getStellarConfig } from "@/lib/stellar/config";
import {
  serializeProof,
  serializePublicSignals,
  type SnarkProof,
} from "@/lib/zk/groth16-serialize";

export type SubmitStatus = "success" | "reverted" | "error";
export interface SubmitResult {
  status: SubmitStatus;
  hash?: string;
  contractError?: number;
  message: string;
}

const ERRORS: Record<number, string> = {
  5: "Event belum terdaftar di kontrak.",
  6: "Cap on-chain tidak cocok dengan proof (registrasi event salah).",
  7: "Merkle root on-chain tidak cocok dengan proof.",
  8: "Tiket sudah dijual ulang on-chain — ditolak (nullifier sudah dibakar).",
  9: "Proof ditolak kontrak (pairing check gagal).",
};

export function mapContractError(code: number): string {
  return ERRORS[code] ?? `Kontrak menolak transaksi (error #${code}).`;
}

/** Extract a contract error code from a host error string like `Error(Contract, #8)`. */
function extractContractError(text: string): number | undefined {
  const m = text.match(/#(\d+)/);
  return m ? Number(m[1]) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function submitVerifyResale(args: {
  address: string;
  signTransaction: (xdr: string) => Promise<string>;
  eventId: string;
  proof: SnarkProof;
  publicSignals: string[];
}): Promise<SubmitResult> {
  const { contractId, rpcUrl, networkPassphrase } = getStellarConfig();
  if (!contractId) return { status: "error", message: "CONTRACT_ID belum diset." };

  try {
    const server = new rpc.Server(rpcUrl);
    const account = await server.getAccount(args.address);

    const proofBytes = serializeProof(args.proof);
    const signalsBytes = serializePublicSignals(args.publicSignals);

    const op = new Contract(contractId).call(
      "verify_resale",
      nativeToScVal(args.eventId, { type: "string" }),
      nativeToScVal(Buffer.from(proofBytes), { type: "bytes" }),
      nativeToScVal(Buffer.from(signalsBytes), { type: "bytes" }),
    );

    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // Simulate first — a contract revert surfaces here, before we ask to sign.
    const sim = await server.simulateTransaction(built);
    if (rpc.Api.isSimulationError(sim)) {
      const code = extractContractError(sim.error);
      return code !== undefined
        ? { status: "reverted", contractError: code, message: mapContractError(code) }
        : { status: "error", message: sim.error };
    }

    const prepared = rpc.assembleTransaction(built, sim).build();
    const signedXdr = await args.signTransaction(prepared.toXDR());
    const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

    const sent = await server.sendTransaction(signed);
    if (sent.status === "ERROR") {
      const code = extractContractError(JSON.stringify(sent.errorResult ?? sent));
      return code !== undefined
        ? { status: "reverted", contractError: code, message: mapContractError(code) }
        : { status: "error", message: "submit ditolak oleh RPC." };
    }

    // Poll for finality.
    let res = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) {
      await sleep(1000);
      res = await server.getTransaction(sent.hash);
    }

    if (res.status === "SUCCESS") {
      return { status: "success", hash: sent.hash, message: "Verified on-chain — nullifier burned." };
    }
    const code = extractContractError(JSON.stringify(res));
    return code !== undefined
      ? { status: "reverted", hash: sent.hash, contractError: code, message: mapContractError(code) }
      : { status: "error", hash: sent.hash, message: `Transaksi gagal (${res.status}).` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "submit gagal" };
  }
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `npm test`
Expected: PASS — `mapContractError` tests green.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: `✓ Compiled successfully` (stellar-sdk bundles for the client). If a method name (`assembleTransaction`, `Api.isSimulationError`) differs in the installed version, adjust per the `.d.ts` from Step 3 and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/lib/stellar/submit.ts src/lib/stellar/submit.test.ts
git commit -m "feat: soroban verify_resale submit client + error mapping"
```

---

### Task 6: Connect-wallet button + provider wiring

**Files:**
- Create: `src/components/connect-wallet.tsx`
- Modify: `src/app/layout.tsx` (wrap children in `WalletProvider`)
- Modify: `src/components/top-nav.tsx` (render `<ConnectWallet />`)

**Interfaces:**
- Consumes: `useWallet`, `WalletProvider` (`@/lib/stellar/wallet`); `isOnChainConfigured` (`@/lib/stellar/config`).
- Produces: `ConnectWallet(): JSX.Element` (renders nothing when `!isOnChainConfigured()`).

- [ ] **Step 1: Implement `src/components/connect-wallet.tsx`**

```tsx
"use client";

import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/lib/stellar/wallet";
import { isOnChainConfigured } from "@/lib/stellar/config";
import { cn } from "@/lib/utils";

function trunc(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function ConnectWallet({ className }: { className?: string }) {
  const { address, connect, disconnect, connecting } = useWallet();
  if (!isOnChainConfigured()) return null;

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={address}
        className={cn(
          "inline-flex min-h-[40px] items-center gap-2 rounded-[5px] edge-ink bg-paper-elevated px-3 font-mono text-[12px] text-ink transition-colors hover:bg-paper",
          className,
        )}
      >
        <span className="num">{trunc(address)}</span>
        <LogOut className="h-3.5 w-3.5 text-private" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      className={cn(
        "inline-flex min-h-[40px] items-center gap-2 rounded-[5px] bg-ink px-3 font-mono text-[12px] uppercase tracking-[0.08em] text-paper transition-colors hover:bg-ink-soft disabled:opacity-50",
        className,
      )}
    >
      <Wallet className="h-3.5 w-3.5" />
      {connecting ? "Connecting…" : "Connect"}
    </button>
  );
}
```

- [ ] **Step 2: Wrap the app in `WalletProvider`** — modify `src/app/layout.tsx`

Add import `import { WalletProvider } from "@/lib/stellar/wallet";` and wrap the body content:
```tsx
      <body className="min-h-dvh">
        <WalletProvider>
          <TopNav />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
            {/* …unchanged footer… */}
          </footer>
        </WalletProvider>
      </body>
```

- [ ] **Step 3: Render `<ConnectWallet />` in the nav** — modify `src/components/top-nav.tsx`

Add `import { ConnectWallet } from "@/components/connect-wallet";`. Place it on the right of the desktop nav and inside the header on mobile. In the top bar `div` (the `flex … justify-between` row), wrap the right side so the connect button sits before the hamburger on mobile and after the desktop nav:
```tsx
        <div className="flex items-center gap-2">
          <nav className="hidden items-center gap-1 md:flex">{/* …existing links… */}</nav>
          <ConnectWallet />
          {/* existing mobile hamburger button stays here */}
        </div>
```
(Restructure the existing right-hand `<nav>` + hamburger into this wrapper; keep the hamburger's `md:hidden` and the desktop nav's `hidden md:flex`.)

- [ ] **Step 4: Verify the build + routes**

Run: `npm run build`
Expected: `✓ Compiled successfully`, all routes generated.

Run:
```bash
(npm run dev >/tmp/dev.log 2>&1 &) ; sleep 7 ; for p in / /wallet /resale /door /audit ; do curl -s -o /dev/null -w "$p -> %{http_code}\n" http://localhost:3000$p ; done ; pkill -f "next dev"
```
Expected: each route `-> 200`. (With `CONTRACT_ID` unset, `ConnectWallet` renders nothing — no visual change, no errors.)

- [ ] **Step 5: Commit**

```bash
git add src/components/connect-wallet.tsx src/app/layout.tsx src/components/top-nav.tsx
git commit -m "feat: connect-wallet button + WalletProvider wiring"
```

---

### Task 7: Resale page — real on-chain submission step

**Files:**
- Modify: `src/app/resale/page.tsx`

**Interfaces:**
- Consumes: `useWallet` (`@/lib/stellar/wallet`); `isOnChainConfigured` (`@/lib/stellar/config`); `submitVerifyResale` (`@/lib/stellar/submit`).
- The demo resale `eventId` is `ticket.eventId` (= `evt-aurora`).

- [ ] **Step 1: Capture the proof object and add on-chain state**

In `ResalePage`, the existing `proveResale` outcome already exposes `outcome.proof` and `outcome.publicSignals` on success (see `ProveOutcome`). Store the proof alongside the public signals, and add on-chain status state:
```tsx
const { address, signTransaction } = useWallet();
const [onchain, setOnchain] = React.useState<
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; result: import("@/lib/stellar/submit").SubmitResult }
>({ phase: "idle" });
const proofRef = React.useRef<import("@/lib/zk/groth16-serialize").SnarkProof | null>(null);
```
In the `outcome.ok` branch of `submit`, before `setPhase("accepted")`, add `proofRef.current = outcome.proof as never;`.

- [ ] **Step 2: Add the on-chain submit action**

```tsx
const submitOnChain = React.useCallback(async () => {
  if (!address || !publicSignals || !proofRef.current) return;
  setOnchain({ phase: "submitting" });
  const result = await submitVerifyResale({
    address,
    signTransaction,
    eventId: ticket.eventId,
    proof: proofRef.current,
    publicSignals,
  });
  setOnchain({ phase: "done", result });
  if (result.status === "success" && result.hash) setTxHash(result.hash);
}, [address, publicSignals, signTransaction, ticket.eventId]);
```

- [ ] **Step 3: Render the on-chain CTA in the accepted panel**

Inside the `phase === "accepted"` block, after `<TxStamp .../>`, add (only meaningful when configured + connected; otherwise the existing derived-hash verdict stands):
```tsx
{isOnChainConfigured() && (
  <div className="rounded-[5px] edge-ink bg-paper-elevated p-4 text-[13px]">
    {!address ? (
      <p className="text-ink-soft">Connect wallet untuk submit proof ini ke Soroban testnet.</p>
    ) : onchain.phase === "idle" ? (
      <Button onClick={submitOnChain} className="w-full">
        <Wand2 className="h-4 w-4" /> Submit on-chain (wallet signs)
      </Button>
    ) : onchain.phase === "submitting" ? (
      <p className="flex items-center gap-2 text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> Submitting to Soroban — sign in your wallet…
      </p>
    ) : (
      <p className={onchain.result.status === "success" ? "text-accept" : "text-reject"}>
        {onchain.result.message}
        {onchain.result.hash ? ` · ${onchain.result.hash.slice(0, 10)}…` : ""}
      </p>
    )}
  </div>
)}
```
Add the imports at the top: `useWallet`, `isOnChainConfigured`, `submitVerifyResale`. Reset `onchain` to `{ phase: "idle" }` inside the existing `reset()`.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: `✓ Compiled successfully`. The resale route still prerenders/renders; with `CONTRACT_ID` unset the new block is hidden (`isOnChainConfigured()` is false).

- [ ] **Step 5: Commit**

```bash
git add src/app/resale/page.tsx
git commit -m "feat: real on-chain verify_resale submission on the resale page"
```

---

### Task 8: Deploy script + shared bytes module

**Files:**
- Create: `scripts/zk/groth16-bytes.mjs` (extracted shared helpers)
- Create: `scripts/soroban/deploy.mjs`
- Modify: `scripts/zk/make-contract-fixture.mjs` (import the shared helpers instead of its inline copies)

**Interfaces:**
- `scripts/zk/groth16-bytes.mjs` exports: `fpToBe32(decimal)`, `g1ToBytes(g)`, `g2ToBytes(g)`, `u32Be(n)`, `serializeVerificationKey(vk)`, `toHex(bytes)`.

- [ ] **Step 1: Create `scripts/zk/groth16-bytes.mjs`** (Node mirror of the TS serializer)

```js
// Shared snarkjs→BN254 byte helpers for Node scripts. Mirrors
// src/lib/zk/groth16-serialize.ts; both are pinned to the same contract golden
// vectors (the contract fixture was generated by this exact logic).

export function fpToBe32(decimal) {
  let v = BigInt(decimal);
  if (v < 0n) throw new Error(`negative field element: ${decimal}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new Error(`field element too large: ${decimal}`);
  return out;
}
function concat(...a) {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out;
}
export function u32Be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
export function g1ToBytes([x, y]) { return concat(fpToBe32(x), fpToBe32(y)); }
export function g2ToBytes([[x0, x1], [y0, y1]]) {
  return concat(fpToBe32(x1), fpToBe32(x0), fpToBe32(y1), fpToBe32(y0));
}
export function serializeVerificationKey(vk) {
  return concat(
    g1ToBytes(vk.vk_alpha_1), g2ToBytes(vk.vk_beta_2), g2ToBytes(vk.vk_gamma_2),
    g2ToBytes(vk.vk_delta_2), u32Be(vk.IC.length), ...vk.IC.map(g1ToBytes),
  );
}
export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 2: Refactor `make-contract-fixture.mjs` to import shared helpers**

Replace its inline `fpToBe32`/`concatBytes`/`g1ToBytes`/`g2ToBytes` definitions with:
```js
import { fpToBe32, g1ToBytes, g2ToBytes, u32Be, serializeVerificationKey } from "./groth16-bytes.mjs";
```
and use `serializeVerificationKey(vk)` for the VK and `u32Be(n)` for the length prefixes (drop the local `icLenBytes`/`nBytes` constructions). Keep `rustBytes` local.

- [ ] **Step 3: Confirm the fixture output is unchanged** (only if zk artifacts are built)

Run: `npm run zk:build && node scripts/zk/make-contract-fixture.mjs 2>/dev/null | grep -c "0x"`
Expected: non-zero hex lines printed and `[ok] snarkjs verified …` on stderr (proves the refactor didn't change behavior). If `zk:build` artifacts are unavailable in the env, skip this step and rely on Task 2's golden-vector test (same logic).

- [ ] **Step 4: Create `scripts/soroban/deploy.mjs`**

```js
// Deploy FaceValue to Soroban testnet: build → deploy → init(admin, vk_bytes) →
// register_event ×3 (cap + merkle_root from src/lib/zk/fixtures.json so the
// on-chain EventConfig matches the proof's public signals). Requires the
// `stellar` CLI on PATH and a configured identity (STELLAR_IDENTITY, default "default").
//
// Usage:  node scripts/soroban/deploy.mjs
// Then paste the printed NEXT_PUBLIC_FACEVALUE_CONTRACT_ID into .env.local.

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
```
> Note: confirm the installed `stellar` CLI's flag names (`contract deploy … -- --admin … --vk_bytes …` constructor-arg passing, `keys address`) against `stellar contract deploy --help`; adjust if the CLI version differs.

- [ ] **Step 5: Syntax-check both scripts**

Run: `node --check scripts/zk/groth16-bytes.mjs && node --check scripts/soroban/deploy.mjs && node --check scripts/zk/make-contract-fixture.mjs`
Expected: no output (all parse). Actual deploy is deferred until the `stellar` CLI is available.

- [ ] **Step 6: Commit**

```bash
git add scripts/zk/groth16-bytes.mjs scripts/soroban/deploy.mjs scripts/zk/make-contract-fixture.mjs
git commit -m "feat: soroban deploy script + shared bytes module (DRY with fixture gen)"
```

---

### Task 9: Docs — README deploy section + REAL/MOCK update

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Connect a wallet & submit on-chain" section to `README.md`**

Document: install is already in `package.json`; copy `.env.example` → `.env.local`; run `node scripts/soroban/deploy.mjs` (needs `stellar` CLI + funded testnet identity) to get `CONTRACT_ID`; paste it into `.env.local`; `npm run dev`; on `/resale`, Connect wallet → accepted resale → "Submit on-chain (wallet signs)" → real tx hash. Note the second submit of the same demo ticket reverts with `NullifierAlreadyUsed` (intentional anti-double-sell).

- [ ] **Step 2: Update the REAL vs MOCK table**

Change the "On-chain testnet deployment" row to: 🟡→✅ *once deployed* — "wallet-signed `verify_resale` submitted to testnet; gracefully simulated when `CONTRACT_ID` unset." Keep the honesty caveat that it is live only after deploy.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: wallet connect + on-chain deploy/run instructions"
```

---

## Self-Review

**1. Spec coverage**
- D2 Wallets Kit → Task 4. D5 client-side serializer → Task 2. D4 verify_resale-only scope → Tasks 5/7 (no payment path added). D3 graceful fallback → `isOnChainConfigured` gates in Tasks 6/7; build/route checks confirm no-config path. D1 deploy-later → Task 8 script, unexecuted.
- Spec §5 components: config (T3), wallet (T4), serializer (T2), submit (T5), connect button (T6), deploy script (T8), `.env.example` (T1) — all present. §5.8 edits (layout/top-nav/resale/README) → T6/T7/T9. §6 error codes → `mapContractError` (T5). §9 env → T1/T3. §10 testing: golden-vector serializer test (T2), build/typecheck (T1/T4/T5/T6/T7), manual testnet smoke (deferred, README T9).
- Gap check: the spec's `serializeVerificationKey` is exported in T2's module and reused by T8's Node mirror — covered. No uncovered spec requirement found.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. Every code step shows complete code; every run step shows the command + expected output. The two "confirm installed API" steps (T4.1, T5.3) are verification actions with concrete commands, not placeholders.

**3. Type consistency:** `serializeProof/serializePublicSignals/serializeVerificationKey` signatures identical in T2 (definition), T5 (consumer), T8 (Node mirror). `SubmitResult`/`mapContractError` identical in T5 (def) and T7 (consumer). `useWallet()` shape defined in T4 and consumed unchanged in T6/T7 (`address`, `signTransaction`, `connect`, `disconnect`, `connecting`). `getStellarConfig`/`isOnChainConfigured` defined T3, consumed T4/T5/T6/T7. Consistent.

---

## Execution note (environment)

Tasks that touch the network/toolchain are gated on this environment:
- `npm install` / `npm run build` / `npm test` need the Bash classifier available (it was intermittently overloaded this session).
- Task 8's actual deploy needs the `stellar` CLI (absent here) — the script is written and syntax-checked, executed later.

The serializer correctness (the one piece that must be exact) is fully verified offline by Task 2 against the committed contract golden vectors — no testnet required.
