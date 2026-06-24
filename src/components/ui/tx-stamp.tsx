"use client";

import { motion } from "motion/react";
import { CheckCircle2, XCircle } from "lucide-react";
import { HashMono } from "@/components/ui/hash-mono";
import { fmtUSD } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/**
 * The centerpiece. An on-chain verdict "stamps" onto the document:
 * ACCEPT (green ring) or REJECT (red ring), always with the verifiable tx hash.
 * Restraint everywhere else; drama here, because this is the consequence.
 */
export function TxStamp({
  variant,
  hash,
  capCents,
  priceCents,
  reason,
}: {
  variant: "accept" | "reject";
  hash: string;
  capCents: number;
  priceCents: number;
  reason?: string;
}) {
  const accept = variant === "accept";
  const tone = accept ? "text-accept" : "text-reject";
  const bg = accept ? "bg-accept-bg" : "bg-reject-bg";

  return (
    <motion.div
      initial={{ scale: 1.6, opacity: 0, rotate: accept ? 4 : -10 }}
      animate={{ scale: 1, opacity: 1, rotate: accept ? -1.5 : -6 }}
      transition={{ type: "spring", stiffness: 520, damping: 18, mass: 0.7 }}
      className={cn(
        "relative w-full max-w-md rounded-[6px] p-6",
        bg,
        tone,
        "stamp-ink"
      )}
    >
      <div className="flex items-center gap-3">
        {accept ? (
          <CheckCircle2 className="h-7 w-7" strokeWidth={2.2} />
        ) : (
          <XCircle className="h-7 w-7" strokeWidth={2.2} />
        )}
        <div>
          <p className="font-display text-xl uppercase leading-none tracking-[0.1em]">
            {accept ? "Accepted" : "Denied"}
          </p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] opacity-80">
            {accept ? "At or below cap" : "Above cap"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-current/20 pt-3 font-mono text-[12px] num text-ink">
        <Row k="resale_price" v={fmtUSD(priceCents)} bad={!accept} />
        <Row k="per_event_cap" v={fmtUSD(capCents)} />
        {!accept && reason && (
          <p className="pt-1 text-[11px] leading-snug text-reject">{reason}</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-current/20 pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-private">
          {accept ? "settled · testnet" : "rejected · testnet"}
        </span>
        <HashMono value={hash} label="tx" />
      </div>
    </motion.div>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-private">{k}</span>
      <span className={cn("num", bad ? "text-reject" : "text-ink")}>{v}</span>
    </div>
  );
}
