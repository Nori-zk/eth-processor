import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ethVerifierVkHash: string = require('./EthVerifier.VKHash.json');
export { ethVerifierVkHash };