import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PerforatedStub } from "@/components/ui/perforated-stub";
import { TICKETS, eventById } from "@/lib/mock-data";

export default function WalletPage() {
  return (
    <div className="space-y-8">
      <header className="rule-ink flex flex-col gap-2 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-ink">My wallet</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            Tickets you hold. The price you paid is private — even to us.
          </p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
          {TICKETS.length} stubs
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {TICKETS.map((t) => {
          const event = eventById(t.eventId);
          const resellable = t.status !== "nullified";
          return (
            <PerforatedStub
              key={t.id}
              ticket={t}
              event={event}
              footer={
                resellable ? (
                  <Link
                    key="resell"
                    href="/resale"
                    className="inline-flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink transition-colors hover:text-cap-line"
                  >
                    List for resale (≤ cap) <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <span
                    key="void"
                    className="font-mono text-[11px] uppercase tracking-[0.1em] text-private"
                  >
                    Nullified · resold &amp; re-issued
                  </span>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}
