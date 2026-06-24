import {
  TransactionBuilder,
  Contract,
  nativeToScVal,
  BASE_FEE,
  rpc,
} from "@stellar/stellar-sdk";
import { getStellarConfig } from "@/lib/stellar/config";
import {
  serializeProof,
  serializePublicSignals,
  type SnarkProof,
} from "@/lib/zk/groth16-serialize";
import {
  mapContractError,
  extractContractError,
} from "./errors";

export type { SubmitStatus, SubmitResult } from "./errors";

export async function submitVerifyResale(args: {
  address: string;
  signTransaction: (xdr: string) => Promise<string>;
  eventId: string;
  proof: SnarkProof;
  publicSignals: string[];
}): Promise<import("./errors").SubmitResult> {
  const { contractId, rpcUrl, networkPassphrase } = getStellarConfig();
  if (!contractId) return { status: "error", message: "CONTRACT_ID belum diset." };

  try {
    const server = new rpc.Server(rpcUrl);
    const account = await server.getAccount(args.address);

    const proofBytes = serializeProof(args.proof);
    const signalsBytes = serializePublicSignals(args.publicSignals);

    const op = new Contract(contractId).call(
      "verify_resale",
      nativeToScVal(args.eventId, { type: "string" }),
      nativeToScVal(proofBytes, { type: "bytes" }),
      nativeToScVal(signalsBytes, { type: "bytes" }),
    );

    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // Simulate first — a contract revert surfaces here, before we ask to sign.
    const sim = await server.simulateTransaction(built);
    if (rpc.Api.isSimulationError(sim)) {
      const code = extractContractError(sim.error);
      return code !== undefined
        ? { status: "reverted", contractError: code, message: mapContractError(code) }
        : { status: "error", message: sim.error };
    }

    const prepared = rpc.assembleTransaction(built, sim).build();
    const signedXdr = await args.signTransaction(prepared.toXDR());
    const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

    const sent = await server.sendTransaction(signed);
    if (sent.status === "ERROR") {
      const code = extractContractError(JSON.stringify(sent.errorResult ?? sent));
      return code !== undefined
        ? { status: "reverted", contractError: code, message: mapContractError(code) }
        : { status: "error", message: "submit ditolak oleh RPC." };
    }

    // Poll for finality.
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let res = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) {
      await sleep(1000);
      res = await server.getTransaction(sent.hash);
    }

    if (res.status === "SUCCESS") {
      return { status: "success", hash: sent.hash, message: "Verified on-chain — nullifier burned." };
    }
    const code = extractContractError(JSON.stringify(res));
    return code !== undefined
      ? { status: "reverted", hash: sent.hash, contractError: code, message: mapContractError(code) }
      : { status: "error", hash: sent.hash, message: `Transaksi gagal (${res.status}).` };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "submit gagal" };
  }
}
