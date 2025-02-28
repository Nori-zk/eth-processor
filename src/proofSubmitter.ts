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

  constructor(private type: 'plonk' = 'plonk') {
    const ZK_APP_ADDRESS = process.env.ZK_APP_ADDRESS;
    if (ZK_APP_ADDRESS === undefined) {
      throw "ZK_APP_ADDRESS env var is not defined exiting";
    }
    this.zkApp = new EthProcessor(
      PublicKey.fromBase58(ZK_APP_ADDRESS)
    );
    const SENDER_PRIVATE_KEY = process.env.SENDER_PRIVATE_KEY;
    if (!SENDER_PRIVATE_KEY) {
      throw "SENDER_PRIVATE_KEY env var is not define exiting";
    }
    this.senderPrivateKey = PrivateKey.fromBase58(SENDER_PRIVATE_KEY);
    this.proofsEnabled = process.env.PROOFS_ENABLED !== 'false';
    this.liveNet = process.env.LIVE_NET === 'true';
    console.log('Loaded constants from .env');
  }

  async createProof(
    proofArguments: CreateProofArgument,
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
    // Update contract state
    console.log('MinaEthProcessorSubmittor: Creating update tx.');
    try {

      const updateTx = await Mina.transaction(
        this.senderPrivateKey.toPublicKey(),
        async () => {
          await this.zkApp.update(ethProof);
        }
      );

      await updateTx.prove();
      console.log('MinaEthProcessorSubmittor: transaction proven.');
      const tx = await updateTx.sign([this.senderPrivateKey]).send();
      console.log('MinaEthProcessorSubmittor: transaction sent.');

      // TODO: This wont work on mainet. // TODO
      let m = await Mina.getAccount(this.zkApp.address);
      console.log('Latest head on chain: ', m.zkapp?.appState[1].toString());
      return tx;

    } catch (err) {
      console.error(`An error occured submitting the proof: ${err}`);
      throw err;
    }
  }

  async networkSetUp() {
    if (this.liveNet == false) {
      try {
        // Contract state variables.
        let deployerAccount: Mina.TestPublicKey;
        let deployerKey: PrivateKey;
        let senderAccount: Mina.TestPublicKey;
        let senderKey: PrivateKey;

        // Initialize local blockchain.
        const Local = await Mina.LocalBlockchain({
          proofsEnabled: this.proofsEnabled,
        });
        Mina.setActiveInstance(Local);
        [deployerAccount, senderAccount] = Local.testAccounts;
        deployerKey = deployerAccount.key;
        senderKey = senderAccount.key;

        // Overwrite default .env values.
        this.senderPrivateKey = senderKey;
        this.deployerPrivateKey = deployerKey;
        this.zkAppPrivateKey = PrivateKey.random();
      } catch (err) {
        console.error(`An error occured initializing the Mina network: ${err}`);
      }
    } else {
      const MINA_RPC_NETWORK_URL = process.env.MINA_RPC_NETWORK_URL as string;

      // Configure Mina livenet network.
      const Network = Mina.Network({
        networkId: 'livenet' as NetworkId,
        mina: MINA_RPC_NETWORK_URL,
      });
      Mina.setActiveInstance(Network);

      throw new Error('Livenet not set-up yet');
    }

    console.log('Finished mina network set up');
  }

  async deployContract() {
    let vk: VerificationKey;

    // Compile both contracts.
    try {
      console.log('Compiling verifier contract');

      // await EthVerifier.compile({ cache: Cache.FileSystemDefault }); // what about just doing this. JK
      vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
        .verificationKey;

      console.log('Compiled vk');
      if (this.proofsEnabled) {
        await EthProcessor.compile();
      }
      console.log('Compiled');
    } catch (err) {
      console.error(`An error occured compiling the contracts: ${err}`);
    }

    this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
    const deployTx = await Mina.transaction(
      this.deployerPrivateKey.toPublicKey(),
      async () => {
        AccountUpdate.fundNewAccount(this.deployerPrivateKey.toPublicKey());
        await this.zkApp.deploy();
      }
    );
    await deployTx.prove();
    await deployTx.sign([this.deployerPrivateKey, this.zkAppPrivateKey]).send();
    console.log('Successfully deployed EthProcessor');
  }
}