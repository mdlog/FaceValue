// SDK-free error-mapping module — safe to import in tests and server components.

export type SubmitStatus = "success" | "reverted" | "error";

export interface SubmitResult {
  status: SubmitStatus;
  hash?: string;
  contractError?: number;
  message: string;
}

const ERRORS: Record<number, string> = {
  5: "Event is not registered on the contract.",
  6: "On-chain cap does not match the proof (event registered incorrectly).",
  7: "On-chain Merkle root does not match the proof.",
  8: "This ticket was already resold on-chain — rejected (nullifier already burned).",
  9: "The contract rejected the proof (pairing check failed).",
};

export function mapContractError(code: number): string {
  return ERRORS[code] ?? `The contract rejected the transaction (error #${code}).`;
}

/** Extract a contract error code from a host error string like `Error(Contract, #8)`. */
export function extractContractError(text: string): number | undefined {
  const m = text.match(/Error\(Contract,\s*#(\d+)\)/);
  return m ? Number(m[1]) : undefined;
}
