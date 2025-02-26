import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_PATH = join(__dirname, '../../src/proofs');

export const PATH_TO_SP1_PROOF = join(BASE_PATH, `sp1Proof.json`);
export const PATH_TO_O1_PROOF = join(BASE_PATH, `p0.json`);
export const PATH_TO_O1_VK = join(BASE_PATH, `nodeVk.json`);
