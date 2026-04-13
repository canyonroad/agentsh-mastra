import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { ENV } from './helpers.js';
import { agentshTools } from '../src/index.js';
import { vercel } from '@agentsh/secure-sandbox/adapters/vercel';

const require = createRequire(import.meta.url);
let sdkAvailable = false;
try { require.resolve('@vercel/sandbox'); sdkAvailable = true; } catch {}

const canRun = !!ENV.VERCEL_TOKEN && sdkAvailable;

describe.skipIf(!canRun)('Vercel E2E', () => {
  let tools: Record<string, any>;
  let rawSandbox: any;

  beforeAll(async () => {
    const { Sandbox } = await import('@vercel/sandbox');

    rawSandbox = await Sandbox.create({
      runtime: 'node24',
      timeout: 600_000,
      token: ENV.VERCEL_TOKEN!,
      projectId: ENV.VERCEL_PROJECT_ID!,
      teamId: ENV.VERCEL_TEAM_ID!,
    });

    // Install system deps required by agentsh
    await rawSandbox.runCommand({
      cmd: 'dnf',
      args: ['install', '-y', 'libseccomp', 'fuse3', 'fuse3-libs'],
      sudo: true,
    });

    const adapter = vercel(rawSandbox);
    tools = agentshTools({
      sandbox: { adapter, config: { skipIntegrityCheck: true } },
    });
  }, 300_000);

  afterAll(async () => {
    try {
      await rawSandbox?.stop();
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

  it('executeBash handles non-existent commands', async () => {
    const result = await tools.executeBash.execute({ command: 'nonexistent_cmd_xyz' }, {});
    expect(result.exitCode).not.toBe(0);
  });

  it('executeBash can run multi-line scripts', async () => {
    const result = await tools.executeBash.execute({
      command: 'for i in 1 2 3; do echo $i; done',
    }, {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('1\n2\n3');
  });

  it('readFile returns error for non-existent files', async () => {
    const result = await tools.readFile.execute({ path: '/workspace/does-not-exist.txt' }, {});
    expect(result.success).toBe(false);
  });
});
