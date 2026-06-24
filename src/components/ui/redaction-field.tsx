import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Privacy is a SYSTEM, not an accident — every place a buyer / seller / price
 * would appear on-chain renders as the same redaction bar until a view key reveals it.
 */
export function RedactionField({
  label,
  value,
  revealed = false,
  className,
}: {
  label: string;
  value?: string;
  revealed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-private">
        {label}
      </span>
      {revealed && value ? (
        <code className="font-mono text-[13px] text-ink num">{value}</code>
      ) : (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-[3px] bg-private px-2 py-1 text-paper">
          <Lock className="h-3 w-3" strokeWidth={2.4} />
          <span className="font-mono text-[11px] tracking-[0.18em]">PRIVATE</span>
        </span>
      )}
    </div>
  );
}
