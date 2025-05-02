import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { resolve } from 'path';
import { Cache } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
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

const ephemeralCacheDir = resolve(rootDir, randomBytes(20).toString('base64').replace(/[+/=]/g, ''));

async function main() {
    // Create a temporary folder to compile the cache to, this is nessesary as the forceRecompile option
    // seems to be ignored.
    mkdirSync(ephemeralCacheDir, {recursive: true});
    logger.log(`Created ephemeral caches directory for eth programs '${ephemeralCacheDir}'`);

    // Compile verifier
    logger.log('Compiling EthVerifier.');
    const vk = (await EthVerifier.compile({ cache: Cache.FileSystem(ephemeralCacheDir), forceRecompile: true }))
        .verificationKey;
    const ethVerifierVkHash = vk.hash.toString();
    logger.log(`EthVerifier contract compiled vk: '${ethVerifierVkHash}'.`);
    // logger.log(`EthVerifier analyze methods output:\n${JSON.stringify(await EthVerifier.analyzeMethods())}`);

    // Compile processor
    const pVK = await EthProcessor.compile({ cache: Cache.FileSystem(ephemeralCacheDir), forceRecompile: true });
    logger.log('Compiling EthProcessor.');
    const ethProcessorVKHash = pVK.verificationKey.hash.toString();
    logger.log(`EthProcessor contract compiled vk: '${ethProcessorVKHash}'.`);
    // logger.log(`EthProcessor analyze methods output:\n${JSON.stringify(await EthProcessor.analyzeMethods())}`);

    rmSync(ephemeralCacheDir);
    writeSuccessDetailsToJsonFiles(ethVerifierVkHash, ethProcessorVKHash);
}

main().catch((err) => {
    logger.fatal(`Main function had an error: ${String(err)}`);
    rmSync(ephemeralCacheDir);
    process.exit(1);
});
