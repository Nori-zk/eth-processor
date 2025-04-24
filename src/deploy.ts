import {
    Mina,
    PrivateKey,
    AccountUpdate,
    NetworkId,
    fetchAccount,
    Cache,
} from 'o1js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { EthProcessor } from './EthProcessor.js';
import { EthVerifier } from './EthVerifier.js';
// Load environment variables from .env file
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import rootDir from './utils.js';

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

function writeSuccessDetailsToFiles(
    zkAppAddressBase58: string,
    ethVerifierVkHash: string,
    ethProcessorVKHash: string
) {
    // Write env file.
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '..', '.env.nori-eth-processor');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(
        envFileOutputPath,
        envFileStr,
        'utf8'
    );
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);

    // Write vks
    const ethProcessorVkHashFileOutputPath = resolve(rootDir, '..', '..', 'src', 'vks', 'EthProcessor.VkHash.json');
    const ethVerifierVkHashFileOutputPath = resolve(rootDir, '..', '..', 'src', 'vks', 'EthVerifier.VkHash.json');
    logger.log(`Writing vks hashes to '${ethProcessorVkHashFileOutputPath}' and '${ethVerifierVkHashFileOutputPath}'`);
    writeFileSync(
        ethProcessorVkHashFileOutputPath,
        `"${ethVerifierVkHash}"`,
        'utf8'
    );
    writeFileSync(
        ethVerifierVkHashFileOutputPath,
        `"${ethProcessorVKHash}"`,
        'utf8'
    );
    logger.log(`Wrote vks hashes to '${ethProcessorVkHashFileOutputPath}' and '${ethVerifierVkHashFileOutputPath}' successfully.`);

}

async function deploy() {
    // Initialize keys
    const deployerKey = PrivateKey.fromBase58(deployerKeyBase58);
    const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();

    logger.log(`Deployer address: ${deployerAccount.toBase58()}`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Compile contracts

    // Compile verifier
    logger.log('Compiling EthVerifier.');
    const vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
        .verificationKey;
    const ethVerifierVkHash = vk.hash.toString();
    logger.log(`EthVerifier contract compiled vk: '${ethVerifierVkHash}'.`);

    // Compile processor
    const pVK = await EthProcessor.compile({
        cache: Cache.FileSystemDefault,
    });
    logger.log('Compiling EthProcessor.');
    const ethProcessorVKHash = pVK.verificationKey.hash.toString();
    logger.log(`EthProcessor contract compiled vk: '${ethProcessorVKHash}'.`);

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
            await zkApp.deploy();
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

    writeSuccessDetailsToFiles(zkAppAddressBase58, ethVerifierVkHash, ethProcessorVKHash);
}

// Execute deployment
deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
