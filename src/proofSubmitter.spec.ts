import {
    buildExampleProofCreateArgument,
    buildExampleProofSeriesCreateArguments,
} from './constructExampleProofs.js';
import { MinaEthProcessorSubmitter } from './proofSubmitter.js';
import { wait } from './txWait.js';

describe('MinaEthProcessorSubmittor Integration Test', () => {
    test('should run the proof submission process correctly', async () => {
        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();

        // If local deploy contracts.
        if (proofSubmitter.testMode === true) {
            await proofSubmitter.deployContract();
        }

        // Build proof.
        const ethProof = await proofSubmitter.createProof(
            buildExampleProofCreateArgument()
        );

        // Submit proof.
        const result = await proofSubmitter.submit(ethProof.proof);

        // Wait for finalization
        await wait(result.txId, process.env.MINA_RPC_NETWORK_URL!);

        console.log('Awaited finalization succesfully.');
    });

    test('should perform a series of proof submissions', async () => {
        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();

        // If local deploy contracts.
        if (proofSubmitter.testMode === true) {
            await proofSubmitter.deployContract();
        }

        // Build and submit proofs
        const seriesExamples = buildExampleProofSeriesCreateArguments();
        let i = 1;
        for (const example of seriesExamples) {
            console.log(
                `Running Example ${i} -------------------------------------------------------`
            );
            // Build proof.
            const ethProof = await proofSubmitter.createProof(example);

            // Submit proof.
            const result = await proofSubmitter.submit(ethProof.proof);
            console.log('txHash', result.txHash);

            // Wait for finalization
            await wait(result.txHash, process.env.MINA_RPC_NETWORK_URL!);
            i++;
        }
    });

    test('custom wait should await finalisation successfully', async () => {
        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();
        // If local deploy contracts.
        if (proofSubmitter.testMode === true) {
            await proofSubmitter.deployContract();
        }
        // Build proof.
        const ethProof = await proofSubmitter.createProof(
            buildExampleProofCreateArgument()
        );

        // Submit proof.
        const result = await proofSubmitter.submit(ethProof.proof);

        // Wait for finalization
        await wait(result.txId, process.env.MINA_RPC_NETWORK_URL!);
    });
});
