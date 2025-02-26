import {
  AccountUpdate,
  Mina,
  PrivateKey,
  PublicKey,
  Cache,
  UInt64,
  VerificationKey,
} from 'o1js';
import { EthProcessor } from './EthProcessor.js';
import { EthVerifier, EthInput, Bytes32 } from './EthVerifier.js';
import fs from 'fs';
import { NodeProofLeft } from 'proof-conversion';
import { ethers } from 'ethers';
import { PATH_TO_O1_PROOF, PATH_TO_SP1_PROOF } from './proofs.js';

// Configuration
const proofsEnabled = true;

// Contract state variables
let deployerAccount: Mina.TestPublicKey;
let deployerKey: PrivateKey;
let senderAccount: Mina.TestPublicKey;
let senderKey: PrivateKey;
let zkAppAddress: PublicKey;
let zkAppPrivateKey: PrivateKey;
let zkApp: EthProcessor;
let vk: VerificationKey;

async function main() {
  try {
    // Compile and setup
    vk = (await EthVerifier.compile({ cache: Cache.FileSystemDefault }))
      .verificationKey;
    if (proofsEnabled) {
      await EthProcessor.compile();
    }
    // const ethV = await EthVerifier.analyzeMethods();
    // console.log('ethV', ethV.compute.summary());
    // const ethP = await EthProcessor.analyzeMethods();
    // console.log('ethP', ethP);

    // Initialize local blockchain
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount] = Local.testAccounts;
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;

    // Deploy contract
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new EthProcessor(zkAppAddress);

    const deployTx = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await deployTx.prove();
    await deployTx.sign([deployerKey, zkAppPrivateKey]).send();
    console.log('Successfully deployed EthProcessor');

    // Process proof data
    const rawProof = await NodeProofLeft.fromJSON(
      JSON.parse(fs.readFileSync(PATH_TO_O1_PROOF, 'utf8'))
    );
    const ethSP1Proof = JSON.parse(fs.readFileSync(PATH_TO_SP1_PROOF, 'utf8')); // JK FIXME why is the proof coming from example file

    // Decode proof values
    const defaultEncoder = ethers.AbiCoder.defaultAbiCoder();

    // JK factorise deecoders
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

    // Create input for verification
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
    // Compute and verify proof
    console.log('Computing proof...');
    const proof = await EthVerifier.compute(input, rawProof);

    // Update contract state
    console.log('Creating update transaction...');
    const updateTx = await Mina.transaction(senderAccount, async () => {
      await zkApp.update(proof.proof);
    });
    await updateTx.prove();
    await updateTx.sign([senderKey]).send();

    // Verify updated state
    const updatedState = Mina.getAccount(zkAppAddress);
    const updatedHeadState = zkApp.latestHead.get();
    console.log(
      'Updated latestHead:',
      updatedState.zkapp?.appState[1].toString()
    );
    console.log('Updated head state:', updatedHeadState.toString());
    // const events = await zkApp.fetchEvents();
    // console.log(events[0].event.data);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
