/**
 * Example: Using agentshTools with Vercel Sandbox (no Mastra agent needed)
 *
 * This shows how to use @agentsh/mastra tools directly with any sandbox
 * provider supported by @agentsh/secure-sandbox — even if Mastra doesn't
 * have a native integration for that provider.
 *
 * The tools work standalone: call tool.execute() directly for scripted
 * automation, or pass them to a Mastra Agent for LLM-driven execution.
 *
 * Prerequisites:
 *   - VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID in .env.e2e
 *
 * Run:
 *   npx tsx examples/vercel.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.e2e') });

import { agentshTools, agentDefault } from '../src/index.js';
import { vercel } from '@agentsh/secure-sandbox/adapters/vercel';
import { Sandbox } from '@vercel/sandbox';

async function main() {
  // ── Step 1: Create the sandbox ──────────────────────────────
  // This is the provider's own SDK — nothing Mastra-specific here.
  console.log('Creating Vercel sandbox...');
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 300_000,
    token: process.env.VERCEL_TOKEN!,
    projectId: process.env.VERCEL_PROJECT_ID!,
    teamId: process.env.VERCEL_TEAM_ID!,
  });

  // Install agentsh system deps (Vercel uses Fedora/dnf)
  await sandbox.runCommand({
    cmd: 'dnf',
    args: ['install', '-y', 'libseccomp', 'fuse3', 'fuse3-libs'],
    sudo: true,
  });

  // ── Step 2: Create agentshTools ─────────────────────────────
  // Wrap the raw sandbox with the secure-sandbox adapter, then
  // pass it to agentshTools. AgentSH is provisioned lazily on
  // first tool call.
  console.log('Creating AgentSH-secured tools...');
  const tools = agentshTools({
    policy: agentDefault(),
    sandbox: {
      adapter: vercel(sandbox),
      config: { skipIntegrityCheck: true },
    },
  });

  // ── Step 3: Use the tools directly ──────────────────────────
  // No Mastra Agent needed — call execute() for scripted use.

  console.log('\n--- Running commands ---\n');

  // Execute bash
  const echo = await tools.executeBash.execute({ command: 'echo "Hello from Vercel sandbox!"' }, {});
  console.log(`echo result (exit ${echo.exitCode}): ${echo.stdout.trim()}`);

  // Write a file
  const code = 'console.log("fibonacci:", Array.from({length: 10}, (_, i, a = [0, 1]) => (i < 2 ? i : a.push(a[a.length-1] + a[a.length-2]) && a[a.length-1])));';
  await tools.writeFile.execute({ path: '/workspace/fib.js', content: code }, {});
  console.log('Wrote /workspace/fib.js');

  // Run it
  const run = await tools.executeBash.execute({ command: 'node /workspace/fib.js' }, {});
  console.log(`node result (exit ${run.exitCode}): ${run.stdout.trim()}`);

  // Read it back
  const read = await tools.readFile.execute({ path: '/workspace/fib.js' }, {});
  console.log(`Read back ${read.content.length} chars from /workspace/fib.js`);

  // System info
  const info = await tools.executeBash.execute({ command: 'uname -a && node --version' }, {});
  console.log(`\nSystem: ${info.stdout.trim()}`);

  // ── Cleanup ─────────────────────────────────────────────────
  console.log('\nStopping sandbox...');
  await sandbox.stop();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
