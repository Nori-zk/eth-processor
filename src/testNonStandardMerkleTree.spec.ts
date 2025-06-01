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

const MAX_ITEMS_IN_LIST = 60000;
const PATH_MAX_LENGTH = Math.ceil(Math.log2(MAX_ITEMS_IN_LIST)) - 1;

const MerklePath = DynamicArray(Field, { maxLength: PATH_MAX_LENGTH });

class NonStandardMerkleValidatorInput extends Struct({
    rootHash: Field,
    firstSibling: Field,
    path: MerklePath,
    index: UInt64,
    value: Field,
}) {}

const NonStandardMerkleValidator = ZkProgram({
    name: 'NonStandardMerkleValidator',
    publicInput: NonStandardMerkleValidatorInput,
    publicOutput: Bool,
    methods: {
        compute: {
            privateInputs: [],
            async method(input: NonStandardMerkleValidatorInput) {
                let { index, value, path, rootHash, firstSibling } = input;

                let currentHash = value;

                Provable.asProver(() => {
                    Provable.log(`Finding index i ${index}`);
                });

                Provable.asProver(() => {
                    Provable.log(
                        `Value ${value}. First sibling ${firstSibling}`
                    );
                });

                const fullBitPathLE = index.value.toBits(path.maxLength + 1);
                const firstBit = fullBitPathLE[0];

                const firstLeft = Provable.if(firstBit, Field, firstSibling, value);
                const firstRight = Provable.if(firstBit, Field, value, firstSibling);
                currentHash = Poseidon.hash([firstLeft, firstRight]);

                Provable.asProver(() => {
                    Provable.log(`Hashed with first sibling ${currentHash}`);
                });

                const bitPath = fullBitPathLE.slice(1);

                path.forEach((sibling, isDummy, i) => {
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
    const leaves = [...leavesInput]; //hashLeaves(leavesInput);

    const depth = Math.ceil(Math.log2(leaves.length));
    const paddedSize = 1 << depth;

    const dummyLeaf = Field(0);
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
    const leaves = [...leavesInput]; 
    //const depth = Math.ceil(Math.log2(leaves.length));
    const depth = leaves.length <= 1 ? 0 : Math.ceil(Math.log2(leaves.length));
    const paddedSize = 1 << depth;

    const dummyLeaf = Field(0);
    while (leaves.length < paddedSize) {
        leaves.push(dummyLeaf);
    }

    let allSiblings: Field[] = [];
    let position = index;

    let level = leaves;
    for (let d = 0; d < depth; d++) {
        const isRight = position % 2 === 1;
        const siblingIndex = isRight ? position - 1 : position + 1;
        allSiblings.push(level[siblingIndex]);

        let nextLevel: Field[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = level[i + 1];
            nextLevel.push(Poseidon.hash([left, right]));
        }

        position = Math.floor(position / 2);
        level = nextLevel;
    }

    // Extract first sibling and remaining path
    const firstSibling = allSiblings[0];
    const path = allSiblings.slice(1);

    const merklePath = MerklePath.from(path);
    return { firstSibling, merklePath };
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

describe('NonStandardMerkleTree', () => {
    test('non standard tree should compile and perform zk find in merklised list', async () => {
        logger.log('Creating test list');

        const list: Field[] = [];
        for (let i = 0; i < MAX_ITEMS_IN_LIST; i++) {
            list.push(Field(i));
        }

        logger.log(`Created list of length ${list.length}`);

        logger.log(`Calculating root hash`);
        const rootHash = computeMerkleRoot(list);
        logger.log(`Computed root hash: ${rootHash}`);

        const index = 2; //Math.round(MAX_ITEMS_IN_LIST / 2);
        let start = Date.now();
        const { firstSibling, merklePath } = getMerklePath(list, index);
        let durationMs = Date.now() - start;
        logger.log(
            `Merkle path gotten for index ${index} in '${durationMs}ms'. First sibling: ${firstSibling}, Path(${merklePath.array.length}): ${merklePath.array}`
        );

        const merkleValidatorMethodsAnalysis =
            await NonStandardMerkleValidator.analyzeMethods();
        logger.log(
            `MerkleValidator analyze methods gates length '${merkleValidatorMethodsAnalysis.compute.gates.length}'.`
        );

        const { verificationKey } = await NonStandardMerkleValidator.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleValidator contract compiled vk: '${verificationKey.hash}'.`
        );

        const input = new NonStandardMerkleValidatorInput({
            rootHash,
            firstSibling,
            path: merklePath,
            index: UInt64.from(index),
            value: list[index],
        });
        logger.log(`Generated input ${JSON.stringify(input)}`);

        start = Date.now();
        const output = await NonStandardMerkleValidator.compute(input);
        durationMs = Date.now() - start;
        logger.log(`MerkleValidator.compute took ${durationMs}ms`);

        expect(output.proof.publicOutput.toBoolean()).toBe(true);
    });
});
