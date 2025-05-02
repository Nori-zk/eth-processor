import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { Cache } from 'o1js';
import { EthVerifier } from '../EthVerifier.js';
import { EthProcessor } from '../EthProcessor.js';
import rootDir from '../utils.js';

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const logger = new Logger('CompileZksAndBakeVkHashes');

function writeSuccessDetailsToJsonFiles(
    ethVerifierVkHash: string,
    ethProcessorVKHash: string
) {
    // Write vks
    const ethProcessorVkHashFileOutputPath = resolve(
        rootDir,
        '..',
        '..',
        'src',
        'integrity',
        'EthProcessor.VkHash.json'
    );
    const ethVerifierVkHashFileOutputPath = resolve(
        rootDir,
        '..',
        '..',
        'src',
        'integrity',
        'EthVerifier.VkHash.json'
    );
    logger.log(
        `Writing vks hashes to '${ethProcessorVkHashFileOutputPath}' and '${ethVerifierVkHashFileOutputPath}'`
    );
    writeFileSync(
        ethProcessorVkHashFileOutputPath,
        `"${ethProcessorVKHash}"`,
        'utf8'
    );
    writeFileSync(
        ethVerifierVkHashFileOutputPath,
        `"${ethVerifierVkHash}"`,
        'utf8'
    );
    logger.log(
        `Wrote vks hashes to '${ethProcessorVkHashFileOutputPath}' and '${ethVerifierVkHashFileOutputPath}' successfully.`
    );
}

async function main() {
    // Compile verifier
    logger.log('Compiling EthVerifier.');
    const vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
        .verificationKey;
    const ethVerifierVkHash = vk.hash.toString();
    logger.log(`EthVerifier contract compiled vk: '${ethVerifierVkHash}'.`);
    // logger.log(`EthVerifier analyze methods output:\n${JSON.stringify(await EthVerifier.analyzeMethods())}`);

    // Compile processor
    const pVK = await EthProcessor.compile({
        cache: Cache.FileSystemDefault,
    });
    logger.log('Compiling EthProcessor.');
    const ethProcessorVKHash = pVK.verificationKey.hash.toString();
    logger.log(`EthProcessor contract compiled vk: '${ethProcessorVKHash}'.`);
    // logger.log(`EthProcessor analyze methods output:\n${JSON.stringify(await EthProcessor.analyzeMethods())}`);

    writeSuccessDetailsToJsonFiles(ethVerifierVkHash, ethProcessorVKHash);
}

main().catch((err) => {
    logger.fatal(`Main function had an error: ${String(err)}`);
});
