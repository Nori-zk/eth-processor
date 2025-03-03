import { buildExampleProofCreateArgument, buildExampleProofSeriesCreateArguments } from './constructExampleProofs.js';
import { MinaEthProcessorSubmitter } from './proofSubmitter.js';

describe('MinaEthProcessorSubmittor Integration Test', () => {
    test('should run the proof submission process correctly', async () => {
        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // If local compile and deploy contracts.
        if (proofSubmitter.liveNet === false) {
            await proofSubmitter.deployContract();
        }
        // Build proof.
        const ethProof = await proofSubmitter.createProof(buildExampleProofCreateArgument());

        // Submit proof.
        const txDetails = await proofSubmitter.submit(ethProof.proof);
        console.log('TxDetails', txDetails);
    });

    test('should perform a series of proof submissions', async () => {
        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // If local compile and deploy contracts.
        if (proofSubmitter.liveNet === false) {
            await proofSubmitter.deployContract();
        }

        // Build and submit proofs
        const seriesExamples = buildExampleProofSeriesCreateArguments();
        let i = 1;
        for (const example of seriesExamples) {
            console.log(`Running Example ${i} -------------------------------------------------------`);
            // Build proof.
            const ethProof = await proofSubmitter.createProof(example);

            // Submit proof.
            const txDetails = await proofSubmitter.submit(ethProof.proof);
            console.log('TxDetails', txDetails);

            i++;
        }
    });
});
