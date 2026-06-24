// Minimal ambient types for circomlibjs (ships no .d.ts). Only buildPoseidon is
// used here; the Poseidon field arithmetic is loosely typed.
declare module "circomlibjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type FieldElement = any;

  export interface Poseidon {
    (inputs: (bigint | number | string)[]): FieldElement;
    F: {
      toString(x: FieldElement, radix?: number): string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }

  export function buildPoseidon(): Promise<Poseidon>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function buildPoseidonOpt(): Promise<any>;
}
