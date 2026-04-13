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
