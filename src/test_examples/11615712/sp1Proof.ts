import { PlonkProof } from '../../types';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1PlonkProof: PlonkProof = require('./sp1Proof.json');
export { sp1PlonkProof };
