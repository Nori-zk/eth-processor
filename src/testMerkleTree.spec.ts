import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { DynamicArray } from 'mina-attestations';
import {
    Bool,
    Field,
    Poseidon,
    Provable,
    Struct,
    UInt64,
    ZkProgram,
} from 'o1js';

const MerklePath = DynamicArray(Field, { maxLength: 16 });

class MerkleValidatorInput extends Struct({
    rootHash: Field,
    path: MerklePath,
    index: UInt64,
    value: Field,
}) {}

const MerkleValidator = ZkProgram({
    name: 'MerkleValidator',
    publicInput: MerkleValidatorInput,
    publicOutput: Bool,
    methods: {
        compute: {
            privateInputs: [],
            async method(input: MerkleValidatorInput) {
                let { index, value, path, rootHash } = input;

                let currentHash = Poseidon.hash([value]);

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

                    const left = Provable.if(bit, Field, sibling, currentHash);
                    const right = Provable.if(bit, Field, currentHash, sibling);
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

function hashLeaves(values: Field[]): Field[] {
    return values.map((v) => Poseidon.hash([v]));
}

function computeMerkleRoot(leavesInput: Field[]): Field {
    const leaves = hashLeaves(leavesInput);

    const depth = Math.ceil(Math.log2(leaves.length));
    const paddedSize = 1 << depth;

    const dummyLeaf = Poseidon.hash([Field(0)]);
    while (leaves.length < paddedSize) {
        leaves.push(dummyLeaf);
    }

    let level = leaves;
    while (level.length > 1) {
        const nextLevel: Field[] = [];
        for (let i = 0; i < level.length; i += 2) {
            nextLevel.push(Poseidon.hash([level[i], level[i + 1]]));
        }
        level = nextLevel;
    }
    return level[0];
}

function getMerklePath(leavesInput: Field[], index: number) {
    const leaves = hashLeaves(leavesInput);
    const depth = Math.ceil(Math.log2(leaves.length));
    const paddedSize = 1 << depth;

    const dummyLeaf = Poseidon.hash([Field(0)]);
    while (leaves.length < paddedSize) {
        leaves.push(dummyLeaf);
    }

    let path: Field[] = [];
    let position = index;

    let level = leaves;
    for (let d = 0; d < depth; d++) {
        let nextLevel: Field[] = [];

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = level[i + 1];
            nextLevel.push(Poseidon.hash([left, right]));
        }

        const isRight = position % 2 === 1;
        const siblingIndex = isRight ? position - 1 : position + 1;
        path.push(level[siblingIndex]);

        position = Math.floor(position / 2);
        level = nextLevel;
    }

    const merklePath = MerklePath.from([]);
    path.forEach((element) => merklePath.push(element));
    return merklePath;
}

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

describe('MerkleTree', () => {
    test('tree should compile and perform zk find in merklised list', async () => {
        logger.log('Creating test list');

        const list: Field[] = [];
        for (let i = 0; i < 60000; i++) {
            list.push(Field(i));
        }

        logger.log(`Created list of length ${list.length}`);

        logger.log(`Calculating root hash`);
        const rootHash = computeMerkleRoot(list);
        logger.log(`Computed root hash: ${rootHash}`);

        const index = 30000;
        const path = getMerklePath(list, index);
        logger.log(`Merkle path for index ${index}: ${path.array}`);

        const merkleValidatorMethodsAnalysis =
            await MerkleValidator.analyzeMethods();
        logger.log(
            `MerkleValidator analyze methods gates length '${merkleValidatorMethodsAnalysis.compute.gates.length}'.`
        );

        const { verificationKey } = await MerkleValidator.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleValidator contract compiled vk: '${verificationKey.hash}'.`
        );

        const input = new MerkleValidatorInput({
            rootHash,
            path,
            index: UInt64.from(index),
            value: list[index],
        });
        logger.log(`Generated input ${JSON.stringify(input)}`);

        const start = Date.now();
        const output = await MerkleValidator.compute(input);
        const durationMs = Date.now() - start;
        logger.log(`MerkleValidator.compute took ${durationMs}ms`);

        expect(output.proof.publicOutput.toBoolean()).toBe(true);
    });
});
