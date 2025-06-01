import { PlonkProof } from '../../types';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1PlonkProof: PlonkProof = require('./mock-4393822-v4.0.0-rc.3.json');
export { sp1PlonkProof as sp1ConsensusMPTPlonkProof };
