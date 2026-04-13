import { describe, it, expect, vi } from 'vitest';
import { createExecuteBashTool, createReadFileTool, createWriteFileTool } from '../src/tools.js';
import type { Backend } from '../src/types.js';

function mockBackend(overrides?: Partial<Backend>): Backend {
  return {
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: vi.fn().mockResolvedValue({ content: '', success: true }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('executeBash tool', () => {
  it('has correct id and description', () => {
    const backend = mockBackend();
    const tool = createExecuteBashTool(backend);

    expect(tool.id).toBe('agentsh-execute-bash');
    expect(tool.description).toContain('bash');
  });

  it('calls backend.exec with command', async () => {
    const backend = mockBackend({
      exec: vi.fn().mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 }),
    });
    const tool = createExecuteBashTool(backend);

    const result = await tool.execute({ command: 'echo hello' }, {});

    expect(backend.exec).toHaveBeenCalledWith('echo hello', { cwd: undefined, timeout: undefined });
    expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
  });

  it('passes cwd and timeout options', async () => {
    const backend = mockBackend();
    const tool = createExecuteBashTool(backend);

    await tool.execute({ command: 'ls', cwd: '/app', timeout: 5000 }, {});

    expect(backend.exec).toHaveBeenCalledWith('ls', { cwd: '/app', timeout: 5000 });
  });
});

describe('readFile tool', () => {
  it('has correct id', () => {
    const backend = mockBackend();
    const tool = createReadFileTool(backend);

    expect(tool.id).toBe('agentsh-read-file');
  });

  it('calls backend.readFile with path', async () => {
    const backend = mockBackend({
      readFile: vi.fn().mockResolvedValue({ content: 'data', success: true }),
    });
    const tool = createReadFileTool(backend);

    const result = await tool.execute({ path: '/workspace/file.txt' }, {});

    expect(backend.readFile).toHaveBeenCalledWith('/workspace/file.txt');
    expect(result).toEqual({ content: 'data', success: true });
  });
});

describe('writeFile tool', () => {
  it('has correct id', () => {
    const backend = mockBackend();
    const tool = createWriteFileTool(backend);

    expect(tool.id).toBe('agentsh-write-file');
  });

  it('calls backend.writeFile with path and content', async () => {
    const backend = mockBackend();
    const tool = createWriteFileTool(backend);

    const result = await tool.execute(
      { path: '/workspace/out.txt', content: 'hello' },
      {},
    );

    expect(backend.writeFile).toHaveBeenCalledWith('/workspace/out.txt', 'hello');
    expect(result).toEqual({ success: true });
  });
});
