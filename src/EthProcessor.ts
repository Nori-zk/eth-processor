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
import { Logger } from '@nori-zk/proof-conversion';

const logger = new Logger('EthProcessor');

let ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
if (!ADMIN_PRIVATE_KEY) {
    logger.warn('ADMIN_PRIVATE_KEY not set, using random key');
    ADMIN_PRIVATE_KEY = PrivateKey.random().toBase58();
}
export const adminPrivateKey = PrivateKey.fromBase58(ADMIN_PRIVATE_KEY);

export const adminPublicKey = adminPrivateKey.toPublicKey();

export class EthProofType extends EthProof {}

export class EthProcessor extends SmartContract {
    @state(Field) verifiedStateRoot = State<Field>(); // todo make PackedString
    @state(UInt64) latestHead = State<UInt64>();
    @state(PublicKey) admin = State<PublicKey>();
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();

    //todo
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
        const proofHead = ethProof.publicInput.newHead;
        const executionStateRoot = ethProof.publicInput.executionStateRoot;

        const currentHead = this.latestHead.getAndRequireEquals();

        proofHead.assertGreaterThan(
            currentHead,
            'Proof head must be greater than current head'
        );

        // Store hash high byte
        const prevStoreHashHighByte =
            ethProof.publicInput.prevStoreHash.bytes.slice(0, 1);
        const prevStoreHashHighByteField = new Field(0);
        prevStoreHashHighByteField.add(prevStoreHashHighByte[0].value);
        prevStoreHashHighByteField.assertEquals(
            this.latestHeliusStoreInputHashHighByte.getAndRequireEquals()
        );

        // Store hash lower 31 bytes
        const prevStoreHashLowerBytes =
            ethProof.publicInput.prevStoreHash.bytes.slice(1, 32);
        const prevStoreHashLowerBytesField = new Field(0);
        for (let i = 0; i < 32; i++) {
            prevStoreHashLowerBytesField
                .mul(256)
                .add(prevStoreHashLowerBytes[i].value);
        }

        // Verification of previous store hash

        prevStoreHashLowerBytesField.assertEquals(
            this.latestHeliusStoreInputHashLowerBytes.getAndRequireEquals()
        );

        // Verify

        ethProof.verify();

        // 

        this.latestHead.set(proofHead);

        this.verifiedStateRoot.set(
            Poseidon.hashPacked(Bytes32.provable, executionStateRoot)
        );

        this.latestHeliusStoreInputHashHighByte.set(
            ethProof.publicOutput.storeHashHighByteField
        );
        this.latestHeliusStoreInputHashLowerBytes.set(
            ethProof.publicOutput.storeHashLowerBytesField
        );

    }
}
