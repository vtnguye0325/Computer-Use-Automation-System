/** Process configuration. Read once, validated, never scattered through the code. */
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  CUAS_MODEL: z.string().default('claude-opus-5'),
  CUAS_TARGET_URL: z.string().default('http://localhost:4173'),
  CUAS_HEADED: z.string().default('1'),
  CUAS_CDP_PORT: z.coerce.number().int().default(9222),
  CUAS_OPERATOR_PORT: z.coerce.number().int().default(4174),
  CUAS_APP_PORT: z.coerce.number().int().default(4173),
});

const env = EnvSchema.parse(process.env);

export const config = {
  model: env.CUAS_MODEL,
  targetUrl: env.CUAS_TARGET_URL,
  headed: env.CUAS_HEADED !== '0',
  cdpPort: env.CUAS_CDP_PORT,
  operatorPort: env.CUAS_OPERATOR_PORT,
  appPort: env.CUAS_APP_PORT,
  capabilitiesDir: 'capabilities',
  evidenceDir: 'evidence',
  policyFile: 'policy.yaml',
} as const;

/** Discovery needs a key. Replay must never require one — that is the point. */
export function requireApiKey(): string {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for a discovery run. Copy .env.example to .env.');
  }
  return env.ANTHROPIC_API_KEY;
}
