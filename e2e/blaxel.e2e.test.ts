import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ENV } from './helpers.js';
import { agentshTools } from '../src/index.js';
import { blaxel } from '@agentsh/secure-sandbox/adapters/blaxel';

let sdkAvailable = false;
try { await import('@blaxel/core'); sdkAvailable = true; } catch {}

const canRun = !!ENV.BLAXEL_API_KEY && sdkAvailable;

describe.skipIf(!canRun)('Blaxel E2E', () => {
  let tools: Record<string, any>;
  let rawSandbox: any;

  beforeAll(async () => {
    const { SandboxInstance } = await import('@blaxel/core');

    // Cleanup any stale sandbox
    try { await SandboxInstance.delete('agentsh-mastra-e2e'); } catch {}
    await new Promise(r => setTimeout(r, 3000));

    // Create Blaxel sandbox
    rawSandbox = await SandboxInstance.create({
      name: 'agentsh-mastra-e2e',
      region: 'us-pdx-1',
    });

    // Create agentshTools with Blaxel adapter
    const adapter = blaxel(rawSandbox);
    tools = agentshTools({
      sandbox: { adapter },
    });
  }, 180_000);

  afterAll(async () => {
    try {
      const { SandboxInstance } = await import('@blaxel/core');
      await SandboxInstance.delete('agentsh-mastra-e2e');
    } catch {}
  });

  it('executeBash runs a command', async () => {
    const result = await tools.executeBash.execute({ command: 'echo hello' }, {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('writeFile and readFile roundtrip', async () => {
    const content = `test-${Date.now()}`;
    const path = '/workspace/test-roundtrip.txt';

    const writeResult = await tools.writeFile.execute({ path, content }, {});
    expect(writeResult.success).toBe(true);

    const readResult = await tools.readFile.execute({ path }, {});
    expect(readResult.success).toBe(true);
    expect(readResult.content.trim()).toBe(content);
  });

  it('executeBash returns exit code for failing commands', async () => {
    const result = await tools.executeBash.execute({ command: 'exit 42' }, {});
    expect(result.exitCode).toBe(42);
  });

  it('executeBash blocks sudo (policy enforcement)', async () => {
    const result = await tools.executeBash.execute({ command: 'sudo ls' }, {});
    expect(result.exitCode).not.toBe(0);
  });
});
