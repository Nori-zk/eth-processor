import { CreateProofArgument } from "./interfaces";
import { vkData } from "./proofs/nodeVk.js";
import { p0 } from "./proofs/p0.js";
import {sp1PlonkProof} from "./proofs/sp1Proof.js";

export function buildExampleProofCreateArgument() {
    const example: CreateProofArgument = {
        sp1PlonkProof,
        conversionOutputProof: {vkData, proofData: p0}
    };
    return example;
}