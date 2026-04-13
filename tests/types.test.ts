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
