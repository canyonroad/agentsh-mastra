import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.e2e') });

export const ENV = {
  E2B_API_KEY: process.env.E2B_API_KEY,
  DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
  DAYTONA_API_URL: process.env.DAYTONA_API_URL,
  DAYTONA_TARGET: process.env.DAYTONA_TARGET,
  BLAXEL_API_KEY: process.env.BLAXEL_API_KEY,
  BL_WORKSPACE: process.env.BL_WORKSPACE,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};
