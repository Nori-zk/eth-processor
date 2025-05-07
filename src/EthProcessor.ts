import 'dotenv/config';
import {
    Field,
    PrivateKey,
    SmartContract,
    State,
    method,
    state,
    Poseidon,
    UInt64,
    PublicKey,
    Permissions,
    Provable,
    Struct,
} from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { EthProof, StoreHash } from './EthVerifier.js';
import { storeHashBytesToProvableFields } from './storeHashToProvableFields.js';
import { Bytes32 } from './types.js';

const logger = new Logger('EthProcessor');

let adminPrivateKeyBase58 = process.env.ADMIN_PRIVATE_KEY;
if (!adminPrivateKeyBase58) {
    logger.warn('ADMIN_PRIVATE_KEY not set, using random key');
    adminPrivateKeyBase58 = PrivateKey.random().toBase58();
}
export const adminPrivateKey = PrivateKey.fromBase58(adminPrivateKeyBase58);

export const adminPublicKey = adminPrivateKey.toPublicKey();

export class EthProofType extends EthProof {}

class VerificationKey extends Struct({
    data: String,
    hash: Field,
}) {}

class DeployArgsWithStoreHash extends Struct({
    verificationKey: VerificationKey,
    storeHash: StoreHash,
}) {}

class DeployArgsWithoutStoreHash extends Struct({
    verificationKey: VerificationKey,
}) {}

export type EthProcessorDeployArgs = DeployArgsWithStoreHash | DeployArgsWithoutStoreHash;

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

    async deploy(args: EthProcessorDeployArgs) {
        // Could we deploy with a proof?

        const { verificationKey } = args;
        super.deploy(
            { verificationKey }
        );
        if ('storeHash' in args) {
            this.latestHeliusStoreInputHashHighByte.set(args.storeHash.storeHashHighByteField);
            this.latestHeliusStoreInputHashLowerBytes.set(args.storeHash.storeHashLowerBytesField);
        }

        //this.verifiedStateRoot.set(Field(2)); // Need to prove this otherwise its bootstrapped in an invalid state
    }

    // @method async init() {
    //   this.account.provedState.getAndRequireEquals();
    //   this.account.provedState.get().assertFalse();

    //   super.init();
    // }

    @method async update(ethProof: EthProofType) {
        const proofHead = ethProof.publicInput.newHead;
        const executionStateRoot = ethProof.publicInput.executionStateRoot;
        const currentSlot = this.latestHead.getAndRequireEquals();

        Provable.asProver(() => {
            Provable.log('Current slot', currentSlot);
        });

        const {storeHashHighByteField: prevStoreHashHighByteField, storeHashLowerBytesField: prevStoreHashLowerBytesField} = storeHashBytesToProvableFields(ethProof.publicInput.prevStoreHash);

        // Verification of the previous store hash higher byte.
        prevStoreHashHighByteField.assertEquals(
            this.latestHeliusStoreInputHashHighByte.getAndRequireEquals(),
            "The latest transition proofs' input helios store hash higher byte, must match the contracts' helios store hash higher byte."
        );

        Provable.asProver(() => {
            Provable.log(
                'ethProof.prevStoreHashHighByteField vs this.latestHeliusStoreInputHashHighByte',
                prevStoreHashHighByteField.toString(),
                this.latestHeliusStoreInputHashHighByte.get().toString()
            );
        });

        // Verification of previous store hash lower bytes.
        prevStoreHashLowerBytesField.assertEquals(
            this.latestHeliusStoreInputHashLowerBytes.getAndRequireEquals(),
            "The latest transition proofs' input helios store hash lower bytes, must match the contracts' helios store hash lower bytes."
        );

        Provable.asProver(() => {
            Provable.log(
                'ethProof.prevStoreHashLowerBytesField vs this.latestHeliusStoreInputHashLowerBytes',
                prevStoreHashLowerBytesField.toString(),
                this.latestHeliusStoreInputHashLowerBytes.get().toString()
            );
        });

        // Verification of slot progress. Moved to the bottom to allow us to test hash mismatches do indeed yield validation errors.
        proofHead.assertGreaterThan(
            currentSlot,
            'Proof head must be greater than current head.'
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
