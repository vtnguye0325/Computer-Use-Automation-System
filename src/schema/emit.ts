/**
 * Emits JSON Schema from the Zod definitions.
 *
 * The artifact contract has one source of truth. A calling agent that is not
 * written in TypeScript reads the emitted JSON Schema instead.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CapabilitySchema, SCHEMA_VERSION } from './capability.js';

const outDir = 'capabilities/schema';
const outFile = `${outDir}/capability-${SCHEMA_VERSION}.json`;

await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify(z.toJSONSchema(CapabilitySchema), null, 2) + '\n');
console.log(`wrote ${outFile}`);
