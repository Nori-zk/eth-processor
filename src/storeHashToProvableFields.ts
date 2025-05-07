import { Field } from 'o1js';
import { Bytes32, EthOutput } from './EthVerifier';

export function storeHashBytesToProvableFields(storeHash: Bytes32) {
    // Convert the store hash's higher byte into a provable field.
    let storeHashHighByteField = new Field(0);
    storeHashHighByteField = storeHashHighByteField.add(
        storeHash.bytes[0].value
    );

    // Convert the store hash's lower 31 bytes into a provable field.
    let storeHashLowerBytesField = new Field(0);
    for (let i = 1; i < 32; i++) {
        storeHashLowerBytesField = storeHashLowerBytesField
            .mul(256)
            .add(storeHash.bytes[i].value);
    }

    return {
        storeHashHighByteField,
        storeHashLowerBytesField,
    };
}
