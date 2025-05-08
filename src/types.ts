import { Bytes, Field, Struct } from 'o1js';
import { EthVerifier } from './EthVerifier';

export interface Proof {
    Plonk: {
        encoded_proof: string;
        plonk_vkey_hash: number[];
        public_inputs: string[];
        raw_proof: string;
    };
}

export interface PublicValues {
    buffer: {
        data: number[];
    };
}

export interface PlonkProof {
    proof: Proof;
    public_values: PublicValues;
    sp1_version: string;
}

export interface ConvertedProofProofData {
    maxProofsVerified: 0 | 1 | 2;
    proof: string;
    publicInput: string[];
    publicOutput: string[];
}

export interface ConvertedProofVkData {
    data: string;
    hash: string;
}

export interface ConvertedProof {
    vkData: ConvertedProofVkData;
    proofData: ConvertedProofProofData;
}

export interface CreateProofArgument {
    sp1PlonkProof: PlonkProof;
    conversionOutputProof: ConvertedProof;
}

export type EthVerifierComputeOutput = Awaited<
    ReturnType<typeof EthVerifier.compute>
>;

export type VerificationKey = {
    data: string;
    hash: Field;
}

export class Bytes32 extends Bytes(32) {}

export class StoreHash extends Struct({
    highByteField: Field,
    lowerBytesField: Field,
}) {
    static fromBytes32(bytes32: Bytes32) {
        // Convert the store hash's higher byte into a provable field.
        let storeHashHighByteField = new Field(0);
        storeHashHighByteField = storeHashHighByteField.add(
            bytes32.bytes[0].value
        );

        // Convert the store hash's lower 31 bytes into a provable field.
        let storeHashLowerBytesField = new Field(0);
        for (let i = 1; i < 32; i++) {
            storeHashLowerBytesField = storeHashLowerBytesField
                .mul(256)
                .add(bytes32.bytes[i].value);
        }

        return new this({
            highByteField: storeHashHighByteField,
            lowerBytesField: storeHashLowerBytesField,
        });
    }
}