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
  llm: 4, shell: 4, fs: 4, sandbox: 4, session: 4, interaction: 4,
  identity: 4, settings: 4, credentials: 4, compaction: 4, context: 4,
  subagent: 4, terminal: 4, lsp: 4, skill: 4, web: 4, workflow: 4,
  todo: 4, plan: 4, preset: 4, guard: 4, hooks: 4, boot: 5, bundle: 5,
  extensions: 5, host: 5, jobs: 5, mcp: 5, goal: 5, spill: 5, storage: 5,
  runtime: 5, policy: 3, action: 3, run: 5, memory: 4, migration: 3,
  plugin: 3, workspace: 3, support: 5, code: 4, client: 6, examples: 6,
  attachment: 4, feedback: 5, schedule: 5, session_query: 4, test_support: 5,
}

const APPS_LAYER = 7

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
  if (result.violations.length === 0) {
    console.log('layer-deps: PASS — no upward dependencies detected')
    process.exit(0)
  } else {
    console.error('layer-deps: FAIL — upward dependencies detected:')
    for (const v of result.violations) {
      console.error(`  ${v.message}`)
      console.error(`    file: ${v.file}`)
      console.error(`    import: ${v.import}`)
    }
    process.exit(1)
  }
}
