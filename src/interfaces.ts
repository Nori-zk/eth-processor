import { EthVerifier } from "./EthVerifier";

export interface Proof {
  Plonk: {
    encoded_proof: string;
    plonk_vkey_hash: number[];
    public_inputs: string[];
    raw_proof: string;
  };
}

export interface PublicValues {
  buffer: {
    data: number[];
  };
}

export interface PlonkProof {
  proof: Proof;
  public_values: PublicValues;
  sp1_version: string;
}

export interface ConvertedProofProofData {
  maxProofsVerified: 0 | 1 | 2,
  proof: string,
  publicInput: string[],
  publicOutput: string[]
}

export interface ConvertedProofVkData {
  data: string;
  hash: string 
}

export interface ConvertedProof {
  vkData: ConvertedProofVkData;
  proofData: ConvertedProofProofData;
}

export interface CreateProofArgument {
  sp1PlonkProof: PlonkProof,
  conversionOutputProof: ConvertedProof
}

export type EthVerifierComputeOutput = Awaited<ReturnType<typeof EthVerifier.compute>>;