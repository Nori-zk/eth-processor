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
import {
    Bytes32,
    StoreHash,
    VerifiedContractStorageSlot,
    VerifiedContractStorageSlots,
} from './types.js';
import { DynamicArray } from 'mina-attestations';

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
    verifiedContractStorageSlotsLength: UInt64,
    verifiedContractStorageSlots: VerifiedContractStorageSlots.provable,
}) {}

const EthVerifier = ZkProgram({
    name: 'EthVerifier',
    publicInput: EthInput,
    publicOutput: StoreHash,
    methods: {
        compute: {
            privateInputs: [NodeProofLeft],
            async method(input: EthInput, proof: NodeProofLeft) {
                // JK to swap in CI after contract gets updated and redeployed

                // This is an sp1Proof.proof.Plonk.public_inputs[0]
                // This can now be extracted from bridge head repo at location
                // nori-elf/nori-sp1-helios-program.pi0.json and should be copied to this repository
                const ethPlonkVK = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);

                // p0 = proofConversionOutput.proofData.publicOutput[2] // hash of publicOutput of sp1
                const ethNodeVk = Field.from(proofConversionSP1ToPlonkPO2);

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
                // Step 1: Offset marker (value = 32, padded to 32 bytes)
                bytes = bytes.concat(padUInt64To32Bytes(UInt64.from(32))); // [0–31]
                // Step 2: Fixed struct fields (ProofOutputs) — [32–352]
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
                // Step 3: Dynamic array header (VerifiedContractStorageSlot[]) — [352–415]
                bytes = bytes.concat(padUInt64To32Bytes(UInt64.from(416))); // [352–383]
                bytes = bytes.concat(
                    padUInt64To32Bytes(input.verifiedContractStorageSlotsLength)
                ); // [384–415]

                /* 
                   const lengthNum = Number(input.verifiedContractStorageSlots.length.toBigInt());
                   const maxLength = 416 + lengthNum * 128;
                   const bytesArray = DynamicArray(UInt8, {maxLength} )
                   Can't do this it depends on user input
                
               */

                // Below is the official mina attestation dynamic array for each

                input.verifiedContractStorageSlots.forEach(
                    (verifiedContractStorageSlot, isDummy) => {
                        /* Provable.if(isDummy, ARuntimeType, state, nextState);
                           Provable if isn't going to work because UInt8[] isnt a runtime type
                           It would need to be something like StaticArray or DynamicArray.
                           Should we be doing a dynamicarray of bytes for 'bytes'? not sure if it can be known
                           at runtime.
                        */
                        const slotBytes = VerifiedContractStorageSlot.bytes(
                            verifiedContractStorageSlot
                        );
                        bytes = bytes.concat(slotBytes);
                    }
                );
                // Could we do something like this? 
                /*
                    const length = Number(
                        input.verifiedContractStorageSlotsLength.value.toBigInt()
                    );
                    const sliceLen = 416 + length * 128;
                    bytes = bytes.slice(0, sliceLen);
                    No because it based on user input.
                */

                // Check that zkprograminput is same as passed to the SP1 program
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

                const storeHash = StoreHash.fromBytes32(input.storeHash);

                Provable.asProver(() => {
                    Provable.log('Proof input store hash values were:');
                    Provable.log(input.storeHash.bytes[0].value);
                    Provable.log(
                        input.storeHash.bytes.slice(1, 33).map((b) => b.value)
                    );
                    Provable.log(
                        'Public outputs created:',
                        storeHash.highByteField,
                        storeHash.lowerBytesField
                    );
                });

                return {
                    publicOutput: storeHash,
                };
            },
        },
    },
});

const EthProof = ZkProgram.Proof(EthVerifier);

const padUInt64To32Bytes = (num: UInt64): UInt8[] => {
    let unpadded: UInt8[] = [];
    unpadded = wordToBytes(num.toFields()[0]);
    return [...unpadded, ...Array(24).fill(UInt8.from(0))].reverse();
};

export { EthVerifier, EthProof, EthInput };
