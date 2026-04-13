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
  VERCEL_TOKEN: process.env.VERCEL_TOKEN,
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
  MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
  MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};
