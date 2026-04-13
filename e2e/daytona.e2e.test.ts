import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { ENV } from './helpers.js';
import { agentshTools } from '../src/index.js';
import { daytona } from '@agentsh/secure-sandbox/adapters/daytona';

const require = createRequire(import.meta.url);
let sdkAvailable = false;
try { require.resolve('@daytonaio/sdk'); sdkAvailable = true; } catch {}

const canRun = !!ENV.DAYTONA_API_KEY && sdkAvailable;

describe.skipIf(!canRun)('Daytona E2E', () => {
  let tools: Record<string, any>;
  let rawSandbox: any;
  let daytonaClient: any;

  beforeAll(async () => {
    const mod = await import('@daytonaio/sdk');

    // Create Daytona client and sandbox
    daytonaClient = new mod.Daytona();
    rawSandbox = await daytonaClient.create();

    // Create agentshTools with Daytona adapter
    const adapter = daytona(rawSandbox);
    tools = agentshTools({
      sandbox: { adapter },
    });
  }, 180_000);

  afterAll(async () => {
    try {
      if (rawSandbox && daytonaClient) {
        await daytonaClient.delete(rawSandbox);
      }
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
    // sudo should not succeed — either denied by policy (126) or permission error
    expect(result.exitCode).not.toBe(0);
  });

  it('executeBash can run multi-line scripts', async () => {
    const result = await tools.executeBash.execute({
      command: 'for i in 1 2 3; do echo $i; done',
    }, {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('1\n2\n3');
  });
});
