"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ScanLine, CheckCircle2, XCircle, DoorOpen } from "lucide-react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { HashMono } from "@/components/ui/hash-mono";
import { TICKETS, eventById } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type Phase = "idle" | "scanning" | "done";

export default function DoorPage() {
  const scannable = TICKETS.filter((t) => t.status !== "listed");
  const [pick, setPick] = React.useState(scannable[0].id);
  const [phase, setPhase] = React.useState<Phase>("idle");

  const ticket = scannable.find((t) => t.id === pick)!;
  const event = eventById(ticket.eventId);
  const valid = ticket.status === "active";

  const scan = () => {
    setPhase("scanning");
    setTimeout(() => setPhase("done"), 1100);
  };
  const pickTicket = (id: string) => {
    setPick(id);
    setPhase("idle");
  };

  return (
    <div className="space-y-8">
      <header className="rule-ink pb-3">
        <h1 className="font-display text-3xl tracking-tight text-ink">Gate scan</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          A nullified (resold) ticket is dead the moment its replacement is issued —
          the old QR can never admit twice.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        {/* QR + picker */}
        <div className="space-y-4 rounded-[6px] edge-ink bg-paper-elevated p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
            Present a ticket
          </p>
          <div className="flex justify-center py-2">
            <div className={cn("rounded-[6px] bg-white p-3", !valid && "opacity-40 grayscale")}>
              <QRCode value={ticket.qrSeed} size={150} fgColor="#1a1714" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {scannable.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTicket(t.id)}
                className={cn(
                  "flex items-center justify-between rounded-[5px] border px-3 py-2 text-left font-mono text-[12px] transition-colors",
                  t.id === pick
                    ? "border-ink bg-ink text-paper"
                    : "border-ink/15 bg-paper text-ink-soft hover:bg-ink/5"
                )}
              >
                <span className="num">{t.serial}</span>
                <span className="text-[10px] uppercase tracking-[0.1em]">
                  {t.status === "active" ? "valid" : "nullified"}
                </span>
              </button>
            ))}
          </div>
          <Button onClick={scan} disabled={phase === "scanning"} className="w-full">
            <ScanLine className="h-4 w-4" />
            {phase === "scanning" ? "Scanning…" : "Scan at the gate"}
          </Button>
        </div>

        {/* verdict */}
        <div className="grid min-h-[280px] place-items-center rounded-[6px] edge-ink bg-paper p-6">
          <AnimatePresence mode="wait">
            {phase === "idle" && (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center font-mono text-[12px] uppercase tracking-[0.12em] text-private"
              >
                Awaiting scan…
              </motion.p>
            )}
            {phase === "scanning" && (
              <motion.div
                key="scan"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 text-private"
              >
                <ScanLine className="h-8 w-8 animate-pulse" />
                <span className="font-mono text-[12px] uppercase tracking-[0.12em]">
                  Checking nullifier set on-chain…
                </span>
              </motion.div>
            )}
            {phase === "done" && (
              <motion.div
                key="done"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 20 }}
                className={cn(
                  "w-full max-w-sm rounded-[6px] p-6 stamp-ink",
                  valid ? "bg-accept-bg text-accept" : "bg-reject-bg text-reject"
                )}
              >
                <div className="flex items-center gap-3">
                  {valid ? (
                    <CheckCircle2 className="h-8 w-8" strokeWidth={2.2} />
                  ) : (
                    <XCircle className="h-8 w-8" strokeWidth={2.2} />
                  )}
                  <div>
                    <p className="flex items-center gap-2 font-display text-xl uppercase tracking-[0.08em]">
                      {valid ? (
                        <>
                          Admit <DoorOpen className="h-5 w-5" />
                        </>
                      ) : (
                        "Refused"
                      )}
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.1em] opacity-80">
                      {valid ? "Ticket live & unique" : "Nullified — already resold"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-1 border-t border-current/20 pt-3 font-mono text-[12px] text-ink">
                  <div className="flex justify-between">
                    <span className="text-private">event</span>
                    <span>{event.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-private">serial</span>
                    <span className="num">{ticket.serial}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-private">commitment</span>
                    <HashMono value={ticket.commitment} copyable={false} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
