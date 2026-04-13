import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { ENV } from './helpers.js';
import { agentshTools } from '../src/index.js';
import { e2b } from '@agentsh/secure-sandbox/adapters/e2b';

const require = createRequire(import.meta.url);
let sdkAvailable = false;
try { require.resolve('e2b'); sdkAvailable = true; } catch {}

const canRun = !!ENV.E2B_API_KEY && sdkAvailable;

describe.skipIf(!canRun)('E2B E2E', () => {
  let tools: Record<string, any>;
  let rawSandbox: any;

  beforeAll(async () => {
    const e2bMod = await import('e2b');

    // Create E2B sandbox
    rawSandbox = await e2bMod.Sandbox.create('agentsh-sandbox', {
      timeoutMs: 600_000,
    });

    // Create agentshTools with E2B adapter
    const adapter = e2b(rawSandbox);
    tools = agentshTools({
      sandbox: { adapter },
    });
  }, 180_000);

  afterAll(async () => {
    try {
      await rawSandbox?.kill();
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
    // Policy denial returns exit code 126
    if (result.exitCode === 126) {
      expect(result.stderr).toContain('denied');
    }
    // In any case, sudo should not succeed
    expect(result.exitCode).not.toBe(0);
  });

  it('readFile denies access to sensitive files', async () => {
    const result = await tools.readFile.execute({ path: '/etc/shadow' }, {});
    // Either denied by policy or permission error
    expect(result.success === false || result.content === '').toBe(true);
  });

  it('executeBash can run multi-line scripts', async () => {
    const result = await tools.executeBash.execute({
      command: 'for i in 1 2 3; do echo $i; done',
    }, {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('1\n2\n3');
  });
});
