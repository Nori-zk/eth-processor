import { CreateProofArgument } from '../interfaces';
import { vkData } from '../proofs/nodeVk.js';
import { p0 } from '../proofs/p0.js';
import { sp1PlonkProof } from '../proofs/sp1Proof.js';
import { MinaEthProcessorSubmitter } from '../proofSubmitter.js';

function buildProofCreateArgument() {
    const example: CreateProofArgument = {
        sp1PlonkProof,
        conversionOutputProof: { vkData, proofData: p0 }
    };
    return example;
}

async function main() {
    // Construct a MinaEthProcessorSubmittor
    const proofSubmitter = new MinaEthProcessorSubmitter();

    // Establish the network
    await proofSubmitter.networkSetUp();

    // If local compile and deploy contracts.
    if (proofSubmitter.liveNet === false) {
        await proofSubmitter.deployContract();
    }
    // Build proof.
    const ethProof = await proofSubmitter.createProof(buildProofCreateArgument());

    // Submit proof.
    const txDetails = await proofSubmitter.submit(ethProof.proof);
    console.log('TxDetails', txDetails);
}

main().catch(console.error);