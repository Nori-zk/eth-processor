import { Logger } from '@nori-zk/proof-conversion';
import { EthVerifier } from './EthVerifier.js';
import { EthProcessor } from './EthProcessor.js';
import { ethVerifierVkHash } from './integrity/EthVerifier.VKHash';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash';

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
