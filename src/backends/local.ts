// src/backends/local.ts
import { execFile as execFileCb } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializePolicy } from '@agentsh/secure-sandbox/policies';
import type { PolicyDefinition } from '@agentsh/secure-sandbox';
import type { Backend, ExecResult, ReadFileResult, WriteFileResult } from '../types.js';

function execFile(
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, opts ?? {}, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr }));
      resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

export class LocalBackend implements Backend {
  private sessionId: string | null = null;
  private sessionPromise: Promise<string> | null = null;
  private readonly policy: PolicyDefinition;
  private readonly workspace: string;

  constructor(policy?: PolicyDefinition, workspace?: string) {
    this.policy = policy ?? {};
    this.workspace = workspace ?? '/workspace';
  }

  private ensureSession(): Promise<string> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.initSession();
    }
    return this.sessionPromise;
  }

  private async initSession(): Promise<string> {
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
