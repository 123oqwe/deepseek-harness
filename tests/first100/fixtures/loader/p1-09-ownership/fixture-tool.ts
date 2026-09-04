/**
 * Shared tool factory for P1-09's real-composition fixture plugins. Each
 * fixture plugin is an ordinary named cordis plugin registering one tool
 * through the real `ToolRuntime`, exactly as a shipped plugin does — the
 * ownership adjudication under test is the registry's, never anything these
 * modules do for themselves.
 * @module
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

/**
 * A registrable no-op tool under `name`; its body is irrelevant to every ownership rule.
 * @param name - the tool name the fixture plugin claims.
 * @returns a complete tool definition the real registry accepts.
 */
export function fixtureTool(name: string): ToolDefinition {
  return defineTool({
    name,
    description: `p1-09 fixture tool ${name}`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return name
    },
  })
}
