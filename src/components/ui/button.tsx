import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "solid" | "outline" | "ghost" | "stamp";
type Tone = "ink" | "accept" | "reject" | "brass";

const toneText: Record<Tone, string> = {
  ink: "text-ink",
  accept: "text-accept",
  reject: "text-reject",
  brass: "text-cap-line",
};

export function Button({
  variant = "solid",
  tone = "ink",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  tone?: Tone;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 text-sm font-medium tracking-wide transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink select-none";
  const variants: Record<Variant, string> = {
    solid: "bg-ink text-paper hover:bg-ink-soft rounded-[6px]",
    outline:
      "edge-ink bg-paper-elevated hover:bg-paper rounded-[6px] " + toneText[tone],
    ghost: "hover:bg-ink/5 rounded-[6px] " + toneText[tone],
    stamp:
      "uppercase font-display tracking-[0.12em] stamp-ink rounded-[4px] " +
      toneText[tone],
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}
