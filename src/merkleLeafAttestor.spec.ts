import { Bytes, Field, Poseidon, Provable, Struct, UInt64, UInt8 } from 'o1js';
import {
    getMerkleLeafAttestorGenerator,
    LeafContentsType,
    LeafInstance,
} from './merkleLeafAttestor.js';
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

class ProvableLeafValue extends Struct({
    address: Bytes20.provable,
    value: Bytes32.provable,
}) {}

function hashLeafContents(leafContents: ProvableLeafValue) {
  const addrBytes = leafContents.address.bytes;  // UInt8[]
  const valueBytes = leafContents.value.bytes;  // UInt8[]

  // We want 20 bytes from addrBytes + 1 byte from valueBytes + remaining 31 bytes from valueBytes

  // firstFieldBytes: 20 bytes from addrBytes + 1 byte from valueBytes
  const firstFieldBytes: UInt8[] = [];

  for (let i = 0; i < 20; i++) {
    firstFieldBytes.push(addrBytes[i]);
  }
  firstFieldBytes.push(valueBytes[0]);

  // Pad to 32 bytes if needed
  while (firstFieldBytes.length < 32) {
    firstFieldBytes.push(UInt8.zero);
  }

  // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31)
  const secondFieldBytes: UInt8[] = [];
  for (let i = 1; i < 32; i++) {
    secondFieldBytes.push(valueBytes[i]);
  }

  // Pad to 32 bytes if needed
  while (secondFieldBytes.length < 32) {
    secondFieldBytes.push(UInt8.zero);
  }

  // Convert UInt8[] to Bytes (provable bytes)
  const firstBytes = Bytes.from(firstFieldBytes);
  const secondBytes = Bytes.from(secondFieldBytes);

  const firstField = firstBytes.toFields()[0];
  const secondField = secondBytes.toFields()[0];

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

        expect(output.proof.publicOutput.toBoolean()).toBe(true);
    });
});
