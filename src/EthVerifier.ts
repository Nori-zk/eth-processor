import {
    Provable,
    VerificationKey,
    Poseidon,
    UInt8,
    Bytes,
    ZkProgram,
    Struct,
    UInt64,
    Undefined,
    Field,
} from 'o1js';

import {
    FrC,
    NodeProofLeft,
    parsePlonkPublicInputsProvable,
    wordToBytes,
} from '@nori-zk/proof-conversion';
import fs from 'fs';

class Bytes32 extends Bytes(32) {}

// sol! {
//     struct ProofOutputs {
//         bytes32 executionStateRoot;
//         bytes32 newHeader;
//         bytes32 nextSyncCommitteeHash;
//         uint256 newHead;
//         bytes32 prevHeader;
//         uint256 prevHead;
//         bytes32 syncCommitteeHash;
//     }
// }
class EthInput extends Struct({
    executionStateRoot: Bytes32.provable,
    newHeader: Bytes32.provable,
    nextSyncCommitteeHash: Bytes32.provable,
    newHead: UInt64,
    prevHeader: Bytes32.provable,
    prevHead: UInt64,
    syncCommitteeHash: Bytes32.provable,
    startSyncComitteHash: Bytes32.provable,
}) {}
const EthVerifier = ZkProgram({
    name: 'EthVerifier',
    publicInput: EthInput,
    publicOutput: Field,
    methods: {
        compute: {
            privateInputs: [NodeProofLeft],
            async method(input: EthInput, proof: NodeProofLeft) {
                // if (process.env.BLOBSTREAM_ENABLED == 'true') {
                // ethProgramVK = FrC.from(process.env.BLOBSTREAM_PROGRAM_VK as string);

                // These should be the same

                // JK to swap in CI after contract gets updated and redeployed
                const ethPlonkVK = FrC.from(
                    '356461990772566150229371218896390328991028774865907497243179150670146300968' //$programVK todo check ?
                );

                // p0 = ConverterInputMessage.proofConversionOutput.proofData.publicOutput[2]
                const ethNodeVk = Field.from(
                    '28260390150731392236641024269553678227550500922769773705331708504563351523466'
                );

                // Verification of proof conversion
                // vk = ConverterInputMessage.proofConversionOutput.vkData
                const vk = VerificationKey.fromJSON(
                    JSON.parse(
                        `{"data":"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","hash":"16513322678631837892015513717531806224957815970230988593763371397739021076098"}`
                    ) //to be hardcoded
                );

                // Above hardcoded, as long as SP1 logi unchanged
                // Updates with SP1 updates

                // [zkProgram / circuit][eth processor /  contract ie on-chain state]

                proof.verify(vk);

                // Passed proof matches extracted public entry 2
                proof.publicOutput.subtreeVkDigest.assertEquals(ethNodeVk);
                // Provable.log('all', input);
                // Provable.log('newHeader', input.newHeader);
                Provable.log('newHead slot', input.newHead);

                // Verification of the input
                let bytes: UInt8[] = [];
                bytes = bytes.concat(input.executionStateRoot.bytes);
                bytes = bytes.concat(input.newHeader.bytes);
                bytes = bytes.concat(input.nextSyncCommitteeHash.bytes);
                bytes = bytes.concat(padUInt64To32Bytes(input.newHead));
                bytes = bytes.concat(input.prevHeader.bytes);
                bytes = bytes.concat(padUInt64To32Bytes(input.prevHead));
                bytes = bytes.concat(input.syncCommitteeHash.bytes);
                bytes = bytes.concat(input.startSyncComitteHash.bytes);

                // bytes = bytes.concat(uint64ToBytes32(input.prevHead));
                // bytes = bytes.concat(uint64ToBytes32(input.newHead));

                // Check that zkporgraminput is same as passed to the SP1 program
                const pi0 = ethPlonkVK;
                const pi1 = parsePlonkPublicInputsProvable(Bytes.from(bytes));

                const piDigest = Poseidon.hashPacked(
                    Provable.Array(FrC.provable, 2),
                    [pi0, pi1]
                );
                Provable.log('piDigest', piDigest);
                Provable.log(
                    'proof.publicOutput.rightOut',
                    proof.publicOutput.rightOut
                );

                piDigest.assertEquals(proof.publicOutput.rightOut);

                return { publicOutput: new Field(1) };
            },
        },
    },
});

const EthProof = ZkProgram.Proof(EthVerifier);
export { EthVerifier, EthProof, EthInput, Bytes32 };

const padUInt64To32Bytes = (num: UInt64): UInt8[] => {
    let unpadded: UInt8[] = [];
    unpadded = wordToBytes(num.toFields()[0]);
    return [...unpadded, ...Array(24).fill(UInt8.from(0))].reverse();
};
