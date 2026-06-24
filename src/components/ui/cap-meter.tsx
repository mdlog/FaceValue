import { fmtUSD } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/**
 * Cap meter — the regulated face-value cap sits at the mid-line (brass).
 * Price marker is green at/below the cap, red above it; the over-cap band is shaded.
 */
export function CapMeter({
  capCents,
  priceCents,
  className,
}: {
  capCents: number;
  priceCents: number;
  className?: string;
}) {
  const domain = capCents * 2; // cap rendered at 50%
  const capPos = 50;
  const pricePos = Math.max(2, Math.min(100, (priceCents / domain) * 100));
  const over = priceCents > capCents;

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.1em]">
        <span className="text-private">Resale price vs cap</span>
        <span className={cn("num", over ? "text-reject" : "text-accept")}>
          {fmtUSD(priceCents)} {over ? "▲ over" : "✓ within"}
        </span>
      </div>

      <div className="relative h-9 rounded-[4px] edge-ink bg-paper-elevated">
        {/* over-cap shaded zone */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-[4px] bg-reject-bg"
          style={{ left: `${capPos}%` }}
        />
        {/* cap brass line */}
        <div
          className="absolute inset-y-0 w-[2px] bg-cap-line"
          style={{ left: `${capPos}%` }}
        />
        <span
          className="absolute -top-0.5 translate-x-[6px] font-mono text-[10px] font-medium tracking-[0.08em] text-cap-line"
          style={{ left: `${capPos}%` }}
        >
          CAP {fmtUSD(capCents)}
        </span>
        {/* price marker */}
        <div
          className={cn(
            "absolute inset-y-1 w-[3px] rounded-full transition-all duration-300 ease-out",
            over ? "bg-reject" : "bg-accept"
          )}
          style={{ left: `${pricePos}%` }}
        />
      </div>
    </div>
  );
}
