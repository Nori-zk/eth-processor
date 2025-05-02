import {
    Provable,
    VerificationKey,
    Poseidon,
    UInt8,
    Bytes,
    ZkProgram,
    Struct,
    UInt64,
    Field,
} from 'o1js';
import {
    FrC,
    NodeProofLeft,
    parsePlonkPublicInputsProvable,
    wordToBytes,
} from '@nori-zk/proof-conversion';
import { bridgeHeadNoriSP1HeliosProgramPi0 } from './integrity/BridgeHead.NoriSP1HeliosProgram.pi0.js';
import { proofConversionSP1ToPlonkPO2 } from './integrity/ProofConversion.sp1ToPlonk.po2.js';
import { proofConversionSP1ToPlonkVkData } from './integrity/ProofConversion.sp1ToPlonk.vkData.js';

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
//         bytes32 prevStoreHash;
//         bytes32 storeHash;
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
    startSyncCommitteeHash: Bytes32.provable,
    prevStoreHash: Bytes32.provable,
    storeHash: Bytes32.provable,
}) {}
class EthOutput extends Struct({
    storeHashHighByteField: Field,
    storeHashLowerBytesField: Field,
}) {}
const EthVerifier = ZkProgram({
    name: 'EthVerifier',
    publicInput: EthInput,
    publicOutput: EthOutput,
    methods: {
        compute: {
            privateInputs: [NodeProofLeft],
            async method(input: EthInput, proof: NodeProofLeft) {
                // JK to swap in CI after contract gets updated and redeployed

                // This is an sp1Proof.proof.Plonk.public_inputs[0]
                // This can now be extracted from bridge head repo at location
                // nori-elf/nori-sp1-helios-program.pi0.json and should be copied to this repository
                const ethPlonkVK = FrC.from(
                    bridgeHeadNoriSP1HeliosProgramPi0
                );

                // p0 = proofConversionOutput.proofData.publicOutput[2] // hash of publicOutput of sp1
                const ethNodeVk = Field.from(
                    proofConversionSP1ToPlonkPO2
                );

                // Verification of proof conversion
                // vk = proofConversionOutput.vkData
                // this is also from nodeVK
                const vk = VerificationKey.fromJSON(
                    proofConversionSP1ToPlonkVkData
                );

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
                bytes = bytes.concat(input.startSyncCommitteeHash.bytes);
                bytes = bytes.concat(input.prevStoreHash.bytes);
                bytes = bytes.concat(input.storeHash.bytes);

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

                // Store hash high byte
                const storeHashHighByteField = new Field(0);

                storeHashHighByteField.add(input.storeHash.bytes[0].value); // budget of 31 bytes.... slot is 8 bytes (u64),

                // Store hash lower 31 bytes
                const storeHashLowerBytesField = new Field(0);

                for (let i = 1; i < 32; i++) {
                    storeHashLowerBytesField
                        .mul(256)
                        .add(input.storeHash.bytes[i].value);
                }

                return {
                    publicOutput: new EthOutput({
                        storeHashHighByteField,
                        storeHashLowerBytesField,
                    }),
                };
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
