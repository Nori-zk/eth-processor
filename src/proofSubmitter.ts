import { EthProcessor, EthProofType } from './EthProcessor.js';
import { EthVerifier, EthInput, Bytes32 } from './EthVerifier.js';
import { ethers } from 'ethers';
import { Logger, NodeProofLeft } from '@nori-zk/proof-conversion';
import {
    AccountUpdate,
    Mina,
    PrivateKey,
    PublicKey,
    Cache,
    NetworkId,
    UInt64,
    VerificationKey,
    fetchAccount,
    checkZkappTransaction,
    Account,
} from 'o1js';
import { CreateProofArgument } from './interfaces.js';
import { ethVerifierVkHash } from './vks/EthVerifier.VKHash.js';
import { ethProcessorVkHash } from './vks/EthProcessor.VKHash.js';

const logger = new Logger('EthProcessorSubmitter');

export class MinaEthProcessorSubmitter {
    zkApp: EthProcessor;
    senderPrivateKey: PrivateKey;
    zkAppPrivateKey: PrivateKey;
    network: NetworkId;
    // Execution environment flags.
    proofsEnabled: boolean;
    testMode: boolean;
    txFee: number;

    constructor(private type: 'plonk' = 'plonk') {
        logger.info(`🛠 MinaEthProcessorSubmitter constructor called!`);
        const errors: string[] = [];
        
        const senderPrivateKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;
        const network = process.env.NETWORK as string;
        const zkAppPrivateKeyBase58 = process.env.ZKAPP_PRIVATE_KEY as string;
    
        if (!senderPrivateKeyBase58) errors.push('SENDER_PRIVATE_KEY is required');
        
        if (!network) {
            errors.push('NETWORK is required');
        } else if (!['devnet', 'mainnet', 'lightnet'].includes(network)) {
            errors.push(`NETWORK must be one of: devnet, mainnet, lightnet (got "${network}")`);
        } else {
            this.network = network as NetworkId;
            this.testMode = network === 'lightnet';
        }
    
        if (this.network && !this.testMode) {
            if (!zkAppPrivateKeyBase58) {
                errors.push('ZKAPP_PRIVATE_KEY is required when not in lightnet mode');
            }
        }
    
        if (errors.length > 0) {
            throw `Configuration errors:\n- ${errors.join('\n- ')}`;
        }
    
        this.senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        
        if (this.testMode) {
            this.zkAppPrivateKey = PrivateKey.random();
        } else {
            this.zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
        }
        
        this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
        this.txFee = Number(process.env.TX_FEE || 0.1) * 1e9;
    
        logger.log('Loaded constants from .env');
    }

    /*constructor(private type: 'plonk' = 'plonk') {
        const senderPrivateKeyBase58 = process.env.SENDER_PRIVATE_KEY;
        this.ethVerifierVkHash = process.env.ETH_VERIFIER_VK_HASH;
        this.ethProcessorVKHash = process.env.ETH_PROCESSOR_VK_HASH;

        if (!senderPrivateKeyBase58) {
            throw 'SENDER_PRIVATE_KEY env var is not define exiting';
        }
        this.senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const network = process.env.NETWORK;
        if (!network || !['devnet', 'mainnet', 'lightnet'].includes(network)) {
            throw 'NETWORK env var is not defined or wrong, options are devnet, mainnet, lightnet';
        }
        this.network = network as NetworkId;
        this.testMode = network === 'lightnet';

        if (this.testMode && !process.env.ZKAPP_PRIVATE_KEY) {
            // This makes sure the local tests work dont remove it
            this.zkAppPrivateKey = PrivateKey.random();
            this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
        } else {
            const zkAppPrivateKeyBase58 = process.env.ZKAPP_PRIVATE_KEY;
            if (!zkAppPrivateKeyBase58) {
                throw 'ZKAPP_PRIVATE_KEY env var is not define exiting';
            }
            this.zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
            this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
            //this.zkApp = new EthProcessor(PublicKey.fromBase58(ZKAPP_ADDRESS));
        }

        this.txFee = Number(process.env.TX_FEE || 0.1) * 1e9;

        logger.log('Loaded constants from .env');
    }*/


    async networkSetUp() {
        logger.log('Setting up network');
        const networkUrl =
            (process.env.MINA_RPC_NETWORK_URL as string) ||
            'https://api.minascan.io/node/devnet/v1/graphql';
        const networkId = this.network === 'mainnet' ? 'mainnet' : 'testnet';
        const Network = Mina.Network({
            networkId,
            mina: networkUrl,
        });
        Mina.setActiveInstance(Network);
        logger.log('Finished Mina network setup.');
    }

    async compileContracts() {
        try {
            logger.log('Compiling EthVerifier contract.');
            const { verificationKey: vk } = await EthVerifier.compile(); // Future opt cache: Cache.FileSystemDefault,

            const calculateEthVerifierVkHash = vk.hash.toString();
            logger.log(
                `Verifier contract vk hash compiled: '${calculateEthVerifierVkHash}'.`
            );

            logger.log('Compiling EthProcessor contract.');
            const pVK = (await EthProcessor.compile()).verificationKey; // Future opt cache: Cache.FileSystemDefault,

            // console.log(await EthProcessor.analyzeMethods()); // Used for debugging to make sure our contract compiles fully

            const calculateEthProcessorVKHash = pVK.hash.toString();
            logger.log(`EthProcessor contract vk hash compiled: '${calculateEthProcessorVKHash}'.`);

            // Validation
            logger.log('Verifying computed Vk hashes.');

            let disagree: string[] = [];

            if (calculateEthVerifierVkHash !== ethVerifierVkHash) {
                disagree.push(`Computed ethVerifierVkHash '${calculateEthVerifierVkHash}' disagrees with the one cached within this repository '${ethVerifierVkHash}'.`);
            }

            if (calculateEthProcessorVKHash !== ethProcessorVkHash) {
                disagree.push(`Computed ethProcessorVKHash '${calculateEthProcessorVKHash}' disagrees with the one cached within this repository '${ethProcessorVkHash}'.`);
            }

            if (disagree.length) {
                disagree.push(`Refusing to start. Do you need to run 'npm run deploy' in the eth-processor repository and commit the change?`);
                const errStr = disagree.join('\n');
                throw new Error(errStr);
            }

            logger.log('Contracts compiled.');
        } catch (err) {
            console.log((err as any).stack);
            logger.error(`Error compiling contracts:\n${String(err)}`);
            throw err;
        }
    }

    async deployContract() {
        logger.log('Creating deploy update transaction.');
        const deployTx = await Mina.transaction(
            { sender: this.senderPrivateKey.toPublicKey(), fee: this.txFee },
            async () => {
                AccountUpdate.fundNewAccount(
                    this.senderPrivateKey.toPublicKey()
                );
                await this.zkApp.deploy();
            }
        );
        logger.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        logger.log('Transaction proved. Signing and sending the transaction...');
        await deployTx
            .sign([this.senderPrivateKey, this.zkAppPrivateKey])
            .send()
            .wait();
        logger.log('EthProcessor deployed successfully.');
    }

    async createProof(
        proofArguments: CreateProofArgument
    ): Promise<ReturnType<typeof EthVerifier.compute>> {
        try {
            logger.log('Creating proof.');
            const { sp1PlonkProof, conversionOutputProof } = proofArguments;

            const rawProof = await NodeProofLeft.fromJSON(
                conversionOutputProof.proofData
            );

            const ethSP1Proof = sp1PlonkProof;

            // Decode proof values.
            logger.log('Decoding converted proof.');
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
                new Uint8Array(
                    Buffer.from(ethSP1Proof.public_values.buffer.data)
                )
            );

            // Create input for verification.
            const input = new EthInput({
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
            });

            // Compute and verify proof.
            logger.log('Computing proof.');
            return EthVerifier.compute(input, rawProof);
        } catch (err) {
            logger.error(`Error computing proof: ${String(err)}`);
            throw err;
        }
    }

    async submit(ethProof: EthProofType) {
        logger.log('Submitting a proof.');
        try {
            await fetchAccount({ publicKey: this.zkApp.address });
            await fetchAccount({
                publicKey: this.senderPrivateKey.toPublicKey(),
            });
            logger.log('Fetched accounts.');

            logger.log('Creating update transaction.');
            const updateTx = await Mina.transaction(
                {
                    sender: this.senderPrivateKey.toPublicKey(),
                    fee: this.txFee,
                },
                async () => {
                    await this.zkApp.update(ethProof);
                }
            );

            await updateTx.prove();
            logger.log('Transaction proven.');

            const tx = await updateTx.sign([this.senderPrivateKey]).send();
            logger.log(
                `Transaction sent${this.testMode ? ' to testMode.' : '.'}`
            );
            const txId = tx.data!.sendZkapp.zkapp.id;
            const txHash = tx.data!.sendZkapp.zkapp.hash;
            if (!txId) {
                throw new Error('txId is undefined');
            }
            return {
                txId,
                txHash,
            };
        } catch (err) {
            logger.error(`Error submitting proof: ${String(err)}`);
            throw err;
        }
    }
}
