import { Bool, Bytes, Field, Struct, UInt8 } from 'o1js';
import { EthVerifier } from './EthVerifier';
import { DynamicArray } from 'mina-attestations';

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
};

export class Bytes32 extends Bytes(32) {
    static get zero() {
        return new this(new Array(32).map(() => new UInt8(0)));
    }
}

export class Bytes20 extends Bytes(20) {
    static get zero() {
        return new this(new Array(20).map(() => new UInt8(0)));
    }
}

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

export class VerifiedContractStorageSlot extends Struct({
    key: Bytes32.provable,
    slotKeyAddress: Bytes20.provable,
    value: Bytes32.provable,
    contractAddress: Bytes20.provable,
}) {
    static fromAbiElementBytes(elementBytes: Uint8Array<ArrayBuffer>) {
        /*
            struct VerifiedContractStorageSlot {
                bytes32 key;             //0-31    [0  ..32 ]
                address slotKeyAddress;  //32-63   [32 ..64 ] address: equivalent to uint160, zero padding on LHS
                bytes32 value;           //64-95   [64 ..96 ]
                address contractAddress; //96-127  [96 ..128] address: equivalent to uint160, zero padding on LHS
            } 
        */
        const key = elementBytes.slice(0, 32);
        const slotKeyAddress = elementBytes.slice(44, 64);
        const value = elementBytes.slice(64, 96);
        const contractAddress = elementBytes.slice(108, 128);
        return new this({
            key: Bytes32.from(key),
            slotKeyAddress: Bytes20.from(slotKeyAddress),
            value: Bytes32.from(value),
            contractAddress: Bytes20.from(contractAddress),
        });
    }

    static bytes(input: VerifiedContractStorageSlot) {
        let bytes: UInt8[] = [];
        bytes = bytes.concat(input.key.bytes);
        bytes = bytes.concat(
            ...[
                ...new Array(12).fill(0).map((_) => UInt8.from(0)),
                input.slotKeyAddress.bytes,
            ]
        );
        bytes = bytes.concat(input.value.bytes);
        bytes = bytes.concat(
            ...[
                ...new Array(12).fill(0).map((_) => UInt8.from(0)),
                input.contractAddress.bytes,
            ]
        );
        return bytes;
    }
}

export const VerifiedContractStorageSlotsMaxLength = 50;
export const VerifiedContractStorageSlots = DynamicArray(
    VerifiedContractStorageSlot,
    { maxLength: VerifiedContractStorageSlotsMaxLength }
);

