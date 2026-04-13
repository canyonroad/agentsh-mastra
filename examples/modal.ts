/**
 * Example: Using agentshTools with Modal (no Mastra agent needed)
 *
 * Modal doesn't have a JS SDK — this example uses a Python bridge
 * to create a Modal sandbox and drives it from TypeScript through
 * @agentsh/mastra tools.
 *
 * This demonstrates that agentshTools works with ANY sandbox provider
 * supported by @agentsh/secure-sandbox, regardless of whether Mastra
 * has a native integration for it.
 *
 * Prerequisites:
 *   - Python 3.11+ with `modal` package (`pip install modal`)
 *   - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET in .env.e2e (or environment)
 *
 * Run:
 *   npx tsx examples/modal.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.e2e') });

import { agentshTools, agentDefault } from '../src/index.js';
import { modal } from '@agentsh/secure-sandbox/adapters/modal';

// ── Python bridge for Modal sandbox ──────────────────────────

const BRIDGE_SCRIPT = `
import sys, json, modal

app = modal.App.lookup("agentsh-mastra-example", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ca-certificates", "curl", "bash", "git", "sudo", "libseccomp2", "fuse3", "python3")
)

sb = modal.Sandbox.create(app=app, image=image, timeout=60 * 10)
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        print(json.dumps({"error": "invalid JSON"}), flush=True)
        continue

    if req.get("cmd") == "terminate":
        try:
            sb.terminate()
        except Exception:
            pass
        print(json.dumps({"ok": True}), flush=True)
        break

    if req.get("cmd") == "exec":
        args = req.get("args", [])
        try:
            proc = sb.exec(*args)
            proc.wait()
            print(json.dumps({
                "stdout": proc.stdout.read(),
                "stderr": proc.stderr.read(),
                "returncode": proc.returncode,
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "stdout": "",
                "stderr": str(e),
                "returncode": 1,
            }), flush=True)
    else:
        print(json.dumps({"error": f"unknown cmd: {req.get('cmd')}"}), flush=True)
`;

async function createModalBridge() {
  // Find Python with modal SDK (system or venv)
  let pythonBin = 'python3';
  for (const bin of ['python3', '/tmp/modal-venv/bin/python3']) {
    try {
      const check = spawn(bin, ['-c', 'import modal'], { stdio: ['pipe', 'pipe', 'pipe'] });
      await new Promise<void>((res, rej) => check.on('close', (code) => code === 0 ? res() : rej()));
      pythonBin = bin;
      break;
    } catch {}
  }

  const bridge = spawn(pythonBin, ['-c', BRIDGE_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env as Record<string, string>,
  });

  let bridgeStderr = '';
  bridge.stderr.on('data', (d: Buffer) => { bridgeStderr += d.toString(); });

  // Wait for ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout creating Modal sandbox')), 120_000);
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          if (JSON.parse(line).ready) {
            clearTimeout(timeout);
            bridge.stdout.removeListener('data', onData);
            resolve();
            return;
          }
        } catch {}
      }
    };
    bridge.stdout.on('data', onData);
    bridge.on('close', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited (${code}): ${bridgeStderr}`));
    });
  });

  // Response reader
  let buf = '';
  const queue: Array<(msg: any) => void> = [];
  bridge.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const resolver = queue.shift();
        if (resolver) resolver(JSON.parse(line));
      } catch {}
    }
  });

  async function exec(...args: string[]) {
    return new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('exec timeout')), 60_000);
      queue.push((msg) => { clearTimeout(t); resolve(msg); });
      bridge.stdin.write(JSON.stringify({ cmd: 'exec', args }) + '\n');
    });
  }

  // Return a sandbox object compatible with the modal adapter
  return {
    sandbox: {
      async exec(...args: string[]) {
        const r = await exec(...args);
        return {
          async wait() {},
          stdout: { async read() { return r.stdout; } },
          stderr: { async read() { return r.stderr; } },
          returncode: r.returncode,
        };
      },
      async terminate() {
        await new Promise<void>((resolve) => {
          queue.push(() => resolve());
          bridge.stdin.write(JSON.stringify({ cmd: 'terminate' }) + '\n');
          setTimeout(resolve, 5000);
        });
        bridge.kill();
      },
    },
    cleanup: () => bridge.kill(),
  };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
    console.error('Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET');
    process.exit(1);
  }

  // Step 1: Create Modal sandbox via Python bridge
  console.log('Creating Modal sandbox (via Python bridge)...');
  const { sandbox: modalSandbox, cleanup } = await createModalBridge();

  // Step 2: Create agentshTools with the Modal adapter
  console.log('Creating AgentSH-secured tools...');
  const tools = agentshTools({
    policy: agentDefault(),
    sandbox: {
      adapter: modal(modalSandbox),
      config: { skipIntegrityCheck: true },
    },
  });

  // Step 3: Use the tools directly
  console.log('\n--- Running commands in Modal sandbox ---\n');

  // Execute bash
  const echo = await tools.executeBash.execute({ command: 'echo "Hello from Modal!"' }, {});
  console.log(`echo (exit ${echo.exitCode}): ${echo.stdout.trim()}`);

  // System info
  const info = await tools.executeBash.execute({ command: 'uname -a' }, {});
  console.log(`system: ${info.stdout.trim()}`);

  // Write and run a Python script
  const script = `
import math
primes = [n for n in range(2, 50) if all(n % i != 0 for i in range(2, int(math.sqrt(n)) + 1))]
print(f"Primes under 50: {primes}")
print(f"Count: {len(primes)}")
`;
  await tools.writeFile.execute({ path: '/workspace/primes.py', content: script }, {});
  console.log('\nWrote /workspace/primes.py');

  const run = await tools.executeBash.execute({ command: 'python3 /workspace/primes.py' }, {});
  console.log(`python3 (exit ${run.exitCode}):\n${run.stdout.trim()}`);

  // Read it back
  const read = await tools.readFile.execute({ path: '/workspace/primes.py' }, {});
  console.log(`\nRead back ${read.content.length} chars from /workspace/primes.py`);

  // Cleanup
  console.log('\nTerminating Modal sandbox...');
  await modalSandbox.terminate();
  cleanup();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
