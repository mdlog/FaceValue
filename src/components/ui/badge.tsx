import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "ink" | "accept" | "reject" | "private" | "brass";

const tones: Record<Tone, string> = {
  ink: "bg-ink/5 text-ink-soft edge-ink",
  accept: "bg-accept-bg text-accept border border-accept/30",
  reject: "bg-reject-bg text-reject border border-reject/30",
  private: "bg-private/12 text-private border border-private/25",
  brass: "bg-cap-line/10 text-cap-line border border-cap-line/35",
};

export function Badge({
  tone = "ink",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
