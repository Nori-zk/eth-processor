import { Field, Poseidon, Struct, UInt64 } from 'o1js';
import {
    getMerkleLeafAttestorGenerator,
    LeafContentsType,
    LeafInstance,
} from './merkleLeafAttestor.js';
import { Bytes20, Bytes32 } from './types.js';
import { sp1ConsensusMPTPlonkProof } from './test_examples/sp1-with-mpt/sp1ProofMessage.js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { computeMerkleTreeDepthAndSize, foldMerkleLeft, getMerkleZeros } from './merkleTree.js';

const logger = new Logger('TestMerkle');
new LogPrinter('[TestEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const leafContentsInnerType = {
    address: Bytes20,
    value: Bytes32,
};

class ASHIADSI extends Struct({ address: Bytes20, value: Bytes32 }) {}
const a = new ASHIADSI({
    address: Bytes20.fromHex('dummy'),
    value: Bytes32.fromHex('dummy'),
});
a.address;
a.value

function hashLeafContents(
    leafContents: LeafInstance<typeof leafContentsInnerType>
) {
    const addrBytes = leafContents.address.toBytes();
    const valueBytes = leafContents.value.toBytes();

    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(addrBytes, 0); // first 20 bytes from address
    firstFieldBytes[20] = valueBytes[0]; // 21st byte from value

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(valueBytes.slice(1, 32), 0); // remaining 31 bytes from value

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));

    return Poseidon.hash([firstField, secondField]);
}

const {
    MerkleTreeLeaf,
    MerkleTreeLeafAttestorInput,
    MerkleTreeLeafAttestor,
    buildLeaves,
    getMerklePathFromLeaves,
} = getMerkleLeafAttestorGenerator<typeof leafContentsInnerType>(
    16,
    'MyMerkleVerifier',
    leafContentsInnerType,
    hashLeafContents
);

describe('Merkle Fixed Tests', () => {
    test('test_large_slots', async () => {
        // Build zk program

        const merkleTreeLeafAttestorAnalysis =
            await MerkleTreeLeafAttestor.analyzeMethods();
        logger.log(
            `MerkleTreeLeafAttestor analyze methods gates length '${merkleTreeLeafAttestorAnalysis.compute.gates.length}'.`
        );

        const { verificationKey } = await MerkleTreeLeafAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleTreeLeafAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        // Build contractStorageSlot from sp1 mpt message.
        const contractStorageSlots =
            sp1ConsensusMPTPlonkProof.contract_storage_slots.map((slot) => {
                const a = new MerkleTreeLeaf({
                    address: Bytes20.fromHex(slot.slot_key_address),
                    value: Bytes32.fromHex(slot.value),
                });

                return a;
            });
        // Build leaves
        const leaves = buildLeaves(contractStorageSlots);

        // Pick an index
        let randomIndex =
            sp1ConsensusMPTPlonkProof.contract_storage_slots.length - 1;

        // Find Value
        const slotToFind = contractStorageSlots.find(
            (leaf, idx) => idx === randomIndex
        );

        if (!slotToFind) throw new Error(`Slot at ${randomIndex} not found`);

        const value = slotToFind.value;
        const address = slotToFind.address;

        // Compute path
        const path = getMerklePathFromLeaves([...leaves], randomIndex);

        // Compute root
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
        const rootHash = foldMerkleLeft(leaves, paddedSize, depth, getMerkleZeros(depth));

        // Build ZK input
        const zkInput = new MerkleTreeLeafAttestorInput({
            rootHash,
            path,
            index: UInt64.from(randomIndex),
            value
        })
        
    });
});
