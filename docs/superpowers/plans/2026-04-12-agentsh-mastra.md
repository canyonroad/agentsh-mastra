# @agentsh/mastra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a library that provides Mastra AI tools backed by AgentSH policy enforcement, supporting both local execution (Mode 2) and sandbox provisioning (Mode 3).

**Architecture:** Unified `agentshTools()` factory returns Mastra tools (executeBash, readFile, writeFile). A `Backend` interface abstracts the execution layer — `LocalBackend` shells out to the `agentsh` CLI, `SandboxBackend` delegates to `@agentsh/secure-sandbox`. Backends lazily initialize sessions on first tool call.

**Tech Stack:** TypeScript (ESM), `@mastra/core` (tools), `@agentsh/secure-sandbox` (policy serialization + sandbox provisioning), `zod` (schemas), `vitest` (testing)

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agentsh/mastra",
  "version": "0.1.0",
  "description": "AgentSH integration for MastraAI — secure, policy-enforced tools for Mastra agents",
  "license": "Apache-2.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agentsh/secure-sandbox": "^0.4.0"
  },
  "peerDependencies": {
    "@mastra/core": ">=0.10.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@mastra/core": "^0.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "zod": "^3.24.0"
  }
}
```

Note: `@agentsh/secure-sandbox` is a regular dependency (not optional) because Mode 2 needs `serializePolicy` for policy serialization. This is a change from the spec which said "optional peer dep" — practical implementation requires it for both modes.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Create directory structure**

```bash
mkdir -p src/backends tests/backends
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold @agentsh/mastra project"
```

---

### Task 2: Types and backend interface

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`

- [ ] **Step 1: Write the type test**

```typescript
// tests/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Backend, ExecResult, AgentSHToolsConfig } from '../src/types.js';

describe('types', () => {
  it('Backend has the required methods', () => {
    expectTypeOf<Backend>().toHaveProperty('exec');
    expectTypeOf<Backend>().toHaveProperty('readFile');
    expectTypeOf<Backend>().toHaveProperty('writeFile');
  });

  it('ExecResult has stdout, stderr, exitCode', () => {
    expectTypeOf<ExecResult>().toMatchTypeOf<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>();
  });

  it('AgentSHToolsConfig sandbox field is optional', () => {
    expectTypeOf<AgentSHToolsConfig>().toMatchTypeOf<{
      policy?: unknown;
      workspace?: string;
      sandbox?: unknown;
    }>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write types.ts**

```typescript
// src/types.ts
import type { PolicyDefinition, SandboxAdapter, SecureConfig } from '@agentsh/secure-sandbox';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ReadFileResult {
  content: string;
  success: boolean;
  error?: string;
}

export interface WriteFileResult {
  success: boolean;
  error?: string;
}

export interface Backend {
  exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<ExecResult>;
  readFile(path: string): Promise<ReadFileResult>;
  writeFile(path: string, content: string): Promise<WriteFileResult>;
}

export interface AgentSHToolsConfig {
  policy?: PolicyDefinition;
  workspace?: string;
  sandbox?: {
    adapter: SandboxAdapter;
    config?: Partial<SecureConfig>;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add Backend interface and config types"
```

---

### Task 3: Local backend

**Files:**
- Create: `src/backends/local.ts`
- Create: `tests/backends/local.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backends/local.test.ts`
Expected: FAIL — cannot find `../../src/backends/local.js`

- [ ] **Step 3: Write the local backend**

```typescript
// src/backends/local.ts
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializePolicy } from '@agentsh/secure-sandbox/policies';
import type { PolicyDefinition } from '@agentsh/secure-sandbox';
import type { Backend, ExecResult, ReadFileResult, WriteFileResult } from '../types.js';

const execFile = promisify(execFileCb);

export class LocalBackend implements Backend {
  private sessionId: string | null = null;
  private readonly policy: PolicyDefinition;
  private readonly workspace: string;

  constructor(policy?: PolicyDefinition, workspace?: string) {
    this.policy = policy ?? {};
    this.workspace = workspace ?? '/workspace';
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;

    try {
      await execFile('agentsh', ['version']);
    } catch {
      throw new Error(
        'AgentSH binary not found on $PATH. Install from https://github.com/canyonroad/agentsh or use sandbox mode.',
      );
    }

    const policyDir = join(tmpdir(), 'agentsh-mastra');
    mkdirSync(policyDir, { recursive: true });
    const policyPath = join(policyDir, 'policy.yml');
    writeFileSync(policyPath, serializePolicy(this.policy));

    const { stdout } = await execFile('agentsh', [
      'session', 'create',
      '--workspace', this.workspace,
      '--policy-file', policyPath,
    ]);

    this.sessionId = stdout.trim();
    return this.sessionId;
  }

  async exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<ExecResult> {
    const sessionId = await this.ensureSession();
    const shellCmd = opts?.cwd ? `cd ${shellEscape(opts.cwd)} && ${command}` : command;
    const args = ['exec', '--output', 'json', sessionId, '--', 'bash', '-c', shellCmd];

    const { stdout } = await execFile('agentsh', args, {
      timeout: opts?.timeout,
    });

    const parsed = JSON.parse(stdout);
    return {
      stdout: parsed.result?.stdout ?? '',
      stderr: parsed.result?.stderr ?? '',
      exitCode: parsed.result?.exit_code ?? 1,
    };
  }

  async readFile(path: string): Promise<ReadFileResult> {
    const result = await this.exec(`cat ${shellEscape(path)}`);
    if (result.exitCode === 0) {
      return { content: result.stdout, success: true };
    }
    return { content: '', success: false, error: result.stderr };
  }

  async writeFile(path: string, content: string): Promise<WriteFileResult> {
    const encoded = Buffer.from(content).toString('base64');
    const result = await this.exec(
      `echo ${shellEscape(encoded)} | base64 -d > ${shellEscape(path)}`,
    );
    if (result.exitCode === 0) {
      return { success: true };
    }
    return { success: false, error: result.stderr };
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backends/local.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backends/local.ts tests/backends/local.test.ts
git commit -m "feat: add local backend — shells out to agentsh CLI"
```

---

### Task 4: Sandbox backend

**Files:**
- Create: `src/backends/sandbox.ts`
- Create: `tests/backends/sandbox.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backends/sandbox.test.ts`
Expected: FAIL — cannot find `../../src/backends/sandbox.js`

- [ ] **Step 3: Write the sandbox backend**

```typescript
// src/backends/sandbox.ts
import { secureSandbox } from '@agentsh/secure-sandbox';
import type { PolicyDefinition, SandboxAdapter, SecureConfig, SecuredSandbox } from '@agentsh/secure-sandbox';
import type { Backend, ExecResult, ReadFileResult, WriteFileResult } from '../types.js';

export class SandboxBackend implements Backend {
  private secured: SecuredSandbox | null = null;
  private readonly adapter: SandboxAdapter;
  private readonly policy?: PolicyDefinition;
  private readonly config: Partial<SecureConfig>;

  constructor(adapter: SandboxAdapter, policy?: PolicyDefinition, config?: Partial<SecureConfig>) {
    this.adapter = adapter;
    this.policy = policy;
    this.config = config ?? {};
  }

  private async ensureInit(): Promise<SecuredSandbox> {
    if (this.secured) return this.secured;
    this.secured = await secureSandbox(this.adapter, {
      ...this.config,
      policy: this.policy,
    });
    return this.secured;
  }

  async exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<ExecResult> {
    const secured = await this.ensureInit();
    return secured.exec(command, opts);
  }

  async readFile(path: string): Promise<ReadFileResult> {
    const secured = await this.ensureInit();
    const result = await secured.readFile(path);
    if (result.success) {
      return { content: result.content, success: true };
    }
    return { content: '', success: false, error: result.error };
  }

  async writeFile(path: string, content: string): Promise<WriteFileResult> {
    const secured = await this.ensureInit();
    const result = await secured.writeFile(path, content);
    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backends/sandbox.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backends/sandbox.ts tests/backends/sandbox.test.ts
git commit -m "feat: add sandbox backend — delegates to @agentsh/secure-sandbox"
```

---

### Task 5: Tool definitions

**Files:**
- Create: `src/tools.ts`
- Create: `tests/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tools.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — cannot find `../src/tools.js`

- [ ] **Step 3: Write the tool definitions**

```typescript
// src/tools.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Backend } from './types.js';

export function createExecuteBashTool(backend: Backend) {
  return createTool({
    id: 'agentsh-execute-bash',
    description: 'Execute a bash command in a secure AgentSH-enforced environment',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().optional().describe('Timeout in milliseconds'),
    }),
    outputSchema: z.object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
    }),
    execute: async (input) => {
      return backend.exec(input.command, {
        cwd: input.cwd,
        timeout: input.timeout,
      });
    },
  });
}

export function createReadFileTool(backend: Backend) {
  return createTool({
    id: 'agentsh-read-file',
    description: 'Read a file from the AgentSH-enforced filesystem',
    inputSchema: z.object({
      path: z.string().describe('Absolute path to the file'),
    }),
    outputSchema: z.object({
      content: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      return backend.readFile(input.path);
    },
  });
}

export function createWriteFileTool(backend: Backend) {
  return createTool({
    id: 'agentsh-write-file',
    description: 'Write content to a file in the AgentSH-enforced filesystem',
    inputSchema: z.object({
      path: z.string().describe('Absolute path to the file'),
      content: z.string().describe('Content to write'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      return backend.writeFile(input.path, input.content);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: add Mastra tool definitions — executeBash, readFile, writeFile"
```

---

### Task 6: Factory

**Files:**
- Create: `src/factory.ts`
- Create: `tests/factory.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/factory.test.ts`
Expected: FAIL — cannot find `../src/factory.js`

- [ ] **Step 3: Write the factory**

```typescript
// src/factory.ts
import { LocalBackend } from './backends/local.js';
import { SandboxBackend } from './backends/sandbox.js';
import { createExecuteBashTool, createReadFileTool, createWriteFileTool } from './tools.js';
import type { AgentSHToolsConfig } from './types.js';

export function agentshTools(config?: AgentSHToolsConfig) {
  const backend = config?.sandbox
    ? new SandboxBackend(config.sandbox.adapter, config.policy, config.sandbox.config)
    : new LocalBackend(config?.policy, config?.workspace);

  return {
    executeBash: createExecuteBashTool(backend),
    readFile: createReadFileTool(backend),
    writeFile: createWriteFileTool(backend),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/factory.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/factory.ts tests/factory.test.ts
git commit -m "feat: add agentshTools() factory — unified entry point"
```

---

### Task 7: Public exports and build

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
// src/index.ts
export { agentshTools } from './factory.js';

export type { AgentSHToolsConfig, Backend, ExecResult, ReadFileResult, WriteFileResult } from './types.js';

export {
  agentDefault,
  devSafe,
  ciStrict,
  agentSandbox,
  merge,
  mergePrepend,
} from '@agentsh/secure-sandbox/policies';

export type { PolicyDefinition } from '@agentsh/secure-sandbox/policies';
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Build the project**

Run: `npx tsc`
Expected: Clean build, no errors. `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 4: Verify dist exports**

Run: `node -e "import('@agentsh/mastra').then(m => console.log(Object.keys(m)))"`

If that fails due to package resolution, verify with:
Run: `node -e "import('./dist/index.js').then(m => console.log(Object.keys(m)))"`
Expected: `['agentshTools', 'agentDefault', 'devSafe', 'ciStrict', 'agentSandbox', 'merge', 'mergePrepend', 'serializePolicy']`

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add public exports — complete @agentsh/mastra library"
```
