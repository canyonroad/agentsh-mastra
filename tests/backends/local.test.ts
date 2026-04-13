// tests/backends/local.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBackend } from '../../src/backends/local.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock fs
vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock secure-sandbox policy serialization
vi.mock('@agentsh/secure-sandbox/policies', () => ({
  serializePolicy: vi.fn(() => 'version: 1\nname: test\n'),
}));

import { execFile } from 'node:child_process';

function mockExecFile(impl: (...args: any[]) => any) {
  (execFile as any).mockImplementation(
    (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
      // Handle both 3-arg and 4-arg signatures
      const callback = cb ?? _opts;
      try {
        const result = impl(_cmd, _args);
        callback(null, result.stdout ?? '', result.stderr ?? '');
      } catch (err) {
        callback(err);
      }
    },
  );
}

describe('LocalBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a session on first exec call', async () => {
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') return { stdout: 'sess-123\n' };
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 0, stdout: 'hello', stderr: '' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    const result = await backend.exec('echo hello');

    expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
  });

  it('reuses session on subsequent calls', async () => {
    let sessionCreateCount = 0;
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') {
        sessionCreateCount++;
        return { stdout: 'sess-123\n' };
      }
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 0, stdout: '', stderr: '' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    await backend.exec('cmd1');
    await backend.exec('cmd2');

    expect(sessionCreateCount).toBe(1);
  });

  it('throws when agentsh binary is not found', async () => {
    mockExecFile(() => {
      throw new Error('ENOENT');
    });

    const backend = new LocalBackend();
    await expect(backend.exec('test')).rejects.toThrow('AgentSH binary not found');
  });

  it('returns policy denials as results (exitCode 126)', async () => {
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') return { stdout: 'sess-123\n' };
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 126, stdout: '', stderr: 'denied by policy' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    const result = await backend.exec('sudo rm -rf /');

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toBe('denied by policy');
  });

  it('readFile returns content on success', async () => {
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') return { stdout: 'sess-123\n' };
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 0, stdout: 'file contents', stderr: '' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    const result = await backend.readFile('/workspace/test.txt');

    expect(result).toEqual({ content: 'file contents', success: true });
  });

  it('readFile returns error on denial', async () => {
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') return { stdout: 'sess-123\n' };
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 126, stdout: '', stderr: 'denied' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    const result = await backend.readFile('/etc/shadow');

    expect(result).toEqual({ content: '', success: false, error: 'denied' });
  });

  it('writeFile returns success', async () => {
    mockExecFile((cmd: string, args: string[]) => {
      if (args[0] === 'version') return { stdout: '0.18.0' };
      if (args[0] === 'session') return { stdout: 'sess-123\n' };
      if (args[0] === 'exec') {
        return {
          stdout: JSON.stringify({
            result: { exit_code: 0, stdout: '', stderr: '' },
          }),
        };
      }
      return { stdout: '' };
    });

    const backend = new LocalBackend();
    const result = await backend.writeFile('/workspace/out.txt', 'data');

    expect(result).toEqual({ success: true });
  });
});
