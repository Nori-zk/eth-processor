import { Logger } from '@nori-zk/proof-conversion';
import { decodeConsensusMptProof } from './utils';
import { sp1ConsensusMPTPlonkProof } from './test_examples/sp1-with-mpt/sp1Proof.js';
const logger = new Logger('JestEthProofDecoder');

describe('ConsensusMPT marshaller Integration Test', () => {
    test('should decode consensus mpt proof', async () => {
        const decodedProof = decodeConsensusMptProof(sp1ConsensusMPTPlonkProof);
        console.log("decodedProof", decodedProof);
    });
});