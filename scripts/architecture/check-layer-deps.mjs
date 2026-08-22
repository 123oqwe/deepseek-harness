/**
 * Layer dependency checker.
 *
 * Verifies that packages follow the declared layering order.
 *
 * Usage: node scripts/architecture/check-layer-deps.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const LAYERS = {
  util: 0, kernel: 1, schema: 2, assurance: 2, core: 3, sdk: 3,
  // invariants and typert are foundational protocol/utility packages used by every layer
  'runtime-diagnostics': 0, typert: 0,
  llm: 4, shell: 4, fs: 4, sandbox: 4, session: 4, interaction: 4,
  identity: 4, settings: 4, credentials: 4, compaction: 4, context: 4,
  subagent: 4, terminal: 4, lsp: 4, skill: 4, web: 4, workflow: 4,
  todo: 4, plan: 4, preset: 4, guard: 4, hooks: 4, boot: 5, bundle: 5,
  extensions: 5, host: 5, jobs: 5, mcp: 5, goal: 5, spill: 5, storage: 5,
  runtime: 5, policy: 3, action: 3, run: 5, memory: 4, migration: 3,
  plugin: 3, workspace: 3, support: 5, code: 4, client: 6, examples: 6,
  attachment: 4, feedback: 5, schedule: 5, 'session-query': 4, 'test-support': 5,
  acp: 4, api: 5, 'code-runtime': 5, e2b: 4, experimental: 5, guard: 4,
}

const APPS_LAYER = 7

// Known upstream violations exempted with documented reasons.
// New violations introduced by recovery work are NOT exempted and will fail CI.
const EXEMPTED_UPWARD_DEPS = new Set([
  // SDK/core packages that reference llm types (upstream design: SDK protocol carries model types)
  '@deepseek-ai/dsh-agent@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-agent-default-model@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-agent-default-model@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-agent-loop@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-agent-loop@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-agent-loop@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-sdk-client@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-sdk-jsonrpc-server@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-sdk-jsonrpc-server@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-sdk-jsonrpc-server@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-sdk-protocol@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-sdk-protocol@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-session@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-system-prompt@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools@deepseek-ai/dsh-code-runtime',
  '@deepseek-ai/dsh-tools@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-workspace@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-workspace@deepseek-ai/dsh-storage-domain',
  // Shell/terminal packages that depend on subprocess (upstream design: shell wraps subprocess)
  '@deepseek-ai/dsh-bash-local@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-lsp-stdio@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-pwsh-local@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-shell@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-subagent-acp@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-subagent-dsh-sdk@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-subprocess-e2b@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-terminal-bash@deepseek-ai/dsh-subprocess',
  // Tool packages that depend on jobs/spill (upstream design: tools use job scheduling)
  '@deepseek-ai/dsh-tool-bash@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-tool-fs-search@deepseek-ai/dsh-spill',
  '@deepseek-ai/dsh-tool-fs-search@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-tool-pwsh@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-tool-subagent@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-tool-terminal@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-subagent@deepseek-ai/dsh-jobs',
  // Client/API packages (upstream design: client-to-server layering)
  '@deepseek-ai/dsh-api-gateway@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-test-runtime@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-cordis@deepseek-ai/dsh-client-ui-slots',
  // Telemetry/storage cross-layer (upstream design)
  '@deepseek-ai/dsh-session-projection-cache@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-session-telemetry-otel@deepseek-ai/dsh-command-feedback',
])

function getLayerForPath(pkgPath) {
  const rel = relative(repoRoot, pkgPath)
  const parts = rel.split('/')
  if (parts[0] === 'apps') return APPS_LAYER
  if (parts[0] === 'vendor' || parts[0] === 'native') return 0
  if (parts[0] === 'packages' && parts.length >= 2) {
    return LAYERS[parts[1]] ?? 5
  }
  return 5
}

function getPackageName(pkgDir) {
  const pjPath = join(pkgDir, 'package.json')
  if (!existsSync(pjPath)) return undefined
  try {
    return JSON.parse(readFileSync(pjPath, 'utf8')).name
  } catch {
    return undefined
  }
}

function findPackages() {
  const pkgs = []
  const pkgsDir = join(repoRoot, 'packages')
  for (const group of readdirSync(pkgsDir)) {
    const groupDir = join(pkgsDir, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const pkg of readdirSync(groupDir)) {
      const pkgDir = join(groupDir, pkg)
      if (!statSync(pkgDir).isDirectory()) continue
      const name = getPackageName(pkgDir)
      if (name) pkgs.push({ dir: pkgDir, name, layer: getLayerForPath(pkgDir) })
    }
  }
  const appsDir = join(repoRoot, 'apps')
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const appDir = join(appsDir, app)
      if (!statSync(appDir).isDirectory()) continue
      const name = getPackageName(appDir)
      if (name) pkgs.push({ dir: appDir, name, layer: APPS_LAYER })
    }
  }
  return pkgs
}

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const imports = []
  const regex = /import\s+.*?from\s+['"]([^'"]+)['"]/g
  const exportRegex = /export\s+.*?from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = regex.exec(content)) !== null) imports.push(m[1])
  while ((m = exportRegex.exec(content)) !== null) imports.push(m[1])
  return imports
}

function findTsFiles(pkgDir) {
  const srcDir = join(pkgDir, 'src')
  if (!existsSync(srcDir)) return []
  const result = []
  function scan(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) scan(full)
      else if (entry.endsWith('.ts')) result.push(full)
    }
  }
  scan(srcDir)
  return result
}

export function check() {
  const pkgs = findPackages()
  const pkgByName = new Map(pkgs.map(p => [p.name, p]))
  const violations = []

  for (const pkg of pkgs) {
    const tsFiles = findTsFiles(pkg.dir)
    for (const file of tsFiles) {
      const imports = extractImports(file)
      for (const imp of imports) {
        if (!imp.startsWith('@deepseek-ai/')) continue
        const depPkg = pkgByName.get(imp)
        if (!depPkg) continue
        if (depPkg.layer < pkg.layer) continue
        if (depPkg.layer > pkg.layer) {
          violations.push({
            file: relative(repoRoot, file),
            import: imp,
            message: `${pkg.name} (layer ${pkg.layer}) imports ${depPkg.name} (layer ${depPkg.layer}): upward dependency`,
          })
        }
      }
    }
  }

  return { violations }
}

if (process.argv[1] && process.argv[1].endsWith('check-layer-deps.mjs')) {
  const result = check()
  const unexempted = result.violations.filter(v => {
    // message format: "@deepseek-ai/pkg-name (layer N) imports @deepseek-ai/dep (layer M): upward dependency"
    const importer = v.message.split(' (layer ')[0]
    return !EXEMPTED_UPWARD_DEPS.has(`${importer}${v.import}`)
  })
  if (unexempted.length === 0) {
    console.log(`layer-deps: PASS — ${result.violations.length} violations detected, all exempted (known upstream)`)
    process.exit(0)
  } else {
    console.error(`layer-deps: FAIL — ${unexempted.length} unexempted upward dependencies (of ${result.violations.length} total):`)
    for (const v of unexempted) {
      console.error(`  ${v.message}`)
      console.error(`    file: ${v.file}`)
      console.error(`    import: ${v.import}`)
    }
    process.exit(1)
  }
}
