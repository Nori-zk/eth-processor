import { DynamicArray } from 'mina-attestations';
import {
    Bool,
    Field,
    InferJson,
    InferProvable,
    InferValue,
    IsPure,
    Poseidon,
    Provable,
    Struct,
    UInt64,
    ZkProgram,
} from 'o1js';
import { Bytes20, Bytes32 } from './types';
import {
    computeMerkleTreeDepthAndSize,
    getMerklePathFromLeaves as getMerklePathFromLeavesInner,
    getMerkleZeros,
} from './merkleTree';
//import { Constructor } from 'mina-attestations/build/src/types';

type ProvableLike =
    | { prototype: { toJSON: (...args: any[]) => any } }
    | { provable: { toJSON: (...args: any[]) => any } };

export type LeafContentsType = Record<string, ProvableLike>;

export type LeafInstance<T extends LeafContentsType> = {
    [K in keyof T]: T[K] extends new (...args: any[]) => infer I ? I : never;
};

type Constructor<T = any> = new (...args: any) => T;

export function getMerkleLeafAttestorGenerator<TLeaf>( // extends Struct<any>
    treeDepth: number,
    name: string,
    provableLeafType: Constructor<TLeaf>,
    leafContentsHasher: (leaf: TLeaf) => Field
) {
    const MerklePath = DynamicArray(Field, { maxLength: treeDepth });

    class MerkleTreeLeafAttestorInput extends Struct({
        rootHash: Field,
        path: MerklePath,
        index: UInt64,
        value: provableLeafType,
    }) {}

    const MerkleTreeLeafAttestor = ZkProgram({
        name: name,
        publicInput: MerkleTreeLeafAttestorInput,
        publicOutput: Bool,
        methods: {
            compute: {
                privateInputs: [],
                async method(input: MerkleTreeLeafAttestorInput) {
                    let { index, path, rootHash } = input; // value

                    let currentHash = leafContentsHasher(input.value as TLeaf); //Poseidon.hash([value]);

                    Provable.asProver(() => {
                        Provable.log(`Finding index i ${index}`);
                    });

                    Provable.asProver(() => {
                        Provable.log(`Generated hash of value ${currentHash}`);
                    });

                    path.forEach((sibling, isDummy, i) => {
                        const bitPath = index.value.toBits(path.maxLength);
                        const bit = bitPath[i];

                        Provable.asProver(() => {
                            Provable.log(
                                `Path index i ${i}, bit ${bit}, bit path ${bitPath.map(
                                    (i) => (i.toBoolean() ? 1 : 0)
                                )} isDummy ${isDummy}`
                            );
                        });

                        const left = Provable.if(
                            bit,
                            Field,
                            sibling,
                            currentHash
                        );
                        const right = Provable.if(
                            bit,
                            Field,
                            currentHash,
                            sibling
                        );
                        const nextHash = Poseidon.hash([left, right]);

                        Provable.asProver(() => {
                            Provable.log(
                                `Path index i ${i}, left ${left}, right ${right}`
                            );
                        });

                        currentHash = Provable.if(
                            isDummy,
                            Field,
                            currentHash,
                            nextHash
                        );
                    });

                    Provable.asProver(() => {
                        Provable.log(
                            `Got to assert root ${rootHash}, current ${currentHash}`
                        );
                    });
                    currentHash.assertEquals(rootHash);
                    return { publicOutput: Bool(true) };
                },
            },
        },
    });

    function buildLeaves(leafContents: TLeaf[]): Field[] {
        return leafContents.map((leaf) =>
            leafContentsHasher(
                leaf //as unknown as LeafInstance<LeafContentsInnerType>
            )
        );
    }

    function getMerklePathFromLeaves(merkleLeaves: Field[], index: number) {
        const nLeaves = merkleLeaves.length;
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
        const path = getMerklePathFromLeavesInner(
            merkleLeaves,
            paddedSize,
            depth,
            index,
            getMerkleZeros(depth)
        );
        const merklePath = MerklePath.from([]);
        path.forEach((element) => merklePath.push(element));
        return merklePath;
    }

    type MerkleTreeLeafAttestorInputConstructor = new (arg: {
        rootHash: Field;
        path: InstanceType<typeof MerklePath>;
        index: UInt64;
        value: TLeaf;
    }) => {
        rootHash: Field;
        path: InstanceType<typeof MerklePath>;
        index: UInt64;
        value: typeof provableLeafType;
    };

    const inputs = MerkleTreeLeafAttestorInput as unknown as MerkleTreeLeafAttestorInputConstructor;

    return {
        MerkleTreeLeafAttestorInput: inputs,
        MerkleTreeLeafAttestor,
        buildLeaves,
        getMerklePathFromLeaves,
    };
}
