import Link from "next/link";
import { ArrowRight, Scale, EyeOff, FileCheck2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HashMono } from "@/components/ui/hash-mono";
import { EVENTS, fmtUSD } from "@/lib/mock-data";

export default function CatalogPage() {
  return (
    <div className="space-y-14">
      {/* ---- hero ---- */}
      <section className="grid gap-10 lg:grid-cols-[7fr_5fr] lg:items-end">
        <div>
          <Badge tone="brass">UK Ticket Resale Cap · live Nov 2025</Badge>
          <h1 className="mt-4 font-display text-[clamp(2.4rem,5vw,4rem)] leading-[0.98] tracking-tight text-ink">
            Resale at face value.
            <br />
            <span className="italic">Proven, not promised.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            FaceValue proves every resale is{" "}
            <strong className="font-semibold text-ink">at or below the public face-value cap</strong>{" "}
            — without revealing the buyer, the seller, or the price. The cap is
            enforced by a zero-knowledge proof verified on Stellar, not by trusting
            a platform.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/resale"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[6px] bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
            >
              See the cap enforced <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/wallet"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[6px] edge-ink bg-paper-elevated px-5 text-sm font-medium text-ink transition-colors hover:bg-paper"
            >
              Open my wallet
            </Link>
          </div>
        </div>

        <ul className="space-y-3">
          <Principle icon={<Scale className="h-4 w-4" />} title="Enforcement is the headline">
            A Soroban contract rejects any resale priced above the regulated cap.
          </Principle>
          <Principle icon={<EyeOff className="h-4 w-4" />} title="Privacy is the wedge">
            Buyer, seller and exact price stay off the public ledger.
          </Principle>
          <Principle icon={<FileCheck2 className="h-4 w-4" />} title="Auditable on demand">
            A scoped view key lets a regulator reconstruct the detail — selective disclosure.
          </Principle>
        </ul>
      </section>

      {/* ---- catalog ---- */}
      <section>
        <div className="rule-ink mb-6 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2">
          <h2 className="font-display text-2xl tracking-tight text-ink">Event registry</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-private">
            {EVENTS.length} events · per-event caps published
          </span>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {EVENTS.map((e) => (
            <Link
              key={e.id}
              href="/resale"
              className="group flex flex-col gap-4 rounded-[6px] edge-ink bg-paper-elevated p-5 transition-shadow hover:shadow-[0_12px_28px_-20px_rgba(26,23,20,0.55)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-private">
                  {e.category}
                </span>
                <Badge tone="brass">CAP {fmtUSD(e.faceValueCapCents)}</Badge>
              </div>
              <div>
                <h3 className="font-display text-xl leading-none tracking-tight text-ink">
                  {e.name}
                </h3>
                <p className="mt-1.5 text-[13px] text-ink-soft">{e.subtitle}</p>
              </div>
              <dl className="mt-auto space-y-1.5 border-t border-ink/10 pt-3 font-mono text-[11px]">
                <Meta k="Venue" v={`${e.venue} · ${e.city}`} />
                <Meta k="Date" v={e.date} />
                <Meta k="Issued" v={e.issuedCount.toLocaleString()} />
                <div className="flex items-center justify-between">
                  <span className="uppercase tracking-[0.1em] text-private">Merkle root</span>
                  <HashMono value={e.merkleRoot} copyable={false} />
                </div>
              </dl>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink transition-colors group-hover:text-cap-line">
                Resell at face value <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Principle({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-[6px] edge-ink bg-paper-elevated/70 p-4">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-ink text-paper">
        {icon}
      </span>
      <div>
        <p className="font-display text-[15px] tracking-tight text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{children}</p>
      </div>
    </li>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="uppercase tracking-[0.1em] text-private">{k}</span>
      <span className="num text-ink-soft">{v}</span>
    </div>
  );
}
