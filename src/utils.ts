import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { UInt64 } from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { EthVerifier } from './EthVerifier.js';
import { EthProcessor } from './EthProcessor.js';
import { PlonkProof, Bytes32 } from './types.js';
import { ethVerifierVkHash } from './integrity/EthVerifier.VKHash.js';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash.js';

/*
    struct VerifiedContractStorageSlot {
        bytes32 key;                                                                         //0-31    [0  ..32 ]
        bytes32 value;                                                                       //32-63   [32 ..64 ]
        address contractAddress;                                                             //64-95   [64 ..96 ] address: equivalent to uint160, zero padding on LHS
    } 
 
    struct ProofOutputs { 
        //bytes32 OFFSET (VALUE 32 points to start of ProofOutputs struct)                   //0-31    [0  ..32 ]
        bytes32 executionStateRoot;                                                          //32-63   [32 ..64 ] (Start of ProofOutputs struct)
        bytes32 newHeader;                                                                   //64-95   [64 ..96 ]
        bytes32 nextSyncCommitteeHash;                                                       //96-127  [96 ..128]
        uint256 newHead;                                                                     //128-159 [128..160]
        bytes32 prevHeader;                                                                  //160-191 [160..192]
        uint256 prevHead;                                                                    //192-223 [192..224]
        bytes32 syncCommitteeHash;                                                           //224-255 [224..256]
        bytes32 startSyncCommitteeHash;                                                      //256-287 [256..288]
        bytes32 prevStoreHash;                                                               //288-319 [288..320]
        bytes32 storeHash;                                                                   //320-351 [320..352]
        VerifiedContractStorageSlot[] verifiedContractStorageSlots; 
        //bytes32 OFFSET (VALUE 352 points to start of VerifiedContractStorageSlot[] struct) //352-383 [352..384] (Start of VerifiedContractStorageSlot[] struct)
        //bytes32 LENGTH (VALUE of how many VerifiedContractStorageSlot elements there are)  //384-415 [384..416]
        //TUPLES OF VerifiedContractStorageSlot if there are any 
        //bytes32 VerifiedContractStorageSlot[0]_key;                                        //416-447 [416..448]
        //bytes32 VerifiedContractStorageSlot[0]_value;                                      //448-479 [448..480]
        //address VerifiedContractStorageSlot[0]_contractAddress;                            //480-511 [480..512]
        // ...and so on for additional array elements if any
    }
*/

export function assert(lhs: any, rhs: any, msg: string) {
    if (lhs !== rhs) throw msg;
}

// This is explicitly here for validation puposes not supposed to be provable.
function toBigIntFromBytes(bytes: Uint8Array): bigint {
    let result = 0n;
    for (const byte of bytes) {
        result = (result << 8n) | BigInt(byte);
    }
    return result;
}

const MAX_U64 = (1n << 64n) - 1n;

function assertUint64(value: bigint): void {
    if (value < 0n || value > MAX_U64) {
        throw new RangeError(`Value out of range for u64: '${value}'.`);
    }
}

export function decodeConsensusProof(ethSP1Proof: PlonkProof) {
    const proofData = new Uint8Array(
        Buffer.from(ethSP1Proof.public_values.buffer.data)
    );
    console.log('uint8array', proofData.slice(0, 32));

    const proofDataLength = proofData.length;
    if (proofDataLength < 416)
        throw new Error(
            `Byte slice too short: required 416 bytes, got '${proofDataLength}'.`
        );
    const proofDataLengthBI = BigInt(proofDataLength);

    // 1. Validate top-level offset (bytes 0-31) points to data section (32).
    const dataOffset = proofData.slice(0, 32);

    // Check top-level value
    const dataOffsetBI = toBigIntFromBytes(dataOffset);
    if (dataOffsetBI !== 32n) {
        throw new Error(
            `Invalid data offset: expected 32, got '${dataOffsetBI}'.`
        );
    }

    // 2. Read static fields (bytes 32-351).
    const executionStateRootSlice = proofData.slice(32, 64);
    const newHeaderSlice = proofData.slice(64, 96);
    const nextSyncCommitteeHashSlice = proofData.slice(96, 128);

    const newHeadSlice = proofData.slice(128, 160);
    const newHeadBI = toBigIntFromBytes(newHeadSlice);
    assertUint64(newHeadBI);

    const prevHeaderSlice = proofData.slice(160, 192);

    const prevHeadSlice = proofData.slice(192, 224);
    const prevHeadBI = toBigIntFromBytes(prevHeadSlice);
    assertUint64(prevHeadBI);

    const syncCommitteeHashSlice = proofData.slice(224, 256);
    const startSyncCommitteeHashSlice = proofData.slice(256, 288);
    const prevStoreHashSlice = proofData.slice(288, 320);
    const storeHashSlice = proofData.slice(320, 352);

    // 3. Read array struct offset (bytes 352-383) and validate it points to 352 (itself).
    const arrayOffset = proofData.slice(352, 384);
    const arrayOffsetBI = toBigIntFromBytes(arrayOffset);
    if (arrayOffsetBI !== 352n) {
        throw new Error(
            `Invalid array offset: expected 352, got '${arrayOffsetBI}'.`
        );
    }

    // 4. Read array length (located immediately after arrayOffset).
    const lengthOffsetBI = arrayOffsetBI + 32n;
    if (proofDataLengthBI < lengthOffsetBI + 32n) {
        return new Error('Byte slice too short to read array length.');
    }
    const arrayLenSlice = proofData.slice(
        Number(lengthOffsetBI),
        Number(lengthOffsetBI + 32n)
    );
    const arrayLenBI = toBigIntFromBytes(arrayLenSlice);
    console.log('arrayLenBI', arrayLenBI);

    // 5. Validate elements fit in the byte slice.
    const elementsStartBI = lengthOffsetBI + 32n;
    const elementsStart = Number(lengthOffsetBI);
    const totalElementsSizeBI = arrayLenBI * 128n;
    const requiredBytes = elementsStartBI + totalElementsSizeBI;
    if (requiredBytes > proofDataLengthBI) {
        throw new Error(
            `Byte slice too short for '${arrayLenBI}' storage slots (required: '${requiredBytes}', actual: '${proofDataLengthBI}')`
        );
    }

    // 6. Parse each VerifiedContractStorageSlot.
    // We may not like to do this because its very unprovable! instead probably keep the formatting as the same as the input and with
    // slicing we can extract out the correct bits. We'd need to do this arithmetically somehow with bytes32? Well they are composed of UInt8's

    const verifiedStorageSlots: {key: Bytes32, slotKeyAddress: Bytes32, value: Bytes32, contractAddress: Bytes32}[] = [];
    for (let i = 0; i < Number(arrayLenBI); i++) {
        const start = elementsStart + i * 128;
        const end = start + 128;
        const elementBytes = proofData.slice(start, end);

        const key = elementBytes.slice(0, 32);
        const slotKeyAddress = elementBytes.slice(32, 64);
        const value = elementBytes.slice(64, 96);
        const contractAddress = elementBytes.slice(96, 128);
        verifiedStorageSlots.push({key: Bytes32.from(key), slotKeyAddress: Bytes32.from(slotKeyAddress), value: Bytes32.from(value), contractAddress: Bytes32.from(contractAddress)});
    }

    const provables = {
        executionStateRoot: Bytes32.from(executionStateRootSlice),
        newHeader: Bytes32.from(newHeaderSlice),
        nextSyncCommitteeHash: Bytes32.from(nextSyncCommitteeHashSlice),
        newHead: UInt64.from(newHeadBI),
        prevHeader: Bytes32.from(prevHeaderSlice),
        prevHead: UInt64.from(prevHeadBI),
        syncCommitteeHash: Bytes32.from(syncCommitteeHashSlice),
        startSyncCommitteeHash: Bytes32.from(startSyncCommitteeHashSlice),
        prevStoreHash: Bytes32.from(prevStoreHashSlice),
        storeHash: Bytes32.from(storeHashSlice),
        verifiedStorageSlots,
    };
    
    return provables;
}

export function decodeProof(ethSP1Proof: PlonkProof) {
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
            'bytes32',
            'bytes32',
        ],
        new Uint8Array(Buffer.from(ethSP1Proof.public_values.buffer.data))
    );

    return {
        executionStateRoot: Bytes32.fromHex(decoded[0].slice(2)),
        newHeader: Bytes32.fromHex(decoded[1].slice(2)),
        nextSyncCommitteeHash: Bytes32.fromHex(decoded[2].slice(2)),
        newHead: UInt64.from(decoded[3]),
        prevHeader: Bytes32.fromHex(decoded[4].slice(2)),
        prevHead: UInt64.from(decoded[5]),
        syncCommitteeHash: Bytes32.fromHex(decoded[6].slice(2)),
        startSyncCommitteeHash: Bytes32.fromHex(decoded[7].slice(2)),
        prevStoreHash: Bytes32.fromHex(decoded[8].slice(2)),
        storeHash: Bytes32.fromHex(decoded[9].slice(2)),
    };
}

export async function compileAndVerifyContracts(logger: Logger) {
    try {
        logger.log('Compiling EthVerifier contract.');
        const ethVerifierVerificationKey = (await EthVerifier.compile())
            .verificationKey;

        const calculatedEthVerifierVkHash =
            ethVerifierVerificationKey.hash.toString();
        logger.log(
            `Verifier contract vk hash compiled: '${calculatedEthVerifierVkHash}'.`
        );

        logger.log('Compiling EthProcessor contract.');
        const ethProcessorVerificationKey = (await EthProcessor.compile())
            .verificationKey;

        // console.log(await EthProcessor.analyzeMethods()); // Used for debugging to make sure our contract compiles fully

        const calculatedEthProcessorVKHash =
            ethProcessorVerificationKey.hash.toString();
        logger.log(
            `EthProcessor contract vk hash compiled: '${calculatedEthProcessorVKHash}'.`
        );

        // Validation
        logger.log('Verifying computed Vk hashes.');

        let disagree: string[] = [];

        if (calculatedEthVerifierVkHash !== ethVerifierVkHash) {
            disagree.push(
                `Computed ethVerifierVkHash '${calculatedEthVerifierVkHash}' disagrees with the one cached within this repository '${ethVerifierVkHash}'.`
            );
        }

        if (calculatedEthProcessorVKHash !== ethProcessorVkHash) {
            disagree.push(
                `Computed ethProcessorVKHash '${calculatedEthProcessorVKHash}' disagrees with the one cached within this repository '${ethProcessorVkHash}'.`
            );
        }

        if (disagree.length) {
            disagree.push(
                `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' in the eth-processor repository and commit the change?`
            );
            const errStr = disagree.join('\n');
            throw new Error(errStr);
        }

        logger.log('Contracts compiled.');
        return { ethVerifierVerificationKey, ethProcessorVerificationKey };
    } catch (err) {
        console.log((err as any).stack);
        logger.error(`Error compiling contracts:\n${String(err)}`);
        throw err;
    }
}

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.dirname(__filename);
