import { Field, Poseidon } from 'o1js';

import {
    computeMerkleTreeDepthAndSize,
    getMerkleZeros,
    buildMerkleTree,
    foldMerkleLeft,
    getMerklePathFromTree,
    computeMerkleRootFromPath,
    getMerklePath,
} from './merkle.js';
import { Bytes20, Bytes32 } from './types.js';

function dummyAddress(byte: number): Bytes20 {
    const arr = new Uint8Array(20).fill(byte);
    return Bytes20.from(arr);
}

function dummyValue(byte: number): Bytes32 {
    const arr = new Uint8Array(32).fill(byte);
    return Bytes32.from(arr);
}

function hashStorageSlot(addr: Bytes20, value: Bytes32): Field {
    const addrBytes = addr.toBytes();
    const valueBytes = value.toBytes();

    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(addrBytes, 0); // first 20 bytes from address
    firstFieldBytes[20] = valueBytes[0]; // 21st byte from value

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(valueBytes.slice(1, 32), 0); // remaining 31 bytes from value

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));

    return Poseidon.hash([firstField, secondField]);
}

// Build leaf hashes from pairs of (Address, FixedBytes32)
function buildLeaves(pairs: Array<[Bytes20, Bytes32]>): Field[] {
    return pairs.map(([addr, val]) => hashStorageSlot(addr, val));
}

// Full Merkle lifecycle test using actual hashed leaves and leaf index
function fullMerkleTest(
    pairs: Array<[Bytes20, Bytes32]>,
    leafIndex: number
): void {
    const leaves = buildLeaves(pairs);
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    const zeros = getMerkleZeros(depth);

    const leavesClone = leaves.slice();
    const root = foldMerkleLeft(leavesClone, paddedSize, depth, zeros);

    const leavesForPath = leaves.slice();
    const path = getMerklePath(
        leavesForPath,
        paddedSize,
        depth,
        leafIndex,
        zeros
    );

    const leafHash = leaves[leafIndex] ?? Field(0);
    const recomputedRoot = computeMerkleRootFromPath(leafHash, leafIndex, path);

    expect(recomputedRoot.equals(root).toBoolean()).toBe(true);
}

describe('Merkle Fixed Tests', () => {
    test('test_large_slots', () => {
        const n = 1000;
        const pairs: Array<[Bytes20, Bytes32]> = [];
        for (let i = 0; i < n; i++) {
            pairs.push([dummyAddress(i), dummyValue(i)]);
        }
        fullMerkleTest(pairs, 543);
    });

    test('test_hash_storage_slot_basic', () => {
        const address = dummyAddress(1);
        const value = dummyValue(2);
        const leafHash = hashStorageSlot(address, value);
        expect(leafHash.equals(Field(0)).toBoolean()).toBe(false);
    });

    test('test_all_leaf_counts_and_indices_with_build_and_fold', () => {
        const maxLeaves = 50;

        // Calculate max depth from maxLeaves
        const maxDepth = Math.ceil(Math.log2(maxLeaves)) || 1;

        // Precompute zeros
        const zeros = getMerkleZeros(maxDepth);

        console.log(
            'Testing all leaf counts and indices with both fold and build...'
        );

        for (let nLeaves = 0; nLeaves <= maxLeaves; nLeaves++) {
            console.log(`→ Testing with ${nLeaves} leaves`);

            const pairs: Array<[Bytes20, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyAddress(i), dummyValue(i)]);
            }

            const leaves = buildLeaves(pairs);
            console.log(
                `   leaves ${leaves.map((l) =>
                    l.toJSON().split('\n').join(' ,')
                )}`
            );
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);

            console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

            const rootViaFold = foldMerkleLeft(
                leaves.slice(),
                paddedSize,
                depth,
                zeros
            );
            console.log(`   rootViaFold = ${rootViaFold}`);

            const merkleTree = buildMerkleTree(
                leaves,
                paddedSize,
                depth,
                zeros
            );
            console.log(`   rootViaBuild = ${merkleTree[0][0]}`);

            expect(merkleTree[0][0].equals(rootViaFold).toBoolean()).toBe(true);

            // Verify leaf layer padding
            const expectedPadded = leaves.slice();
            while (expectedPadded.length < paddedSize) {
                expectedPadded.push(Field(0));
            }
            expect(merkleTree[depth]).toEqual(expectedPadded);

            for (let index = 0; index < nLeaves; index++) {
                const leavesForPath = leaves.slice();

                const pathFold = getMerklePath(
                    leavesForPath,
                    paddedSize,
                    depth,
                    index,
                    zeros
                );
                const pathBuild = getMerklePathFromTree(merkleTree, index);

                expect(pathFold).toEqual(pathBuild);

                const leafHash = leaves[index];
                const recomputedRoot = computeMerkleRootFromPath(
                    leafHash,
                    index,
                    pathFold
                );

                expect(recomputedRoot.equals(rootViaFold).toBoolean()).toBe(
                    true
                );

                console.log(`     ✅ [nLeaves=${nLeaves}, index=${index}] OK`);
            }
        }
    });
});
