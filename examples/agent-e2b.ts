/**
 * Example: Mastra agent with AgentSH-secured E2B sandbox
 *
 * This creates a Mastra agent that can execute code securely
 * in an E2B sandbox, with AgentSH policy enforcement.
 *
 * Prerequisites:
 *   - E2B_API_KEY in .env.e2e
 *   - ANTHROPIC_API_KEY in .env.e2e (or environment)
 *
 * Run:
 *   npx tsx examples/agent-e2b.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.e2e') });

import { Agent } from '@mastra/core/agent';
import { agentshTools, agentDefault } from '../src/index.js';
import { e2b } from '@agentsh/secure-sandbox/adapters/e2b';
import { Sandbox } from 'e2b';

async function main() {
  console.log('Creating E2B sandbox...');
  const sandbox = await Sandbox.create('agentsh-sandbox', {
    timeoutMs: 300_000,
  });

  console.log('Setting up AgentSH-secured tools...');
  const tools = agentshTools({
    policy: agentDefault(),
    sandbox: { adapter: e2b(sandbox) },
  });

  console.log('Creating Mastra agent...');
  const agent = new Agent({
    id: 'secure-coder',
    name: 'secure-coder',
    instructions: `You are a coding assistant with access to a secure sandbox.
You can execute bash commands, read files, and write files.
The sandbox has AgentSH policy enforcement — dangerous operations
like sudo, reading credentials, or accessing private networks are blocked.
Use the tools available to complete the user's task.`,
    model: 'anthropic/claude-sonnet-4-20250514',
    tools,
  });

  console.log('\nAsking agent to write and run a script...\n');

  const response = await agent.generate(
    'Write a Python script that prints the first 10 Fibonacci numbers, save it to /workspace/fib.py, then run it and show me the output.',
  );

  console.log('Agent response:');
  console.log(response.text);

  // Demonstrate policy enforcement
  console.log('\n--- Policy enforcement demo ---\n');
  console.log('Asking agent to try something forbidden...\n');

  const denied = await agent.generate(
    'Try to run: sudo cat /etc/shadow',
  );

  console.log('Agent response to forbidden request:');
  console.log(denied.text);

  // Cleanup
  console.log('\nCleaning up sandbox...');
  await sandbox.kill();
  console.log('Done.');
}

main().catch(console.error);
