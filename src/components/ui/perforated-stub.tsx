"use client";

import * as React from "react";
import QRCode from "react-qr-code";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { type Ticket, type EventInfo } from "@/lib/mock-data";

const INK = "#1a1714";

export function PerforatedStub({
  ticket,
  event,
  className,
  footer,
}: {
  ticket: Ticket;
  event: EventInfo;
  className?: string;
  footer?: React.ReactNode;
}) {
  const nullified = ticket.status === "nullified";

  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-[var(--radius-stub)] edge-ink bg-paper-elevated shadow-[0_1px_0_rgba(26,23,20,0.12),0_10px_24px_-18px_rgba(26,23,20,0.5)]",
        className
      )}
    >
      {/* ---- main body ---- */}
      <div className="flex flex-1 flex-col justify-between gap-5 p-4 sm:gap-6 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-private">
              {event.venue} · {event.city}
            </p>
            <h3 className="mt-1 font-display text-xl leading-none tracking-tight text-ink sm:text-2xl">
              {event.name}
            </h3>
            <p className="mt-1 text-[13px] text-ink-soft">{event.subtitle}</p>
          </div>
          {ticket.status === "active" && <Badge tone="accept">Valid</Badge>}
          {ticket.status === "listed" && <Badge tone="brass">Listed</Badge>}
          {nullified && <Badge tone="reject">Void</Badge>}
        </div>

        <div className="grid grid-cols-3 gap-3 font-mono text-[11px] uppercase tracking-[0.06em]">
          <StubField k="Section" v={ticket.section} />
          <StubField k="Row" v={ticket.row} />
          <StubField k="Seat" v={ticket.seat} />
        </div>

        {footer}
      </div>

      {/* ---- perforation ---- */}
      <div className="relative w-px self-stretch">
        <div className="perf-line absolute inset-y-3 left-0 w-px" />
        <span className="absolute -top-2 -left-2 h-4 w-4 rounded-full bg-paper" />
        <span className="absolute -bottom-2 -left-2 h-4 w-4 rounded-full bg-paper" />
      </div>

      {/* ---- stub ---- */}
      <div className="flex w-[128px] flex-col items-center justify-between gap-3 px-3 py-4 sm:w-[140px] sm:p-5">
        <div className={cn("rounded-[4px] bg-white p-1.5", nullified && "opacity-40 grayscale")}>
          <QRCode value={ticket.qrSeed} size={88} bgColor="#ffffff" fgColor={INK} level="M" />
        </div>
        <div className="text-center">
          <p className="font-mono text-[10px] tracking-[0.1em] text-ink num">{ticket.serial}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-private">
            Paid
          </p>
          <p className="font-mono text-[12px] tracking-[0.3em] text-private">••••</p>
        </div>
      </div>

      {/* ---- VOID overlay ---- */}
      {nullified && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `repeating-linear-gradient(135deg, ${INK} 0 1px, transparent 1px 9px)`,
            }}
          />
          <span className="-rotate-[8deg] rounded-[4px] border-2 border-private bg-paper/80 px-4 py-1 font-display text-xl uppercase tracking-[0.2em] text-private">
            Void · Nullified
          </span>
        </div>
      )}
    </div>
  );
}

function StubField({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-private">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}
