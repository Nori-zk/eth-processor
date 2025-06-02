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

    //const depth = Math.ceil(Math.log2(leaves.length));
    const depth = leaves.length <= 1 ? 0 : Math.ceil(Math.log2(leaves.length));
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
    //const depth = Math.ceil(Math.log2(leaves.length));
    const depth = leaves.length <= 1 ? 0 : Math.ceil(Math.log2(leaves.length));
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
    test('normal tree should compile and perform zk find in merklised list', async () => {
        logger.log('Creating test list');

        const list: Field[] = [];
        for (let i = 0; i < 60000; i++) {
            list.push(Field(i));
        }

        logger.log(`Created list of length ${list.length}`);

        logger.log(`Calculating root hash`);
        const rootHash = computeMerkleRoot(list);
        logger.log(`Computed root hash: ${rootHash}`);

        const index = 1;
        let start = Date.now();
        const path = getMerklePath(list, index);
        let durationMs = Date.now() - start;
        logger.log(
            `Merkle path gotten for index ${index} in '${durationMs}ms': ${path.array}`
        );

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

        start = Date.now();
        const output = await MerkleValidator.compute(input);
        durationMs = Date.now() - start;
        logger.log(`MerkleValidator.compute took ${durationMs}ms`);

        expect(output.proof.publicOutput.toBoolean()).toBe(true);
    });
});


/**
ff9bbc3b6b1c034b147bedc1c3dfe499c04b31dca010eee64ca189c2ddf1a5bd99016097a6c7bc834597bb386ce61770e157b0b4d8a08d6926208ef0fe9c8c3bfcca28888f50844a97c98933605e734c3c1c97c897aaa02472893ef55587a2fc282d1d96ee5d08f234559df1d4022386bbe5b8d8e22963a0c45873bdde6c90415cd9433ef3784d2a048b6f4f5d9f9945e7ed734ce70f87f4a09803abe7a1baf110568fd1cc44d41981f3e4270270d0e185574238339c694431a0e9e687d5a857e027af99d45e7ca192c4be6eaadfcf632c8b62d13b9b0caa95dfa0081e0f6bfd49f75c7dd9c46560127e03f5b99465c1e1ed61e197b6b4b9bdf5b2a0aa0dfc8b763af1194a8a61817750f63825c947dcaf6a5960295fbd91a10c26c0a0a1d965d834eb3145428ec6ac4e936977df8a8604407bc9abe64a25b3e765f414a0b09c5169d50a1b6a498c8613bef99b51d454c25add7208661738e41051e074d6a053d7ba50dfb819e61cbbea87d2a9469673987abecbb24ad18bcafcfc55545dd4a011fa2e00675373006251f9ab7357beb3fdb5281e3853c125b1f851454b8f6a55a06c1ad03a698f916c95a613d285c8beecd4d77a0ed31de08b99e5352475676a02a095832965cc113d49ad25441aec2ae612f218a1f9017eeb7b5e45cd073639e3b380\",\"0xf90211a0f6c2bbfccd7100a169c63dbac84881cd60e076f1ea03159e9612b8c8492a92bba01634cf87f91029af02f226e7933ac9f2a66e5ae1f7fc3f5a58989664316f8f90a06ca0a700d298d9beb55ebd162c4d206e31833f713e53431d5f70af8255e37825a09db527cfbd46d9dd1f9413a626e91c499830a8e8097ecc903ded0adbfeb36a82a03930410e16f516441b543de960525902f654b7e433574738c4f9983030fbe485a0dbbf40510df8903c623ac5d69b7fdc694413dc50ba9e8ca209eb2ee0e1b4061fa00a2ebd91c2465d89e2fe1dd3c038e9645d06a45bc394adb535e90cddeaeb4bd5a01efd0bcda1679a32e57d2bd819a482a4c1a827b59705e7f0bd7dd804efa344b6a03c1ce7d1bec29f1c06fc0cf296c6c16a7fd61d1de5d9923895fabfc7431dcf9da00cb4f14be8f6682b9e1fdf80de64a55137e8dcafff59def56b80a25ef1e622e0a06bce99e69cdcae824bab9a5a902157f5656dfc2c32bf3f22c783e50e517f678ba0e21078c08157eb89e2d74c27b590bd44403bddc61d22cd029c0222ec18f1ddcca0960c88af08585edaf6a1ecff2d73bbcd255f37c1394bf0a5a5543c95b6922b99a008cbe0a0ada60bebe3918691b94fcbdad648985c8584a5ee312abbfc3cdc0807a0316f48027e1942fc45851187300492a0a52084280f514c58997c1f29f68596a8a0958ad933249dd1c86956bd20f4bc3ab094bd383b2fb10e05f4a21f09859a9bda80\",\"0xf8d18080a074580333f174a9224ddf95a9da48936df1be40869c26910dcfe38cd1c3dca9af808080a06156c61509fd98d20410a73868ba6a5a0da588cf96fe5f3db5803bcb41f113748080a06a06d1ffd56779ae22b09117a32fd761e5db4ec7c4c7a58b9a59d47e8f7d02c9a0163b6a5941df22894cc9392ce8db711439ed765ea4d61dacba6dc45cf9ec7f6280a0ebddef26d36a32fd722704f36dd05cfdbcfde89f9de8ee5bdab0d949342d91eda05a019df1242725a43c7e211e7d066aef753c56fcb12060ec1c5fd2579dd93832808080\",\"0xf86c9d370fcf86515250e96a0c1838898fae2437187d903faf15aca3f77446ebb84cf84a01868eca693ad000a01c32af8c03723e7b8e6fe20e6196ebc6952d97aedf3c0f4ed9df2d4d7a20f150a0c80e026e4e51bb8fb09ad13ebee1c3d500269c07267c5ea865bd05ccce2e2891\"],
\"storage_slots\":[{\"key\":\"0x9da47c6be881a052086bba59a37026a2a73c4c9644f1df0108658ac2392c1189\",\"slot_key_address\":\"0xc7e910807dd2e3f49b34efe7133cfb684520da69\",\"expected_value\":\"0x8eca693ad000\",\"mpt_proof\":[\"0xf8518080a0afd6bf6e58bca0645e59c909304a2ce9aa566ec0b1f6469a7f6063bb494f338480808080808080808080a0028d9820393c64a1fc048299a0ec451bfe3805058d655ae19b6a1c8d1ffaa620808080\",\"0xe9a03b760f603d78647e08c0d1dfdab9b6bd61898c73db19eab110cd6e385b93294587868eca693ad000\"]}]}")

 */