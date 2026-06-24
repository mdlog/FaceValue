"use client";

import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/lib/stellar/wallet";
import { isOnChainConfigured } from "@/lib/stellar/config";
import { cn } from "@/lib/utils";

function trunc(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function ConnectWallet({ className }: { className?: string }) {
  const { address, connect, disconnect, connecting } = useWallet();
  if (!isOnChainConfigured()) return null;

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={address}
        className={cn(
          "inline-flex min-h-[40px] items-center gap-2 rounded-[5px] edge-ink bg-paper-elevated px-3 font-mono text-[12px] text-ink transition-colors hover:bg-paper",
          className,
        )}
      >
        <span className="num">{trunc(address)}</span>
        <LogOut className="h-3.5 w-3.5 text-private" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      className={cn(
        "inline-flex min-h-[40px] items-center gap-2 rounded-[5px] bg-ink px-3 font-mono text-[12px] uppercase tracking-[0.08em] text-paper transition-colors hover:bg-ink-soft disabled:opacity-50",
        className,
      )}
    >
      <Wallet className="h-3.5 w-3.5" />
      {connecting ? "Connecting…" : "Connect"}
    </button>
  );
}
