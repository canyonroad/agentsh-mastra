// tests/factory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentshTools } from '../src/factory.js';
import type { SandboxAdapter } from '@agentsh/secure-sandbox';

// Mock backends
vi.mock('../src/backends/local.js', () => ({
  LocalBackend: vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: vi.fn().mockResolvedValue({ content: '', success: true }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock('../src/backends/sandbox.js', () => ({
  SandboxBackend: vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: vi.fn().mockResolvedValue({ content: '', success: true }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

import { LocalBackend } from '../src/backends/local.js';
import { SandboxBackend } from '../src/backends/sandbox.js';

describe('agentshTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns executeBash, readFile, writeFile tools', () => {
    const tools = agentshTools();
    expect(tools).toHaveProperty('executeBash');
    expect(tools).toHaveProperty('readFile');
    expect(tools).toHaveProperty('writeFile');
  });

  it('uses LocalBackend when no sandbox config', () => {
    agentshTools({ workspace: '/app' });

    expect(LocalBackend).toHaveBeenCalledOnce();
    expect(SandboxBackend).not.toHaveBeenCalled();
  });

  it('passes policy and workspace to LocalBackend', () => {
    const policy = { file: [{ allow: ['/workspace/**'] }] };
    agentshTools({ policy, workspace: '/app' });

    expect(LocalBackend).toHaveBeenCalledWith(policy, '/app');
  });

  it('uses SandboxBackend when sandbox config present', () => {
    const adapter: SandboxAdapter = {
      exec: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
    };

    agentshTools({ sandbox: { adapter } });

    expect(SandboxBackend).toHaveBeenCalledOnce();
    expect(LocalBackend).not.toHaveBeenCalled();
  });

  it('passes adapter, policy, and config to SandboxBackend', () => {
    const adapter: SandboxAdapter = {
      exec: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
    };
    const policy = { file: [{ deny: ['**'] }] };
    const config = { workspace: '/sandbox' };

    agentshTools({ policy, sandbox: { adapter, config } });

    expect(SandboxBackend).toHaveBeenCalledWith(adapter, policy, config);
  });

  it('defaults to empty config when called with no args', () => {
    agentshTools();

    expect(LocalBackend).toHaveBeenCalledWith(undefined, undefined);
  });
});
