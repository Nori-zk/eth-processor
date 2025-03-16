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
} from 'o1js';
import { CreateProofArgument } from './interfaces.js';

export class MinaEthProcessorSubmitter {
  zkApp: EthProcessor;
  senderPrivateKey: PrivateKey;
  deployerPrivateKey: PrivateKey;
  zkAppPrivateKey: PrivateKey;

  // Execution environment flags.
  proofsEnabled: boolean;
  liveNet: boolean;
  txFee: number;

  constructor(private type: 'plonk' = 'plonk') {
    const ZK_APP_ADDRESS = process.env.ZK_APP_ADDRESS;
    if (ZK_APP_ADDRESS === undefined) {
      throw 'ZK_APP_ADDRESS env var is not defined exiting';
    }
    this.zkApp = new EthProcessor(PublicKey.fromBase58(ZK_APP_ADDRESS));
    const SENDER_PRIVATE_KEY = process.env.SENDER_PRIVATE_KEY;
    if (!SENDER_PRIVATE_KEY) {
      throw 'SENDER_PRIVATE_KEY env var is not define exiting';
    }
    this.senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
    this.proofsEnabled = process.env.PROOFS_ENABLED !== 'false';
    this.liveNet = process.env.LIVE_NET === 'true';
    if (process.env.TX_FEE) {
      this.txFee = Number(process.env.TX_FEE || 0.1) * 1e9;
    }

    console.log('Loaded constants from .env');
  }

  async compileContracts() {
    try {
      console.log('Compiling verifier contract');
      const { verificationKey: vk } = await EthVerifier.compile();
      console.log('Verifier contract vk hash compiled:', vk.hash);
      if (this.proofsEnabled || this.liveNet) {
        const pVK = (await EthProcessor.compile()).verificationKey;
        console.log('EthProcessor contract vk hash:', pVK.hash);
      }
      console.log('Contracts compiled.');
    } catch (err) {
      console.error(`Error compiling contracts: ${err}`);
    }
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
      if (this.liveNet) fetchAccount({ publicKey: this.zkApp.address });

      const updateTx = await Mina.transaction(
        { sender: this.senderPrivateKey.toPublicKey(), fee: this.txFee },
        async () => {
          await this.zkApp.update(ethProof);
        }
      );

      await updateTx.prove();
      console.log('Transaction proven.');

      const tx = await updateTx.sign([this.senderPrivateKey]).send();
      console.log(`Transaction sent${this.liveNet ? ' to livenet.' : '.'}`);

      if (!this.liveNet) {
        const account = Mina.getAccount(this.zkApp.address);
        console.log(
          'Latest head on local chain:',
          account.zkapp?.appState[1].toString()
        );
      }
      return tx;
    } catch (err) {
      console.error(`Error submitting proof: ${err}`);
      throw err;
    }
  }

  async networkSetUp() {
    try {
      if (!this.liveNet) {
        const Local = await Mina.LocalBlockchain({
          proofsEnabled: this.proofsEnabled,
        });
        Mina.setActiveInstance(Local);
        const [deployerAccount, senderAccount] = Local.testAccounts;
        this.deployerPrivateKey = deployerAccount.key;
        this.senderPrivateKey = senderAccount.key;
        this.zkAppPrivateKey = PrivateKey.random();
      } else {
        const MINA_RPC_NETWORK_URL =
          (process.env.MINA_RPC_NETWORK_URL as string) ||
          'https://api.minascan.io/node/devnet/v1/graphql';
        const Network = Mina.Network({
          networkId: 'testnet' as NetworkId,
          mina: MINA_RPC_NETWORK_URL,
        });
        Mina.setActiveInstance(Network);
        // TODO error if priv key not set?
      }
    } catch (err) {
      console.error(`Error initializing Mina network: ${err}`);
    }
    console.log('Finished Mina network setup');
  }

  async deployContract() {
    this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
    const deployTx = await Mina.transaction(
      { sender: this.deployerPrivateKey.toPublicKey(), fee: this.txFee },
      async () => {
        AccountUpdate.fundNewAccount(this.deployerPrivateKey.toPublicKey());
        await this.zkApp.deploy();
      }
    );
    await deployTx.prove();
    await deployTx.sign([this.deployerPrivateKey, this.zkAppPrivateKey]).send();
    console.log('EthProcessor deployed successfully.');
  }
}
