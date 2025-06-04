import { ConvertedProofVkData } from '../../types.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vkData: ConvertedProofVkData = require('./nodeVk.json');
export { vkData };