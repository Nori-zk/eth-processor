import {
  Mina,
  PrivateKey,
  AccountUpdate,
  NetworkId,
  fetchAccount,
  Cache,
} from 'o1js';
import { EthProcessor } from './EthProcessor.js';
import { EthVerifier } from './EthVerifier.js';
// Load environment variables from .env file
import 'dotenv/config';
if (!process.env.SENDER_PRIVATE_KEY) {
  throw new Error(
    'Missing required environment variables: SENDER_PRIVATE_KEY '
  );
}
if (!process.env.ZKAPP_PRIVATE_KEY) {
  console.log('ZKAPP_PRIVATE_KEY not set, using random key');
  process.env.ZKAPP_PRIVATE_KEY = PrivateKey.random().toBase58();
  console.log('ZKAPP_PRIVATE_KEY', process.env.ZKAPP_PRIVATE_KEY);
}
const DEPLOYER_KEY = process.env.SENDER_PRIVATE_KEY;
const ZKAPP_KEY = process.env.ZKAPP_PRIVATE_KEY;
if (!DEPLOYER_KEY || !ZKAPP_KEY) {
  throw new Error('Missing required environment variables');
}

// Network configuration
const NETWORK_URL =
  process.env.MINA_RPC_NETWORK_URL || 'http://localhost:3000/graphql';
const FEE = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)

async function deploy() {
  try {
    // Initialize keys
    const deployerKey = PrivateKey.fromBase58(DEPLOYER_KEY);
    const zkAppPrivateKey = PrivateKey.fromBase58(ZKAPP_KEY);
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();

    console.log('Deployer address:', deployerAccount.toBase58());
    console.log('ZkApp address:', zkAppAddress.toBase58());

    // Compile contracts
    const vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
      .verificationKey;
    console.log('Verifier contract compiled1');
    const pVK = await EthProcessor.compile({ cache: Cache.FileSystemDefault });
    console.log('EthProcessor contract compiled2:', pVK.verificationKey.hash);

    // Configure Mina network
    const Network = Mina.Network({
      networkId: 'testnet' as NetworkId,
      mina: NETWORK_URL,
    });
    Mina.setActiveInstance(Network);

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    console.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
      { fee: FEE, sender: deployerAccount },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await zkApp.deploy();
      }
    );

    await txn.prove();
    const signedTx = txn.sign([deployerKey, zkAppPrivateKey]);
    console.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    console.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: zkAppAddress });
    const currentAdmin = await zkApp.admin.fetch();
    console.log('Deployment successful!');
    console.log('Contract admin:', currentAdmin?.toBase58());
  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

// Execute deployment
deploy().catch(console.error);
