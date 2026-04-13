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
