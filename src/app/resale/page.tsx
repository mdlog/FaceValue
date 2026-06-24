"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "react-qr-code";
import { Loader2, ShieldCheck, Wand2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CapMeter } from "@/components/ui/cap-meter";
import { TxStamp } from "@/components/ui/tx-stamp";
import { HashMono } from "@/components/ui/hash-mono";
import { PerforatedStub } from "@/components/ui/perforated-stub";
import { TICKETS, eventById, fmtUSD } from "@/lib/mock-data";
import { proveResale, buildResaleInput } from "@/lib/zk/prover";
import fixtures from "@/lib/zk/fixtures.json";
import { useWallet } from "@/lib/stellar/wallet";
import { isOnChainConfigured } from "@/lib/stellar/config";
import { submitVerifyResale, type SubmitResult } from "@/lib/stellar/submit";
import type { Groth16Proof } from "@/lib/zk/types";
import type { SnarkProof } from "@/lib/zk/groth16-serialize";

type Phase = "compose" | "proving" | "accepted" | "rejected";
/** How the verdict was reached — real Groth16, or a graceful simulated fallback. */
type Mode = "real" | "simulated";

const PROOF_STEPS = [
  "Sealing private inputs (price, secret) into witness",
  "Generating Groth16 proof · snarkjs / wasm",
  "Verifying proof against verification key · mirrors Soroban",
];

// Fallback hashes used only when artifacts are absent (simulated path).
const ACCEPT_HASH = "0x4417bb20e9f1c0aa7d2e88be1c4a90cd44e7b215c0d9f8e3";
const REJECT_HASH = "0xc0d9f8e3a26b7140a71f4c9e2b8d6011f3aa90cd44e7b215";

/** Turn a decimal-string field element (the nullifier) into a 0x tx-like hash. */
function nullifierToHash(dec: string): string {
  try {
    const hex = BigInt(dec).toString(16).padStart(48, "0");
    return `0x${hex.slice(0, 48)}`;
  } catch {
    return ACCEPT_HASH;
  }
}

export default function ResalePage() {
  const ticket = TICKETS.find((t) => t.id === "tkt-AUR-0482")!;
  const event = eventById(ticket.eventId);
  const cap = event.faceValueCapCents;

  const { address, signTransaction } = useWallet();

  const [dollars, setDollars] = React.useState(115);
  const [phase, setPhase] = React.useState<Phase>("compose");
  const [step, setStep] = React.useState(0);

  // Real-proof state surfaced into the verdict panel.
  const [mode, setMode] = React.useState<Mode>("real");
  const [txHash, setTxHash] = React.useState<string>(ACCEPT_HASH);
  const [publicSignals, setPublicSignals] = React.useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = React.useState<string | null>(null);

  // On-chain submission state (additive — only shown when isOnChainConfigured()).
  const [onchain, setOnchain] = React.useState<
    | { phase: "idle" }
    | { phase: "submitting" }
    | { phase: "done"; result: SubmitResult }
  >({ phase: "idle" });
  const proofRef = React.useRef<Groth16Proof | null>(null);

  const priceCents = Math.round(dollars * 100);
  const over = priceCents > cap;

  // The real Merkle root for this event (from the built ZK fixtures), so the
  // pre-proof statement shows the same root that appears in the verified public signals.
  const realRoot =
    (fixtures.events as Record<string, { merkleRoot: string }>)[ticket.eventId]
      ?.merkleRoot ?? event.merkleRoot;

  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  React.useEffect(() => () => clearTimers(), [clearTimers]);

  const submit = React.useCallback(async () => {
    clearTimers();
    setPhase("proving");
    setStep(0);
    setPublicSignals(null);
    setRejectReason(null);

    // Advance the existing stepper while the real proof is generated. The
    // proof typically lands mid-stepper; we hold the final step until it
    // resolves so the UI never reports "done" before the contract check.
    timers.current.push(setTimeout(() => setStep(1), 420));
    timers.current.push(setTimeout(() => setStep(2), 900));

    // Kick off the REAL proof. buildResaleInput returns null if fixtures are
    // absent -> proveResale reports unavailable -> we simulate.
    const outcome = await proveResale(buildResaleInput(priceCents));

    // Ensure the stepper has visibly reached its final step before the verdict.
    setStep(PROOF_STEPS.length - 1);

    if (outcome.ok) {
      // REAL accept: derive the tx-like hash from the nullifier public signal.
      const ns = outcome.publicSignals;
      const nullifier = ns[2] ?? ns[ns.length - 1] ?? "";
      setMode("real");
      setTxHash(nullifierToHash(nullifier));
      setPublicSignals(ns);
      setRejectReason(null);
      proofRef.current = outcome.proof;
      setPhase("accepted");
      return;
    }

    if (outcome.overCap) {
      // REAL reject: the witness is unsatisfiable (price > cap).
      setMode("real");
      setTxHash(REJECT_HASH);
      setPublicSignals(null);
      setRejectReason(
        "the proof cannot be produced — resalePrice > cap is unsatisfiable",
      );
      setPhase("rejected");
      return;
    }

    // Artifacts/route unavailable -> GRACEFUL FALLBACK to the simulated verdict.
    setMode("simulated");
    setPublicSignals(null);
    if (over) {
      setTxHash(REJECT_HASH);
      setRejectReason(null);
      setPhase("rejected");
    } else {
      setTxHash(ACCEPT_HASH);
      setRejectReason(null);
      setPhase("accepted");
    }
  }, [clearTimers, priceCents, over]);

  const submitOnChain = React.useCallback(async () => {
    if (!address || !publicSignals || !proofRef.current) return;
    setOnchain({ phase: "submitting" });
    const result = await submitVerifyResale({
      address,
      signTransaction,
      eventId: ticket.eventId,
      // snarkjs Groth16Proof has the same runtime shape as SnarkProof (tuples); cast for the type boundary.
      proof: proofRef.current as unknown as SnarkProof,
      publicSignals,
    });
    setOnchain({ phase: "done", result });
    if (result.status === "success" && result.hash) setTxHash(result.hash);
  }, [address, publicSignals, signTransaction, ticket.eventId]);

  const reset = () => {
    clearTimers();
    setPhase("compose");
    setStep(0);
    setPublicSignals(null);
    setRejectReason(null);
    setOnchain({ phase: "idle" });
  };

  return (
    <div className="space-y-8">
      <header className="rule-ink pb-3">
        <Badge tone="brass">Live enforcement</Badge>
        <h1 className="mt-3 font-display text-3xl tracking-tight text-ink">
          Resell · {event.name}
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] text-ink-soft">
          Set your asking price. A zero-knowledge proof either clears the
          regulated cap and settles privately — or the contract refuses it
          on-chain. The cap, not a platform, decides.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        {/* ---- compose ---- */}
        <div className="space-y-5">
          <PerforatedStub ticket={ticket} event={event} />

          <div className="space-y-4 rounded-[6px] edge-ink bg-paper-elevated p-5">
            <div className="flex items-end justify-between">
              <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
                Your asking price
              </label>
              <div className="flex items-baseline font-display text-3xl text-ink">
                <span className="mr-0.5 text-xl text-private">$</span>
                <input
                  type="number"
                  min={1}
                  max={400}
                  value={dollars}
                  disabled={phase === "proving"}
                  onChange={(e) => {
                    setDollars(Number(e.target.value || 0));
                    if (phase !== "compose") setPhase("compose");
                  }}
                  className="w-28 bg-transparent text-right tabular-nums outline-none [appearance:textfield] focus:text-cap-line [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            <input
              type="range"
              min={20}
              max={300}
              value={dollars}
              disabled={phase === "proving"}
              onChange={(e) => {
                setDollars(Number(e.target.value));
                if (phase !== "compose") setPhase("compose");
              }}
              className="w-full accent-[#1a1714]"
            />

            <CapMeter capCents={cap} priceCents={priceCents} />

            <div className="flex gap-2">
              <Button
                variant="outline"
                tone="accept"
                className="flex-1"
                onClick={() => {
                  setDollars(115);
                  setPhase("compose");
                }}
              >
                Fair · $115
              </Button>
              <Button
                variant="outline"
                tone="reject"
                className="flex-1"
                onClick={() => {
                  setDollars(210);
                  setPhase("compose");
                }}
              >
                Scalper · $210
              </Button>
            </div>

            {phase === "compose" || phase === "proving" ? (
              <Button onClick={submit} disabled={phase === "proving"} className="w-full">
                {phase === "proving" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {phase === "proving" ? "Proving…" : "Generate proof & submit"}
              </Button>
            ) : (
              <Button variant="outline" onClick={reset} className="w-full">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            )}
          </div>
        </div>

        {/* ---- verdict ---- */}
        <div className="rounded-[6px] edge-ink bg-paper p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
              On-chain verdict
            </span>
            <Badge tone="ink">Soroban · testnet</Badge>
          </div>

          <AnimatePresence mode="wait">
            {/* statement to be proven */}
            {phase === "compose" && (
              <motion.div
                key="stmt"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  The proof will assert the following — revealing nothing else:
                </p>
                <pre className="overflow-x-auto rounded-[5px] bg-ink/[0.04] p-4 font-mono text-[12px] leading-relaxed text-ink">
{`assert  resale_price ≤ per_event_cap
assert  ticket ∈ merkle(issued_set)
emit    nullifier = Poseidon(ticket_secret)`}
                </pre>
                <dl className="space-y-2 border-t border-ink/10 pt-3 font-mono text-[12px]">
                  <Pub k="per_event_cap" v={fmtUSD(cap)} />
                  <div className="flex items-center justify-between">
                    <span className="uppercase tracking-[0.1em] text-private">merkle_root</span>
                    <HashMono value={realRoot} copyable={false} />
                  </div>
                  <Pub k="resale_price" v="PRIVATE" muted />
                  <Pub k="buyer / seller" v="PRIVATE" muted />
                </dl>
              </motion.div>
            )}

            {/* proving */}
            {phase === "proving" && (
              <motion.ol
                key="proving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {PROOF_STEPS.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 font-mono text-[12px]">
                    {i < step ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-accept" />
                    ) : i === step ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cap-line" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-ink/20" />
                    )}
                    <span className={i <= step ? "text-ink" : "text-private"}>{s}</span>
                  </li>
                ))}
              </motion.ol>
            )}

            {/* accepted */}
            {phase === "accepted" && (
              <motion.div
                key="ok"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                <TxStamp variant="accept" hash={txHash} capCents={cap} priceCents={priceCents} />
                {isOnChainConfigured() ? (
                  <div className="rounded-[5px] edge-ink bg-paper-elevated p-4 text-[13px]">
                    {!address ? (
                      <p className="text-ink-soft">Connect a wallet to submit this proof to Soroban testnet.</p>
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
                ) : address ? (
                  <div className="rounded-[5px] edge-ink bg-paper-elevated p-4 text-[13px] leading-relaxed text-ink-soft">
                    Wallet connected. Set{" "}
                    <span className="font-mono text-[12px] text-ink">NEXT_PUBLIC_FACEVALUE_CONTRACT_ID</span>{" "}
                    (deploy via <span className="font-mono text-[12px] text-ink">scripts/soroban/deploy.mjs</span>)
                    to enable on-chain submission. Until then this verdict is the simulated/derived one.
                  </div>
                ) : null}
                {mode === "simulated" && <SimNote />}
                {publicSignals && <PublicSignals signals={publicSignals} />}
                <div className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-[5px] edge-ink bg-paper-elevated p-4">
                  <div className="rounded-[4px] bg-white p-2">
                    <QRCode value={`${ticket.qrSeed}-R2`} size={72} fgColor="#1a1714" />
                  </div>
                  <div className="text-[13px]">
                    <p className="font-display text-base text-ink">Fresh ticket issued to buyer</p>
                    <p className="mt-0.5 text-ink-soft">
                      Old stub <span className="font-mono text-private line-through">{ticket.serial}</span>{" "}
                      nullified — it can never be admitted or resold again.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* rejected */}
            {phase === "rejected" && (
              <motion.div
                key="no"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                <TxStamp
                  variant="reject"
                  hash={txHash}
                  capCents={cap}
                  priceCents={priceCents}
                  reason={
                    rejectReason
                      ? `${rejectReason} — resale_price (${fmtUSD(priceCents)}) exceeds the public per-event cap (${fmtUSD(cap)}). No proof exists; nothing settled.`
                      : `resale_price (${fmtUSD(priceCents)}) exceeds the public per-event cap (${fmtUSD(cap)}). The contract reverted; no ownership changed and no funds moved.`
                  }
                />
                {mode === "simulated" && <SimNote />}
                <p className="rounded-[5px] bg-ink/[0.04] p-4 text-[13px] leading-relaxed text-ink-soft">
                  The scalper is stopped by mathematics, not policy. Lower the price
                  to <span className="font-medium text-accept">{fmtUSD(cap)}</span> or below and the
                  same contract will accept it.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Pub({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="uppercase tracking-[0.1em] text-private">{k}</span>
      <span className={muted ? "font-mono text-[11px] tracking-[0.1em] text-private" : "num text-ink"}>
        {v}
      </span>
    </div>
  );
}

/** Small disclosed-mock note shown only when artifacts were unavailable. */
function SimNote() {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-private">
      simulated · circuit artifacts not built (run npm run zk:build for a real proof)
    </p>
  );
}

/** The REAL public signals [per_event_cap, merkle_root, nullifier] from snarkjs. */
function PublicSignals({ signals }: { signals: string[] }) {
  const labels = ["per_event_cap", "merkle_root", "nullifier"];
  return (
    <div className="space-y-1.5 rounded-[5px] edge-ink bg-paper-elevated p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-private">
        public signals · verified Groth16
      </p>
      <dl className="space-y-1 border-t border-ink/10 pt-2 font-mono text-[11px]">
        {signals.map((sig, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="uppercase tracking-[0.1em] text-private">
              {labels[i] ?? `signal_${i}`}
            </span>
            <HashMono value={sig} copyable={false} />
          </div>
        ))}
      </dl>
    </div>
  );
}
