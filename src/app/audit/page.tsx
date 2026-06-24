"use client";

import * as React from "react";
import { motion } from "motion/react";
import { KeyRound, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RedactionField } from "@/components/ui/redaction-field";
import { HashMono } from "@/components/ui/hash-mono";
import { AUDIT_RECORDS, eventById, fmtUSD } from "@/lib/mock-data";

export default function AuditPage() {
  const rec = AUDIT_RECORDS[0];
  const event = eventById("evt-aurora");
  const [key, setKey] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [error, setError] = React.useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim() === rec.viewKey) {
      setRevealed(true);
      setError(false);
    } else {
      setError(true);
      setRevealed(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="rule-ink pb-3">
        <Badge tone="ink">Regulator console</Badge>
        <h1 className="mt-3 font-display text-3xl tracking-tight text-ink">
          Compliance exhibit
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] text-ink-soft">
          The public ledger reveals nothing. A scoped <em>view key</em> — held by
          an authorised auditor — reconstructs a single transaction&apos;s detail.
          Privacy by default; disclosure on warrant.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
        {/* exhibit document */}
        <div className="rounded-[6px] edge-ink bg-paper-elevated p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/15 pb-4">
            <div>
              <p className="font-display text-xl tracking-tight text-ink">
                Exhibit A — Selective Disclosure
              </p>
              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-private">
                {event.name} · resale settlement
              </p>
            </div>
            {revealed ? (
              <Badge tone="accept">
                <ShieldCheck className="h-3 w-3" /> Unsealed
              </Badge>
            ) : (
              <Badge tone="private">
                <ShieldAlert className="h-3 w-3" /> Sealed
              </Badge>
            )}
          </div>

          <motion.dl
            key={revealed ? "open" : "closed"}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-x-8 gap-y-5 py-6 sm:grid-cols-2"
          >
            <RedactionField label="Buyer" value={rec.buyerAddress} revealed={revealed} />
            <RedactionField label="Seller" value={rec.sellerAddress} revealed={revealed} />
            <RedactionField
              label="Exact price paid"
              value={`${fmtUSD(rec.exactPriceCents)}  ·  ≤ cap ${fmtUSD(event.faceValueCapCents)}`}
              revealed={revealed}
            />
            <RedactionField label="Ticket" value={rec.ticketId} revealed={revealed} />
          </motion.dl>

          <div className="space-y-2 border-t border-ink/15 pt-4 font-mono text-[12px]">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-[0.1em] text-private">settlement tx</span>
              <HashMono value={rec.txHash} />
            </div>
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-[0.1em] text-private">merkle_root</span>
              <HashMono value={rec.merkleRoot} copyable={false} />
            </div>
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-[0.1em] text-private">nullifier</span>
              <HashMono value={rec.nullifier} copyable={false} />
            </div>
          </div>
        </div>

        {/* view-key form */}
        <form onSubmit={submit} className="h-fit space-y-4 rounded-[6px] edge-ink bg-paper p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
            Present view key
          </p>
          <div className="flex items-center gap-2 rounded-[5px] edge-ink bg-paper-elevated px-3">
            <KeyRound className="h-4 w-4 text-private" />
            <input
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(false);
              }}
              placeholder="vk_…"
              className="min-h-[44px] flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-private/60"
            />
          </div>
          <Button type="submit" className="w-full">
            Reconstruct detail
          </Button>
          {error && (
            <p className="font-mono text-[11px] text-reject">
              Invalid view key — disclosure denied.
            </p>
          )}
          <p className="rounded-[5px] bg-ink/[0.04] p-3 font-mono text-[11px] leading-relaxed text-private">
            Demo key:{" "}
            <button
              type="button"
              onClick={() => setKey(rec.viewKey)}
              className="text-cap-line underline underline-offset-2"
            >
              {rec.viewKey}
            </button>
            <br />
            The key proves authority for <em>this record only</em> — it cannot
            unseal any other transaction.
          </p>
        </form>
      </div>
    </div>
  );
}
