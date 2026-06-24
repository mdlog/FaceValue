// Reads NEXT_PUBLIC_ env (inlined by Next at build for the client). Pure — no SDK
// import — so it's cheap to import anywhere, including server components.

export interface StellarConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

const DEFAULT_RPC = "https://soroban-testnet.stellar.org";
const DEFAULT_PASSPHRASE = "Test SDF Network ; September 2015";

export function getStellarConfig(): StellarConfig {
  return {
    contractId: process.env.NEXT_PUBLIC_FACEVALUE_CONTRACT_ID ?? "",
    rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || DEFAULT_RPC,
    networkPassphrase:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || DEFAULT_PASSPHRASE,
  };
}

export function isOnChainConfigured(): boolean {
  const c = getStellarConfig();
  return c.contractId.trim().length > 0 && c.rpcUrl.trim().length > 0;
}
