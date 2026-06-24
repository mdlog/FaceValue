import { describe, it, expect, afterEach } from "vitest";
import { getStellarConfig, isOnChainConfigured } from "./config";

const KEYS = [
  "NEXT_PUBLIC_FACEVALUE_CONTRACT_ID",
  "NEXT_PUBLIC_SOROBAN_RPC_URL",
  "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("stellar config", () => {
  it("is not configured when contract id is absent", () => {
    expect(isOnChainConfigured()).toBe(false);
  });

  it("is configured when contract id + rpc are present", () => {
    process.env.NEXT_PUBLIC_FACEVALUE_CONTRACT_ID = "CABC123";
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    expect(isOnChainConfigured()).toBe(true);
    expect(getStellarConfig().contractId).toBe("CABC123");
  });

  it("defaults rpc + passphrase to testnet", () => {
    const c = getStellarConfig();
    expect(c.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(c.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });
});
