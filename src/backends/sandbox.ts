// src/backends/sandbox.ts
import { secureSandbox } from '@agentsh/secure-sandbox';
import type { PolicyDefinition, SandboxAdapter, SecureConfig, SecuredSandbox } from '@agentsh/secure-sandbox';
import type { Backend, ExecResult, ReadFileResult, WriteFileResult } from '../types.js';

export class SandboxBackend implements Backend {
  private secured: SecuredSandbox | null = null;
  private initPromise: Promise<SecuredSandbox> | null = null;
  private readonly adapter: SandboxAdapter;
  private readonly policy?: PolicyDefinition;
  private readonly config: Partial<SecureConfig>;

  constructor(adapter: SandboxAdapter, policy?: PolicyDefinition, config?: Partial<SecureConfig>) {
    this.adapter = adapter;
    this.policy = policy;
    this.config = config ?? {};
  }

  private ensureInit(): Promise<SecuredSandbox> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<SecuredSandbox> {
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
