import { ConvertedProofProofData } from "../interfaces";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const p0: ConvertedProofProofData = require('./p0.json');
export { p0 };