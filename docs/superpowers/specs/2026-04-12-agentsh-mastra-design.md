# @agentsh/mastra — Design Spec

A library that integrates AgentSH with MastraAI, providing Mastra tools that execute through AgentSH policy enforcement.

## Modes

**Mode 2 — Wrap tool execution:** The library provides Mastra tools (executeBash, readFile, writeFile) that route through a local `agentsh` binary. AgentSH is already running on the machine.

**Mode 3 — Provision into sandbox:** Same tools, but AgentSH is provisioned into a remote sandbox provider (Vercel, E2B, Modal, etc.) via `@agentsh/secure-sandbox`.

**Mode 1 — Run under AgentSH:** Documentation only. Running `agentsh exec <session> -- node mastra-app.js` wraps the entire Mastra process. No library code needed.

## Package structure

```
@agentsh/mastra/
├── src/
│   ├── index.ts              # Public API: agentshTools(), policy re-exports
│   ├── tools.ts              # Mastra tool definitions (executeBash, readFile, writeFile)
│   ├── factory.ts            # agentshTools() — creates tools bound to a backend
│   ├── backends/
│   │   ├── local.ts          # Mode 2: shells out to `agentsh exec`
│   │   └── sandbox.ts        # Mode 3: uses @agentsh/secure-sandbox
│   ├── session.ts            # Lazy session creation & cleanup
│   └── types.ts              # Config types, backend interface
├── package.json
└── tsconfig.json
```

### Dependencies

- `@mastra/core` — peer dependency (tool definitions, Zod)
- `@agentsh/secure-sandbox` — optional peer dependency (only needed for Mode 3)
- `zod` — peer dependency (shared with Mastra)

No hard dependencies beyond what Mastra already requires.

## Main API

### `agentshTools(config?)`

Single entry point. Returns a record of Mastra tools. The `sandbox` field in config determines the mode:

- `sandbox` present → Mode 3 (provision into sandbox via secure-sandbox)
- `sandbox` absent → Mode 2 (use local `agentsh` binary)

```typescript
interface AgentSHToolsConfig {
  policy?: PolicyDefinition;       // Default: agentDefault()
  workspace?: string;              // Default: '/workspace'

  // If present → Mode 3. If absent → Mode 2.
  sandbox?: {
    adapter: SandboxAdapter;       // From secure-sandbox (vercel(), e2b(), etc.)
    config?: Partial<SecureConfig>; // Passed through to secureSandbox()
  };
}

function agentshTools(config?: AgentSHToolsConfig): Record<string, Tool>;
```

### Usage

```typescript
// Mode 2 — local AgentSH
import { agentshTools, agentDefault } from '@agentsh/mastra';

const agent = new Agent({
  tools: agentshTools({ policy: agentDefault() }),
});

// Mode 3 — sandbox
import { agentshTools, agentDefault } from '@agentsh/mastra';
import { vercel } from '@agentsh/secure-sandbox/adapters';

const agent = new Agent({
  tools: agentshTools({
    policy: agentDefault(),
    sandbox: { adapter: vercel(sandbox) },
  }),
});
```

## Tools

Three core tools, matching AgentSH's enforcement surface:

### `executeBash`

Execute a bash command through AgentSH policy enforcement.

```typescript
createTool({
  id: 'agentsh-execute-bash',
  description: 'Execute a bash command in a secure AgentSH-enforced environment',
  inputSchema: z.object({
    command: z.string().describe('The bash command to execute'),
    cwd: z.string().optional().describe('Working directory'),
    timeout: z.number().optional().describe('Timeout in ms'),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
})
```

Routes through: `agentsh exec <session> -- bash -c <command>`

### `readFile`

Read a file subject to AgentSH file policy.

```typescript
createTool({
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
})
```

Routes through: `agentsh exec <session> -- cat <path>`

### `writeFile`

Write to a file subject to AgentSH file policy.

```typescript
createTool({
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
})
```

## Backend interface

Both backends implement the same interface:

```typescript
interface Backend {
  exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<ExecResult>;
  readFile(path: string): Promise<{ content: string; success: boolean; error?: string }>;
  writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }>;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### Local backend (Mode 2)

Shells out to the `agentsh` CLI. Assumes the AgentSH server is already running (started externally, or auto-started by the shell shim on first command).

1. On first tool call, serializes the policy to a temporary YAML file on disk (reuses `serializePolicy` from secure-sandbox)
2. Creates a session: `agentsh session create --workspace <workspace> --policy <policy-name>`
3. Routes all commands through: `agentsh exec --output json <sessionId> -- bash -c <command>`
4. Parses the JSON response envelope from AgentSH
5. Assumes `agentsh` binary is on `$PATH`. Fails fast with a clear error if not found.

Session is created lazily (not at `agentshTools()` call time) so the factory call is synchronous.

### Sandbox backend (Mode 3)

Delegates to `@agentsh/secure-sandbox`:

1. On first tool call, provisions AgentSH into the sandbox: `await secureSandbox(adapter, config)`
2. Routes all commands through the `SecuredSandbox` interface returned by secure-sandbox
3. All provisioning logic (binary install, shim, server start, session creation) is handled by secure-sandbox

## Session lifecycle

**Creation:** Lazy — triggered by the first tool call. Keeps `agentshTools()` synchronous.

**Destruction:** Handled by infrastructure, not the library.

- Local (Mode 2): Sessions clean up when the AgentSH server stops on process exit.
- Sandbox (Mode 3): Sessions die when the sandbox is torn down by the developer (`sandbox.close()`).

No explicit cleanup API. No hooks into Mastra lifecycle.

## Error handling

Three categories:

### Setup errors — fail fast

- `agentsh` binary not found on `$PATH` (Mode 2): throw with install instructions
- `@agentsh/secure-sandbox` not installed (Mode 3): throw with install instructions
- Session creation fails: throw with stderr from `agentsh session create`

These throw on the first tool call (lazy initialization).

### Policy denials — returned as tool results

When AgentSH denies a command, the tool returns it as a normal result so the LLM can reason about it:

```typescript
{
  stdout: '',
  stderr: 'denied by policy: command "sudo" matched rule "deny-dangerous"',
  exitCode: 126,  // AgentSH denial exit code
}
```

Not thrown as exceptions. The agent sees the denial and can adjust its approach.

### Infrastructure errors — thrown as exceptions

AgentSH server crash, sandbox connection lost, timeout exceeded. These bubble up through Mastra's standard error handling. The agent cannot recover from these.

## Public exports

```typescript
// The factory
export { agentshTools } from './factory';

// Types
export type { AgentSHToolsConfig } from './types';

// Re-exported from @agentsh/secure-sandbox
export { agentDefault, devSafe, ciStrict, agentSandbox } from '@agentsh/secure-sandbox/policies';
export { merge, mergePrepend } from '@agentsh/secure-sandbox/policies';
export type { PolicyDefinition } from '@agentsh/secure-sandbox/policies';
```

Developers only need to import from `@agentsh/mastra` for the common case. Sandbox adapters (vercel, e2b, etc.) are imported from `@agentsh/secure-sandbox` directly when using Mode 3.
