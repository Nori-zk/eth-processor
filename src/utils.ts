import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { UInt64 } from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { EthVerifier } from './EthVerifier.js';
import { EthProcessor } from './EthProcessor.js';
import { PlonkProof, Bytes32 } from './types.js';
import { ethVerifierVkHash } from './integrity/EthVerifier.VKHash.js';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash.js';

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

export async function compileAndVerifyContracts(logger: Logger) {
    try {
        logger.log('Compiling EthVerifier contract.');
        const ethVerifierVerificationKey = (await EthVerifier.compile())
            .verificationKey;

        const calculatedEthVerifierVkHash =
            ethVerifierVerificationKey.hash.toString();
        logger.log(
            `Verifier contract vk hash compiled: '${calculatedEthVerifierVkHash}'.`
        );

        logger.log('Compiling EthProcessor contract.');
        const ethProcessorVerificationKey = (await EthProcessor.compile())
            .verificationKey;

        // console.log(await EthProcessor.analyzeMethods()); // Used for debugging to make sure our contract compiles fully

        const calculatedEthProcessorVKHash =
            ethProcessorVerificationKey.hash.toString();
        logger.log(
            `EthProcessor contract vk hash compiled: '${calculatedEthProcessorVKHash}'.`
        );

        // Validation
        logger.log('Verifying computed Vk hashes.');

        let disagree: string[] = [];

        if (calculatedEthVerifierVkHash !== ethVerifierVkHash) {
            disagree.push(
                `Computed ethVerifierVkHash '${calculatedEthVerifierVkHash}' disagrees with the one cached within this repository '${ethVerifierVkHash}'.`
            );
        }

        if (calculatedEthProcessorVKHash !== ethProcessorVkHash) {
            disagree.push(
                `Computed ethProcessorVKHash '${calculatedEthProcessorVKHash}' disagrees with the one cached within this repository '${ethProcessorVkHash}'.`
            );
        }

        if (disagree.length) {
            disagree.push(
                `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' in the eth-processor repository and commit the change?`
            );
            const errStr = disagree.join('\n');
            throw new Error(errStr);
        }

        logger.log('Contracts compiled.');
        return { ethVerifierVerificationKey, ethProcessorVerificationKey };
    } catch (err) {
        console.log((err as any).stack);
        logger.error(`Error compiling contracts:\n${String(err)}`);
        throw err;
    }
}

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.dirname(__filename);
