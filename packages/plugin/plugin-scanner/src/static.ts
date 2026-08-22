import type { ScanFinding, ScanResult } from './types.ts'
import { RULES } from './rules.ts'

const PATTERNS: Record<string, { pattern: RegExp; ruleId: string }> = {
  child_process: { pattern: /require\(['"]child_process['"]\)|from\s+['"]child_process['"]|import\s+.*child_process/g, ruleId: 'R001' },
  eval: { pattern: /\beval\s*\(|vm\.runIn|vm\.Script|new\s+Function\s*\(/g, ruleId: 'R004' },
  native: { pattern: /\.node['"]|node-gyp|binding\.gyp|node_addon_api/g, ruleId: 'R005' },
  dynamicRequire: { pattern: /require\s*\(\s*[a-zA-Z_$]/g, ruleId: 'R006' },
  env: { pattern: /process\.env/g, ruleId: 'R008' },
  dynamicImport: { pattern: /import\s*\(/g, ruleId: 'R013' },
  fsWrite: { pattern: /fs\.write|fs\.append|fs\.mkdir|fs\.rm|fs\.unlink|fs\.rename/g, ruleId: 'R002' },
  netServer: { pattern: /net\.createServer|http\.createServer|https\.createServer|net\.connect|http\.request/g, ruleId: 'R003' },
}

export interface StaticScanInput {
  readonly files: { path: string; content: string }[]
  readonly packageJson?: { scripts?: Record<string, string> }
  readonly dependencyCount?: number
}

export function staticScan(input: StaticScanInput): ScanResult {
  const findings: ScanFinding[] = []
  const start = Date.now()

  for (const file of input.files) {
    for (const [, { pattern, ruleId }] of Object.entries(PATTERNS)) {
      const rule = RULES.find(r => r.id === ruleId)
      if (!rule) continue
      const matches = file.content.match(pattern)
      if (matches) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          phase: 'static',
          file: file.path,
          description: `${rule.description} (${matches.length} occurrences)`,
          ruleVersion: rule.version,
        })
      }
    }
  }

  // Check postinstall scripts
  if (input.packageJson?.scripts) {
    const hasPostinstall = 'postinstall' in input.packageJson.scripts || 'preinstall' in input.packageJson.scripts
    if (hasPostinstall) {
      const rule = RULES.find(r => r.id === 'R009')
      if (rule) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          phase: 'static',
          file: 'package.json',
          description: rule.description,
          ruleVersion: rule.version,
        })
      }
    }
  }

  // Check dependency count
  if (input.dependencyCount !== undefined && input.dependencyCount > 50) {
    const rule = RULES.find(r => r.id === 'R014')
    if (rule) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        phase: 'static',
        file: 'package.json',
        description: `${rule.description} (${input.dependencyCount} deps)`,
        ruleVersion: rule.version,
      })
    }
  }

  const passed = !findings.some(f => f.severity === 'blocking')
  return { findings, passed, timedOut: false, crashed: false, durationMs: Date.now() - start }
}
