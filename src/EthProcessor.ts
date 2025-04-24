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
    UInt8,
} from 'o1js';
import { EthProof, Bytes32 } from './EthVerifier.js';
import 'dotenv/config';
import { Logger } from '@nori-zk/proof-conversion';

const logger = new Logger('EthProcessor');

let adminPrivateKeyBase58 = process.env.ADMIN_PRIVATE_KEY;
if (!adminPrivateKeyBase58) {
    logger.warn('ADMIN_PRIVATE_KEY not set, using random key');
    adminPrivateKeyBase58 = PrivateKey.random().toBase58();
}
export const adminPrivateKey = PrivateKey.fromBase58(adminPrivateKeyBase58);

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
        const currentSlot = this.latestHead.getAndRequireEquals();

        // Verification of slot progress.
        proofHead.assertGreaterThan(
            currentSlot,
            'Proof head must be greater than current head.'
        );

        // Convert the store hash's higher byte into a provable field.
        const prevStoreHashHighByteField = new Field(0);
        prevStoreHashHighByteField.add(
            ethProof.publicInput.prevStoreHash.bytes[0].value
        );

        // Verification of the previous store hash higher byte.
        prevStoreHashHighByteField.assertEquals(
            this.latestHeliusStoreInputHashHighByte.getAndRequireEquals(),
            'The latest transition proofs\' input helios store hash higher byte, must match the contracts\' helios store hash higher byte.'
        );

        // Convert the store hash's lower 31 bytes into a provable field.
        const prevStoreHashLowerBytesField = new Field(0);
        for (let i = 1; i < 32; i++) {
            prevStoreHashLowerBytesField
                .mul(256)
                .add(ethProof.publicInput.prevStoreHash.bytes[i].value);
        }

        // Verification of previous store hash lower bytes.
        prevStoreHashLowerBytesField.assertEquals(
            this.latestHeliusStoreInputHashLowerBytes.getAndRequireEquals(),
            'The latest transition proofs\' input helios store hash lower bytes, must match the contracts\' helios store hash lower bytes.'
        );

        // Verify transition proof.
        ethProof.verify();

        // Update contract values
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
