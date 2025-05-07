import { PlonkProof } from './interfaces';
import { ethers } from 'ethers';
import { Bytes32 } from './EthVerifier.js';
import { UInt64 } from 'o1js';

export function decodeProof(ethSP1Proof: PlonkProof) {
    const defaultEncoder = ethers.AbiCoder.defaultAbiCoder();
    const decoded = defaultEncoder.decode(
        [
            'bytes32',
            'bytes32',
            'bytes32',
            'uint64',
            'bytes32',
            'uint64',
            'bytes32',
            'bytes32',
            'bytes32',
            'bytes32',
        ],
        new Uint8Array(Buffer.from(ethSP1Proof.public_values.buffer.data))
    );

    return {
        executionStateRoot: Bytes32.fromHex(decoded[0].slice(2)),
        newHeader: Bytes32.fromHex(decoded[1].slice(2)),
        nextSyncCommitteeHash: Bytes32.fromHex(decoded[2].slice(2)),
        newHead: UInt64.from(decoded[3]),
        prevHeader: Bytes32.fromHex(decoded[4].slice(2)),
        prevHead: UInt64.from(decoded[5]),
        syncCommitteeHash: Bytes32.fromHex(decoded[6].slice(2)),
        startSyncCommitteeHash: Bytes32.fromHex(decoded[7].slice(2)),
        prevStoreHash: Bytes32.fromHex(decoded[8].slice(2)),
        storeHash: Bytes32.fromHex(decoded[9].slice(2)),
    };
}
