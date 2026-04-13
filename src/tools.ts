import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Backend } from './types.js';

export function createExecuteBashTool(backend: Backend) {
  return createTool({
    id: 'agentsh-execute-bash',
    description: 'Execute a bash command in a secure AgentSH-enforced environment',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().optional().describe('Timeout in milliseconds'),
    }),
    outputSchema: z.object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
    }),
    execute: async (input) => {
      return backend.exec(input.command, {
        cwd: input.cwd,
        timeout: input.timeout,
      });
    },
  });
}

export function createReadFileTool(backend: Backend) {
  return createTool({
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
    execute: async (input) => {
      return backend.readFile(input.path);
    },
  });
}

export function createWriteFileTool(backend: Backend) {
  return createTool({
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
    execute: async (input) => {
      return backend.writeFile(input.path, input.content);
    },
  });
}
