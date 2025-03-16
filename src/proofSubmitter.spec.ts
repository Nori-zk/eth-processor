import { PendingTransaction, Transaction } from 'o1js';
import {
  buildExampleProofCreateArgument,
  buildExampleProofSeriesCreateArguments,
} from './constructExampleProofs.js';
import { MinaEthProcessorSubmitter } from './proofSubmitter.js';

describe('MinaEthProcessorSubmittor Integration Test', () => {
  test('should run the proof submission process correctly', async () => {
    // Construct a MinaEthProcessorSubmittor
    const proofSubmitter = new MinaEthProcessorSubmitter();

    // Establish the network
    await proofSubmitter.networkSetUp();

    // Compile contracts.
    await proofSubmitter.compileContracts();
    // If local deploy contracts.
    if (proofSubmitter.liveNet === false) {
      await proofSubmitter.deployContract();
    }
    // Build proof.
    const ethProof = await proofSubmitter.createProof(
      buildExampleProofCreateArgument()
    );

    // Submit proof.
    const txDetails = await proofSubmitter.submit(ethProof.proof);
    console.log('TxDetails', txDetails);
    let abc = await txDetails.wait();
    console.log('txhash', abc.hash);
  });

  test('should perform a series of proof submissions', async () => {
    // Construct a MinaEthProcessorSubmittor
    const proofSubmitter = new MinaEthProcessorSubmitter();

    // Establish the network
    await proofSubmitter.networkSetUp();

    // Compile contracts.
    await proofSubmitter.compileContracts();

    // If local deploy contracts.
    if (proofSubmitter.liveNet === false) {
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
      const txDetails = await proofSubmitter.submit(ethProof.proof);
      console.log('TxDetails', txDetails);

      i++;
    }
  });

  test('should run a toJSON fromJSON conversion', async () => {
    // Construct a MinaEthProcessorSubmittor
    const proofSubmitter = new MinaEthProcessorSubmitter();

    // Establish the network
    await proofSubmitter.networkSetUp();

    // Compile contracts.
    await proofSubmitter.compileContracts();
    // If local deploy contracts.
    if (proofSubmitter.liveNet === false) {
      await proofSubmitter.deployContract();
    }
    // Build proof.
    const ethProof = await proofSubmitter.createProof(
      buildExampleProofCreateArgument()
    );

    // Submit proof.
    const txDetails = await proofSubmitter.submit(ethProof.proof);
    console.log('txBefore', txDetails);

    const txJSON = txDetails.toJSON();
    const tx = Transaction.fromJSON(JSON.parse(txJSON)) as unknown as PendingTransaction;

    console.log('txAfter', tx);
    let abc = await tx.wait();
    console.log('txhash', abc.hash);
  });
});
