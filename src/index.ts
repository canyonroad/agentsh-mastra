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
