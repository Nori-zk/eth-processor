import {
  Field,
  PrivateKey,
  Provable,
  SmartContract,
  State,
  method,
  state,
  Poseidon,
  UInt64,
  DeployArgs,
  PublicKey,
  Permissions,
} from 'o1js';
import { EthProof, Bytes32 } from './EthVerifier.js';
import 'dotenv/config';

let ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
if (!ADMIN_PRIVATE_KEY) {
  console.log('ADMIN_PRIVATE_KEY not set, using random key');
  ADMIN_PRIVATE_KEY = PrivateKey.random().toBase58();
}
export const adminPrivateKey = PrivateKey.fromBase58(ADMIN_PRIVATE_KEY);

export const adminPublicKey = adminPrivateKey.toPublicKey();

export class EthProofType extends EthProof {}

export class EthProcessor extends SmartContract {
  @state(Field) verifiedStateRoot = State<Field>(); // todo make PackedString
  @state(UInt64) latestHead = State<UInt64>();
  @state(PublicKey) admin = State<PublicKey>();
  // @state(Field) latestHeliusStoreInputHash = State<Field>(); //todo
  // events = { 'executionStateRoot-set': Bytes32.provable };//todo change type, if events even possible
  init() {
    super.init();
    this.admin.set(adminPublicKey);
    this.latestHead.set(UInt64.from(0));
    this.verifiedStateRoot.set(Field(1));

    this.account.permissions.set({
      ...Permissions.default(),
    });
  }
  //TODO deploy (for redeployments) ?
  // async deploy(args: DeployArgs) {
  //   super.deploy(args);
  //   this.verifiedStateRoot.set(Field(2));
  // }

  // @method async init() {
  //   this.account.provedState.getAndRequireEquals();
  //   this.account.provedState.get().assertFalse();

  //   super.init();
  // }

  @method async update(ethProof: EthProofType) {
    const currentHead = this.latestHead.getAndRequireEquals();
    const proofHead = ethProof.publicInput.newHead;
    const executionStateRoot = ethProof.publicInput.executionStateRoot;
    proofHead.assertGreaterThan(
      currentHead,
      'Proof head must be greater than current head'
    );
    ethProof.verify();

    this.latestHead.set(proofHead);

    this.verifiedStateRoot.set(
      Poseidon.hashPacked(Bytes32.provable, executionStateRoot)
    );
    // this.emitEvent('executionStateRoot-set', executionStateRoot);
  }
}
