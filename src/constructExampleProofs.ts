import { CreateProofArgument } from './types';
import { vkData } from './proofs/nodeVk.js';
import { p0 } from './proofs/p0.js';
import { sp1PlonkProof } from './proofs/sp1Proof.js';
import seriesExample1 from './test_examples/4421760/index.js';
import seriesExample2 from './test_examples/4421952/index.js';
import seriesExample3 from './test_examples/4421984/index.js';
import seriesExample4 from './test_examples/4422016/index.js';

export function buildExampleProofCreateArgument() {
    const example: CreateProofArgument = {
        sp1PlonkProof,
        conversionOutputProof: { vkData, proofData: p0 },
    };
    return example;
}

export function buildExampleProofSeriesCreateArguments(): Array<CreateProofArgument> {
    return [seriesExample1, seriesExample2, seriesExample3, seriesExample4];
}
