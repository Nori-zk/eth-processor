import { Bytes, Field, Poseidon, Provable, Struct, UInt64, UInt8 } from 'o1js';
import { getMerkleLeafAttestorGenerator } from './merkleLeafAttestor.js';
import { Bytes20, Bytes32 } from './types.js';
import { sp1ConsensusMPTPlonkProof } from './test_examples/sp1-with-mpt/sp1ProofMessage.js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkleTree.js';

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

function hashStorageSlot(addr: Bytes20, value: Bytes32): Field {
    const addrBytes = addr.toBytes();
    const valueBytes = value.toBytes();

    console.log('addressBytes', addrBytes);
    console.log('valueBytes', valueBytes);
    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(addrBytes, 0); // first 20 bytes from address
    firstFieldBytes[20] = valueBytes[0]; // 21st byte from value

    console.log('firstFieldBytes', firstFieldBytes);

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(valueBytes.slice(1, 32), 0); // remaining 31 bytes from value

    console.log('secondFieldBytes', secondFieldBytes);

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));

    console.log('(Rust)firstField', firstField.toBigInt());
    console.log('(rust)secondField', secondField.toBigInt());

    return Poseidon.hash([firstField, secondField]);
}

function buildLeavesRust(pairs: Array<[Bytes20, Bytes32]>): Field[] {
    return pairs.map(([addr, val]) => hashStorageSlot(addr, val));
}

class ProvableLeafValue extends Struct({
    address: Bytes20.provable,
    value: Bytes32.provable,
}) {}

function hashLeafContents(leafContents: ProvableLeafValue) {
    const addressBytes = leafContents.address.bytes; // UInt8[]
    const valueBytes = leafContents.value.bytes; // UInt8[]

    Provable.asProver(() => {
        Provable.log('addressBytes', addressBytes);
        Provable.log('valueBytes', valueBytes);
    });

    // We want 20 bytes from addrBytes + 1 byte from valueBytes + remaining 31 bytes from valueBytes

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from valueBytes
    const firstFieldBytes: UInt8[] = [];

    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 21; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(valueBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    secondFieldBytes.push(UInt8.zero);

    // Convert UInt8[] to Bytes (provable bytes)
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);

    // Extract the first field (there should only ever be one here)
    Provable.asProver(() => {
        Provable.log('firstBytes.toFields()', firstBytes.toFields());
        Provable.log('secondBytes.toFields()', secondBytes.toFields());
    });

    // this is assuming big endian ??

    /*let firstField = new Field(0);
    let secondField = new Field(0);
    for (let i = 0; i < 32; i++) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
    }*/

    // implement little endian here instead...
    let firstField = new Field(0);
    let secondField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
    }

    Provable.asProver(() => {
        Provable.log('(provable)firstField', firstField.toBigInt());
        Provable.log('(provable)secondField', secondField.toBigInt());
    });

    return Poseidon.hash([firstField, secondField]);
}

const {
    MerkleTreeLeafAttestorInput,
    MerkleTreeLeafAttestor,
    buildLeaves,
    getMerklePathFromLeaves,
} = getMerkleLeafAttestorGenerator(
    16,
    'MyMerkleVerifier',
    ProvableLeafValue,
    hashLeafContents
);

function dummyAddress(byte: number): Bytes20 {
    const arr = new Uint8Array(20).fill(byte);
    return Bytes20.from(arr);
}

function dummyValue(byte: number): Bytes32 {
    const arr = new Uint8Array(32).fill(byte);
    return Bytes32.from(arr);
}

describe('Merkle Attestor Test', () => {
    test('pipeline', async () => {
        // Analyse zk program
        const merkleTreeLeafAttestorAnalysis =
            await MerkleTreeLeafAttestor.analyzeMethods();
        logger.log(
            `MerkleTreeLeafAttestor analyze methods gates length '${merkleTreeLeafAttestorAnalysis.compute.gates.length}'.`
        );

        // Build zk program
        const { verificationKey } = await MerkleTreeLeafAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleTreeLeafAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        // Build contractStorageSlot from sp1 mpt message.
        const contractStorageSlots =
            sp1ConsensusMPTPlonkProof.contract_storage_slots.map((slot) => {
                return new ProvableLeafValue({
                    address: Bytes20.fromHex(slot.slot_key_address.slice(2)),
                    value: Bytes32.fromHex(slot.value.slice(2)),
                });
            });

        // Build leaves
        const leaves = buildLeaves(contractStorageSlots);

        // Pick an index
        let randomIndex =
            sp1ConsensusMPTPlonkProof.contract_storage_slots.length - 1;

        // Find Value
        const slotToFind = contractStorageSlots.find(
            (_, idx) => idx === randomIndex
        );

        if (!slotToFind) throw new Error(`Slot at ${randomIndex} not found`);

        // Compute path
        const path = getMerklePathFromLeaves([...leaves], randomIndex);

        // Compute root
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(
            leaves.length
        );
        const rootHash = foldMerkleLeft(
            leaves,
            paddedSize,
            depth,
            getMerkleZeros(depth)
        );

        // Build ZK input
        const input = new MerkleTreeLeafAttestorInput({
            rootHash,
            path,
            index: UInt64.from(randomIndex),
            value: slotToFind,
        });

        logger.log(`Generated input ${JSON.stringify(input)}`);

        let start = Date.now();
        const output = await MerkleTreeLeafAttestor.compute(input);
        let durationMs = Date.now() - start;
        logger.log(`MerkleValidator.compute took ${durationMs}ms`);

        expect(!!output.proof.publicOutput.toBigInt()).toBe(true);
    });

    describe('Merkle Attestor Dummy Test', () => {
        test('test_all_leaf_counts_and_indices_with_pipeline', async () => {
            // Analyse zk program
            const merkleTreeLeafAttestorAnalysis =
                await MerkleTreeLeafAttestor.analyzeMethods();
            logger.log(
                `MerkleTreeLeafAttestor analyze methods gates length '${merkleTreeLeafAttestorAnalysis.compute.gates.length}'.`
            );

            // Build zk program
            const { verificationKey } = await MerkleTreeLeafAttestor.compile({
                forceRecompile: true,
            });
            logger.log(
                `MerkleTreeLeafAttestor contract compiled vk: '${verificationKey.hash}'.`
            );

            const maxLeaves = 50;
            const maxDepth = Math.ceil(Math.log2(maxLeaves)) || 1;
            const zeros = getMerkleZeros(maxDepth);

            console.log(
                'Testing all leaf counts and indices with both fold and circuit...'
            );

            for (let nLeaves = 0; nLeaves <= maxLeaves; nLeaves++) {
                console.log(`→ Testing with ${nLeaves} leaves`);

                const pairs: Array<[Bytes20, Bytes32]> = [];
                for (let i = 0; i < nLeaves; i++) {
                    pairs.push([dummyAddress(i), dummyValue(i)]);
                }

                const contractStorageSlots: ProvableLeafValue[] = [];
                for (let i = 0; i < nLeaves; i++) {
                    contractStorageSlots.push(
                        new ProvableLeafValue({
                            address: pairs[i][0],
                            value: pairs[i][1],
                        })
                    );
                }

                const leaves = buildLeaves(contractStorageSlots);

                /*console.log(
                    `   leaves ${leaves.map((l) =>
                        l.toJSON().split('\n').join(' ,')
                    )}`
                );*/

                const rustLeaves = buildLeavesRust(pairs);

                const { depth, paddedSize } =
                    computeMerkleTreeDepthAndSize(nLeaves);
                console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

                console.log(
                    'LEAVES COMPARISON',
                    JSON.stringify(leaves),
                    JSON.stringify(rustLeaves)
                );
                expect(leaves).toEqual(rustLeaves);

                const rootViaFold = foldMerkleLeft(
                    rustLeaves,
                    paddedSize,
                    depth,
                    zeros
                );
                console.log(`   rootViaFold = ${rootViaFold}`);

                for (let index = 0; index < nLeaves; index++) {
                    const pathFold = getMerklePathFromLeaves(
                        leaves.slice(),
                        index
                    );

                    const slotToFind = contractStorageSlots[index];

                    const input = new MerkleTreeLeafAttestorInput({
                        rootHash: rootViaFold,
                        path: pathFold,
                        index: UInt64.from(index),
                        value: slotToFind,
                    });

                    const output = await MerkleTreeLeafAttestor.compute(input);
                    expect(output.proof.publicOutput.toBigInt()).toBe(
                        rootViaFold.toBigInt()
                    );

                    console.log(
                        `     ✅ [nLeaves=${nLeaves}, index=${index}] OK`
                    );
                }
            }
        }, 1000000000);
    });
});
