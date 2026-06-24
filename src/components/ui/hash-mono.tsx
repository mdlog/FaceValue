"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function truncMid(v: string, head = 8, tail = 6) {
  if (v.length <= head + tail + 1 || v.includes("…")) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

export function HashMono({
  value,
  label,
  copyable = true,
  className,
}: {
  value: string;
  label?: string;
  copyable?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore in demo */
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-private">
          {label}
        </span>
      )}
      <code className="font-mono text-[12px] text-ink num">{truncMid(value)}</code>
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label="copy"
          className="grid h-5 w-5 place-items-center rounded-[3px] text-private transition-colors hover:bg-ink/5 hover:text-ink"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-accept" strokeWidth={2.4} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      )}
    </span>
  );
}
