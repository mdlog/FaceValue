"use client";

import * as React from "react";
import {
  StellarWalletsKit,
  Networks,
} from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { getStellarConfig } from "@/lib/stellar/config";

interface WalletCtx {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const Ctx = React.createContext<WalletCtx | null>(null);

// Track whether the static kit has been initialised client-side.
let kitInitialised = false;

function ensureKitInit(): void {
  if (typeof window === "undefined") return;
  if (kitInitialised) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
  });
  kitInitialised = true;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { networkPassphrase } = getStellarConfig();
  const [address, setAddress] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Initialise the static kit once after mount (client-only).
  React.useEffect(() => {
    ensureKitInit();
  }, []);

  const connect = React.useCallback(async () => {
    ensureKitInit();
    setConnecting(true);
    setError(null);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      setAddress(addr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "wallet connection failed");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = React.useCallback(() => {
    // Fire-and-forget — the async disconnect is best-effort; UI state clears immediately.
    StellarWalletsKit.disconnect().catch(() => undefined);
    setAddress(null);
  }, []);

  const signTransaction = React.useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error("wallet not connected");
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase,
      });
      return signedTxXdr;
    },
    [address, networkPassphrase],
  );

  const value: WalletCtx = {
    address,
    connecting,
    error,
    connect,
    disconnect,
    signTransaction,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}
