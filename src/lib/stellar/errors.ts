// SDK-free error-mapping module — safe to import in tests and server components.

export type SubmitStatus = "success" | "reverted" | "error";

export interface SubmitResult {
  status: SubmitStatus;
  hash?: string;
  contractError?: number;
  message: string;
}

const ERRORS: Record<number, string> = {
  5: "Event belum terdaftar di kontrak.",
  6: "Cap on-chain tidak cocok dengan proof (registrasi event salah).",
  7: "Merkle root on-chain tidak cocok dengan proof.",
  8: "Tiket sudah dijual ulang on-chain — ditolak (nullifier sudah dibakar).",
  9: "Proof ditolak kontrak (pairing check gagal).",
};

export function mapContractError(code: number): string {
  return ERRORS[code] ?? `Kontrak menolak transaksi (error #${code}).`;
}

/** Extract a contract error code from a host error string like `Error(Contract, #8)`. */
export function extractContractError(text: string): number | undefined {
  const m = text.match(/Error\(Contract,\s*#(\d+)\)/);
  return m ? Number(m[1]) : undefined;
}
