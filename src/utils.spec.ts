import { decodeConsensusMptProofNew } from './utils';
import { sp1ConsensusMPTPlonkProof } from './test_examples/sp1-with-mpt/sp1Proof.js';

describe('ConsensusMPT marshaller Integration Test', () => {
    test('should decode consensus mpt proof', async () => {
        const decodedProof = decodeConsensusMptProofNew(sp1ConsensusMPTPlonkProof);
        console.log("decodedProof", decodedProof);
    });
});