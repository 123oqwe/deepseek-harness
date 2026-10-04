/**
 * CENSUS-3 (never merge): the groups of published packages the census driver
 * mounts, one boot per group, each on the shipped template that hosts it.
 * @module tests/first100/fixtures/loader/p1-01-census3/groups
 */

import { fileURLToPath } from 'node:url'

const repo = (path: string): string => fileURLToPath(new URL(`../../../../../${path}`, import.meta.url))
const mockAcpServer = repo('packages/subagent/subagent-acp/tests/mock-acp-server.ts')
const node = JSON.stringify(process.execPath)

/**
 * One census group: the template it boots, the top-level entries and insert
 * rows of its extra patch layer, and the packages linked into the profile's
 * node_modules first (as `dsh plugin add` installs a package the
 * installation does not carry), by name and repository directory.
 */
export interface Group {
  readonly template: 'headless' | 'web' | 'sdk'
  readonly patches?: readonly string[]
  readonly rows: readonly string[]
  readonly installs?: Readonly<Record<string, string>>
}

/** Every group the spec runs, by name. */
export const GROUPS: Readonly<Record<string, Group>> = {
  'hooks': { template: 'headless', rows: [
    `- id: hooks-claude-code\n  name: '@deepseek-ai/dsh-hooks-claude-code'\n  config:\n    configPath: ./hooks.json`,
    `- id: hooks-codex\n  name: '@deepseek-ai/dsh-hooks-codex'\n  config:\n    configPath: ./codex-hooks.json`,
  ] },
  'lsp': { template: 'headless', rows: [
    `- id: lsp\n  name: '@deepseek-ai/dsh-lsp'`,
    `- id: lsp-stdio\n  name: '@deepseek-ai/dsh-lsp-stdio'\n  config:\n    servers:\n      fixture:\n        command: ${node}\n        args: ['./lsp-server.mjs']\n        extensionToLanguage:\n          '.ts': typescript`,
    `- id: tool-lsp\n  name: '@deepseek-ai/dsh-tool-lsp'\n  config:\n    maxLocations: 1`,
  ] },
  'terminal': { template: 'headless', rows: [
    `- id: pty\n  name: '@deepseek-ai/dsh-terminal'`,
    `- id: terminal-bash\n  name: '@deepseek-ai/dsh-terminal-bash'\n  config:\n    timeoutMs: 2000`,
    `- id: tool-terminal\n  name: '@deepseek-ai/dsh-tool-terminal'`,
  ] },
  'pwsh': { template: 'headless', rows: [
    `- id: terminal\n  name: '@deepseek-ai/dsh-terminal'`,
    `- id: terminal-pwsh\n  name: '@deepseek-ai/dsh-terminal-bash'\n  config:\n    shellDialect: pwsh\n    timeoutMs: 30000`,
    `- id: tool-pwsh-persistent\n  name: '@deepseek-ai/dsh-tool-pwsh-persistent'`,
  ] },
  'session': {
    template: 'headless',
    installs: { '@deepseek-ai/dsh-tool-session-query': repo('packages/session-query/tool-session-query') },
    rows: [
      `- id: tool-session-query\n  name: '@deepseek-ai/dsh-tool-session-query'`,
      `- id: session-reference\n  name: '@deepseek-ai/dsh-session-reference'\n  config:\n    maxReferenceBytes: 360`,
    ],
  },
  'subagent-acp': { template: 'headless', rows: [
    `- id: subagent-acp-diagnostic\n  name: '@deepseek-ai/dsh-subagent-acp'\n  config:\n    providerName: acp-diagnostic\n    command: ${node}\n    args:\n      - ${JSON.stringify(mockAcpServer)}\n    permission: reject`,
    `- id: tool-subagent-acp-diagnostic\n  name: '@deepseek-ai/dsh-tool-subagent'\n  config:\n    provider: acp-diagnostic\n    toolName: subagent_acp\n    backgroundMode: one-shot\n    maxDepth: provider-managed`,
  ] },
  'subagent-cli': { template: 'headless', rows: [
    `- id: subagent-claude-code\n  name: '@deepseek-ai/dsh-subagent-claude-code'`,
    `- id: subagent-codex\n  name: '@deepseek-ai/dsh-subagent-codex'`,
  ] },
  'cordis': { template: 'headless', rows: [
    `- id: cordis-host-runner\n  name: '@deepseek-ai/dsh-cordis-host-runner'`,
    `- id: tool-cordis\n  name: '@deepseek-ai/dsh-tool-cordis'`,
  ] },
  'ask-user': { template: 'headless', rows: [
    `- id: tool-ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'`,
  ] },
  'webhook': { template: 'web', rows: [
    `- id: webhook-runtime\n  name: '@deepseek-ai/dsh-webhook'`,
    `- id: github-webhook-ingress\n  name: cordis:group\n  group: true\n  isolate:\n    webServer: true\n  config:\n    - id: github-webhook-server\n      name: '@deepseek-ai/dsh-host-webserver'\n      config:\n        host: '127.0.0.1'\n        port: 0\n    - id: github-webhook-adapter\n      name: '@deepseek-ai/dsh-webhook-github'\n      config:\n        source: primary-github\n        path: /github\n        secretEnv: DSH_GITHUB_WEBHOOK_SECRET\n        maxBodyBytes: 1048576`,
  ] },
  'llm-replay': { template: 'headless', rows: [
    `- id: llm-replay\n  name: '@deepseek-ai/dsh-llm-replay'\n  config:\n    file: ${JSON.stringify(repo('snapshots/session/session-query-spill/session.v3.jsonl'))}\n    providers:\n      - id: census-replay\n        models:\n          - id: census`,
  ] },
  'sdk-jsonrpc-server': { template: 'sdk', patches: [
    `- id: sdk-jsonrpc-server\n  disabled: true`,
  ], rows: [
    `- id: sdk-jsonrpc-server-dynamic-live\n  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'\n  inject: [sdkAppStartup, loader]\n  config:\n    maxTokensAsSuccess: true`,
  ] },
  'subagent-dsh-sdk': { template: 'sdk', rows: [
    `- id: subagent-dsh-sdk\n  name: '@deepseek-ai/dsh-subagent-dsh-sdk'\n  config:\n    profile: sdk\n    dshHome: !!js dshHomePath('census-child')\n    provider: mock\n    model: mock-routed`,
    `- id: subagent-model-selection-settings\n  name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'\n  config:\n    enabled: true\n    allowedModels:\n      - provider: mock\n        model: mock-routed`,
  ] },
}
