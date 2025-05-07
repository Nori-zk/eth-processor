// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    AccountUpdate,
    NetworkId,
    fetchAccount,
    Cache,
} from 'o1js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import rootDir from '../utils.js';
import { EthProcessor } from '../EthProcessor.js';
import { EthVerifier } from '../EthVerifier.js';
import { ethVerifierVkHash } from '../integrity/EthVerifier.VKHash.js';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('Deploy');

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const missingEnvVariables: string[] = [];

// Declare sender private key
const deployerKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;

// Get or generate a zkAppPrivateKey
let zkAppPrivateKeyWasCreated = false;
if (!process.env.ZKAPP_PRIVATE_KEY) {
    zkAppPrivateKeyWasCreated = true;
    logger.log('ZKAPP_PRIVATE_KEY not set, generating a random key.');
}
let zkAppPrivateKeyBase58 =
    process.env.ZKAPP_PRIVATE_KEY ?? PrivateKey.random().toBase58();
if (zkAppPrivateKeyWasCreated) {
    logger.log(`Created a new ZKAppPrivate key.`);
}

// Validate
if (!deployerKeyBase58) missingEnvVariables.push('SENDER_PRIVATE_KEY');
if (!zkAppPrivateKeyBase58) missingEnvVariables.push('ZKAPP_PRIVATE_KEY');
if (missingEnvVariables.length > 0) {
    logger.fatal(
        `Missing required environment variable(s): ${missingEnvVariables.join(
            ' and '
        )}`
    );
    process.exit(1);
}

// Network configuration
const networkUrl =
    process.env.MINA_RPC_NETWORK_URL || 'http://localhost:3000/graphql'; // Should probably validate here the network type. FIXME
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)

function writeSuccessDetailsToEnvFileFile(zkAppAddressBase58: string) {
    // Write env file.
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58,
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(
        rootDir,
        '..',
        '..',
        '.env.nori-eth-processor'
    );
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    // Initialize keys
    const deployerKey = PrivateKey.fromBase58(deployerKeyBase58);
    const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();

    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Compile contracts

    // Compile verifier
    logger.log('Compiling EthVerifier.');
    const vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
        .verificationKey;
    const calculatedEthVerifierVkHash = vk.hash.toString();
    logger.log(`EthVerifier contract compiled vk: '${calculatedEthVerifierVkHash}'.`);

    // Compile processor
    const pVK = await EthProcessor.compile({
        cache: Cache.FileSystemDefault,
    });
    logger.log('Compiling EthProcessor.');
    const calculatedEthProcessorVKHash = pVK.verificationKey.hash.toString();
    logger.log(`EthProcessor contract compiled vk: '${calculatedEthProcessorVKHash}'.`);

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

    // Configure Mina network
    const Network = Mina.Network({
        networkId: 'testnet' as NetworkId,
        mina: networkUrl,
    });
    Mina.setActiveInstance(Network);

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    logger.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            AccountUpdate.fundNewAccount(deployerAccount);
            //await zkApp.deploy(); //FIXME
        }
    );

    await txn.prove();
    const signedTx = txn.sign([deployerKey, zkAppPrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: zkAppAddress });
    const currentAdmin = await zkApp.admin.fetch();
    logger.log('Deployment successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);

    writeSuccessDetailsToEnvFileFile(
        zkAppAddressBase58
    );
}

// Execute deployment
deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
