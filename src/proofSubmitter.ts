import { EthProcessor, EthProofType } from './EthProcessor.js';
import { EthVerifier, EthInput, Bytes32 } from './EthVerifier.js';
import { ethers } from 'ethers';
import { NodeProofLeft } from '@nori-zk/proof-conversion';
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
        /*const ZK_APP_ADDRESS = process.env.ZK_APP_ADDRESS;
    if (ZK_APP_ADDRESS === undefined) {
      throw 'ZK_APP_ADDRESS env var is not defined exiting';
    }*/

        const SENDER_PRIVATE_KEY = process.env.SENDER_PRIVATE_KEY;
        if (!SENDER_PRIVATE_KEY) {
            throw 'SENDER_PRIVATE_KEY env var is not define exiting';
        }
        this.senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
        const NETWORK = process.env.NETWORK;
        if (!NETWORK || !['devnet', 'mainnet', 'lightnet'].includes(NETWORK)) {
            throw 'NETWORK env var is not defined or wrong, options are devnet, mainnet, lightnet';
        }
        this.network = NETWORK as NetworkId;
        this.testMode = NETWORK === 'lightnet';

        if (this.testMode && !process.env.ZKAPP_PRIVATE_KEY) {
            // This makes sure the local tests work dont remove it
            this.zkAppPrivateKey = PrivateKey.random();
            this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
        } else {
            const ZKAPP_PRIVATE_KEY = process.env.ZKAPP_PRIVATE_KEY;
            if (!ZKAPP_PRIVATE_KEY) {
                throw 'ZKAPP_PRIVATE_KEY env var is not define exiting';
            }
            this.zkAppPrivateKey = PrivateKey.fromBase58(
                process.env.ZKAPP_PRIVATE_KEY as string
            );
            this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
            //this.zkApp = new EthProcessor(PublicKey.fromBase58(ZK_APP_ADDRESS));
        }

        this.txFee = Number(process.env.TX_FEE || 0.1) * 1e9;

        console.log('Loaded constants from .env');
    }
    async networkSetUp() {
        const MINA_RPC_NETWORK_URL =
            (process.env.MINA_RPC_NETWORK_URL as string) ||
            'https://api.minascan.io/node/devnet/v1/graphql';
        const networkId = this.network === 'mainnet' ? 'mainnet' : 'testnet';
        const Network = Mina.Network({
            networkId,
            mina: MINA_RPC_NETWORK_URL,
        });
        Mina.setActiveInstance(Network);
        console.log('Finished Mina network setup');
    }
    async compileContracts() {
        try {
            console.log('Compiling verifier contract');
            const { verificationKey: vk } = await EthVerifier.compile({
                cache: Cache.FileSystemDefault,
            });
            console.log(
                'Verifier contract vk hash compiled:',
                vk.hash.toString()
            );

            const pVK = (
                await EthProcessor.compile({
                    cache: Cache.FileSystemDefault,
                })
            ).verificationKey;
            console.log('EthProcessor contract vk hash:', pVK.hash.toString());

            console.log('Contracts compiled.');
        } catch (err) {
            console.error(`Error compiling contracts: ${err}`);
        }
    }
    async deployContract() {
        const deployTx = await Mina.transaction(
            { sender: this.senderPrivateKey.toPublicKey(), fee: this.txFee },
            async () => {
                AccountUpdate.fundNewAccount(
                    this.senderPrivateKey.toPublicKey()
                );
                await this.zkApp.deploy();
            }
        );
        console.log('Deploy transaction created successfully.');
        await deployTx.prove();
        await deployTx
            .sign([this.senderPrivateKey, this.zkAppPrivateKey])
            .send()
            .wait();
        console.log('EthProcessor deployed successfully.');
    }

    async createProof(
        proofArguments: CreateProofArgument
    ): Promise<ReturnType<typeof EthVerifier.compute>> {
        const { sp1PlonkProof, conversionOutputProof } = proofArguments;

        const rawProof = await NodeProofLeft.fromJSON(
            conversionOutputProof.proofData
        );

        const ethSP1Proof = sp1PlonkProof;

        // Decode proof values.
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
            ],
            new Uint8Array(Buffer.from(ethSP1Proof.public_values.buffer.data))
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
            startSyncComitteHash: Bytes32.fromHex(decoded[7].slice(2)),
        });

        // Compute and verify proof.
        console.log('Computing proof.');
        return EthVerifier.compute(input, rawProof);
    }

    async submit(ethProof: EthProofType) {
        console.log('Creating update transaction.');
        try {
            await fetchAccount({ publicKey: this.zkApp.address });
            await fetchAccount({
                publicKey: this.senderPrivateKey.toPublicKey(),
            });

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
            console.log('Transaction proven.');

            const tx = await updateTx.sign([this.senderPrivateKey]).send();
            console.log(
                `Transaction sent${this.testMode ? ' to testMode.' : '.'}`
            );
            const txId = tx.data?.sendZkapp.zkapp.id;
            if (!txId) {
                throw new Error('txId is undefined');
            }
            return txId;
        } catch (err) {
            console.error(`Error submitting proof: ${err}`);
            throw err;
        }
    }
}
