import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ENV } from './helpers.js';
import { agentshTools } from '../src/index.js';
import { blaxel } from '@agentsh/secure-sandbox/adapters/blaxel';
import { serializePolicy, systemPolicyYaml, agentDefault } from '@agentsh/secure-sandbox/policies';

let sdkAvailable = false;
try { await import('@blaxel/core'); sdkAvailable = true; } catch {}

const canRun = !!ENV.BLAXEL_API_KEY && sdkAvailable;

// Minimal server config — matches generateServerConfig({}) defaults
const SERVER_CONFIG = `server:
  http:
    addr: 127.0.0.1:18080
auth:
  type: none
policies:
  system_dir: /etc/agentsh/system
  dir: /etc/agentsh
  default: policy
sandbox:
  enabled: true
  allow_degraded: true
  fuse:
    enabled: false
  network:
    enabled: true
  seccomp:
    enabled: false
  unix_sockets:
    enabled: false
sessions:
  base_dir: /var/lib/agentsh/sessions
`;

describe.skipIf(!canRun)('Blaxel E2E', () => {
  let tools: Record<string, any>;
  let rawSandbox: any;

  beforeAll(async () => {
    const { SandboxInstance } = await import('@blaxel/core');

    // Cleanup any stale sandbox
    try { await SandboxInstance.delete('agentsh-mastra-e2e'); } catch {}
    await new Promise(r => setTimeout(r, 3000));

    // Create Blaxel sandbox
    rawSandbox = await SandboxInstance.create({
      name: 'agentsh-mastra-e2e',
      region: 'us-pdx-1',
    });

    // Helper to exec commands directly via Blaxel SDK
    async function rawExec(cmd: string, timeout = 120) {
      const result = await rawSandbox.process.exec({
        command: cmd,
        waitForCompletion: true,
        timeout,
      });
      if ((result.exitCode ?? 0) !== 0) {
        throw new Error(`Setup failed (exit ${result.exitCode}): ${cmd.slice(0, 80)}\n${result.stderr ?? ''}`);
      }
      return result;
    }

    // Blaxel runs Alpine — install glibc compat + deps for agentsh
    await rawExec('apk add --no-cache gcompat curl bash libseccomp');

    // Download and install agentsh binary
    const url = 'https://github.com/canyonroad/agentsh/releases/download/v0.18.0/agentsh_0.18.0_linux_amd64.tar.gz';
    await rawExec(`curl -fsSL ${url} -o /tmp/agentsh.tar.gz`);
    await rawExec('tar xz -C /tmp/ -f /tmp/agentsh.tar.gz');
    await rawExec('install -m 0755 /tmp/agentsh /usr/local/bin/agentsh');
    await rawExec('install -m 0755 /tmp/agentsh-shell-shim /usr/bin/agentsh-shell-shim');
    await rawExec('install -m 0755 /tmp/agentsh-unixwrap /usr/local/bin/agentsh-unixwrap');

    // Install shell shim
    await rawExec('/usr/local/bin/agentsh shim install-shell --root / --shim /usr/bin/agentsh-shell-shim --bash --i-understand-this-modifies-the-host');

    // Write policy and config
    await rawExec('mkdir -p /etc/agentsh/system /workspace /var/lib/agentsh/sessions');

    const policyB64 = Buffer.from(serializePolicy(agentDefault())).toString('base64');
    const systemB64 = Buffer.from(systemPolicyYaml()).toString('base64');
    const configB64 = Buffer.from(SERVER_CONFIG).toString('base64');

    await rawExec(`echo '${policyB64}' | base64 -d > /etc/agentsh/policy.yml`);
    await rawExec(`echo '${systemB64}' | base64 -d > /etc/agentsh/system/policy.yml`);
    await rawExec(`echo '${configB64}' | base64 -d > /etc/agentsh/config.yml`);

    await rawExec('find /etc/agentsh -type d -exec chmod 555 {} +');
    await rawExec('find /etc/agentsh -type f -exec chmod 444 {} +');
    await rawExec('chown -R root:root /etc/agentsh/');
    await rawExec('chmod 755 /var/lib/agentsh /var/lib/agentsh/sessions');

    // Start agentsh server (detached)
    rawSandbox.process.exec({
      command: 'nohup /usr/local/bin/agentsh server --config /etc/agentsh/config.yml > /tmp/agentsh-server.log 2>&1 &',
      waitForCompletion: true,
      timeout: 10,
    }).catch(() => {});

    // Wait for health
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const h = await rawSandbox.process.exec({
        command: 'curl -sf http://127.0.0.1:18080/health',
        waitForCompletion: true,
        timeout: 5,
      });
      if (h.exitCode === 0) break;
      if (i === 14) throw new Error('Health check failed after 15 attempts');
    }

    // Create session
    const sessionResult = await rawExec('/usr/local/bin/agentsh session create --workspace /workspace --policy policy');
    const sessionMatch = sessionResult.stdout.match(/session-[0-9a-f-]+/);
    const sessionId = sessionMatch ? sessionMatch[0] : '';
    if (!sessionId) throw new Error('Failed to parse session ID from: ' + sessionResult.stdout);

    // Create agentshTools with 'running' strategy (agentsh already provisioned)
    const adapter = blaxel(rawSandbox);
    tools = agentshTools({
      sandbox: {
        adapter,
        config: {
          installStrategy: 'running',
          sessionId,
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    try {
      const { SandboxInstance } = await import('@blaxel/core');
      await SandboxInstance.delete('agentsh-mastra-e2e');
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
});
