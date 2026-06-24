// Minimal ambient types for snarkjs (the package ships no .d.ts).
// We only use the Groth16 surface on the server; type the rest loosely.
declare module "snarkjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = any;

  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: Json; publicSignals: string[] }>;
    prove(
      zkeyPath: string,
      witnessPath: string,
    ): Promise<{ proof: Json; publicSignals: string[] }>;
    verify(vkey: Json, publicSignals: string[], proof: Json): Promise<boolean>;
    exportSolidityCallData(proof: Json, publicSignals: string[]): Promise<string>;
  };

  const _default: { groth16: typeof groth16 };
  export default _default;
}
