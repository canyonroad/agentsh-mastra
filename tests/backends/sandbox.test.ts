// tests/backends/sandbox.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxBackend } from '../../src/backends/sandbox.js';
import type { SandboxAdapter } from '@agentsh/secure-sandbox';

// Mock secureSandbox
vi.mock('@agentsh/secure-sandbox', async (importOriginal) => {
  const original = await importOriginal<typeof import('@agentsh/secure-sandbox')>();
  return {
    ...original,
    secureSandbox: vi.fn(),
  };
});

import { secureSandbox } from '@agentsh/secure-sandbox';

const mockSecured = {
  exec: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stop: vi.fn(),
  sessionId: 'sandbox-sess-1',
  securityMode: 'full' as const,
};

const mockAdapter: SandboxAdapter = {
  exec: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
};

describe('SandboxBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (secureSandbox as any).mockResolvedValue(mockSecured);
  });

  it('provisions sandbox on first exec call', async () => {
    mockSecured.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

    const backend = new SandboxBackend(mockAdapter);
    const result = await backend.exec('echo ok');

    expect(secureSandbox).toHaveBeenCalledOnce();
    expect(secureSandbox).toHaveBeenCalledWith(mockAdapter, expect.objectContaining({}));
    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
  });

  it('reuses secured sandbox on subsequent calls', async () => {
    mockSecured.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const backend = new SandboxBackend(mockAdapter);
    await backend.exec('cmd1');
    await backend.exec('cmd2');

    expect(secureSandbox).toHaveBeenCalledOnce();
  });

  it('passes policy and config to secureSandbox', async () => {
    mockSecured.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const policy = { file: [{ allow: ['/workspace/**'] }] };
    const config = { workspace: '/app' };

    const backend = new SandboxBackend(mockAdapter, policy, config);
    await backend.exec('test');

    expect(secureSandbox).toHaveBeenCalledWith(mockAdapter, {
      ...config,
      policy,
    });
  });

  it('readFile maps SecuredSandbox result', async () => {
    mockSecured.readFile.mockResolvedValue({
      success: true,
      path: '/workspace/f.txt',
      content: 'data',
    });

    const backend = new SandboxBackend(mockAdapter);
    const result = await backend.readFile('/workspace/f.txt');

    expect(result).toEqual({ content: 'data', success: true });
  });

  it('readFile maps failure result', async () => {
    mockSecured.readFile.mockResolvedValue({
      success: false,
      path: '/etc/shadow',
      error: 'denied',
    });

    const backend = new SandboxBackend(mockAdapter);
    const result = await backend.readFile('/etc/shadow');

    expect(result).toEqual({ content: '', success: false, error: 'denied' });
  });

  it('writeFile maps SecuredSandbox result', async () => {
    mockSecured.writeFile.mockResolvedValue({
      success: true,
      path: '/workspace/out.txt',
    });

    const backend = new SandboxBackend(mockAdapter);
    const result = await backend.writeFile('/workspace/out.txt', 'content');

    expect(result).toEqual({ success: true });
  });

  it('writeFile maps failure result', async () => {
    mockSecured.writeFile.mockResolvedValue({
      success: false,
      path: '/etc/passwd',
      error: 'denied by policy',
    });

    const backend = new SandboxBackend(mockAdapter);
    const result = await backend.writeFile('/etc/passwd', 'hacked');

    expect(result).toEqual({ success: false, error: 'denied by policy' });
  });
});
