import type { ScanFinding, ScanResult } from './types.ts'
import { RULES } from './rules.ts'

export interface DynamicScanInput {
  readonly manifestDeclarations: {
    readonly network?: readonly string[]
    readonly filesystem?: readonly string[]
    readonly process?: boolean
  }
  readonly observedBehavior: {
    readonly networkCalls: readonly string[]
    readonly fsWrites: readonly string[]
    readonly processSpawns: readonly string[]
  }
  readonly timedOut?: boolean
  readonly crashed?: boolean
}

export function dynamicScan(input: DynamicScanInput): ScanResult {
  const findings: ScanFinding[] = []
  const start = Date.now()

  // Timeout or crash means scan failed — cannot be interpreted as pass
  if (input.timedOut || input.crashed) {
    return {
      findings: [],
      passed: false,
      timedOut: input.timedOut ?? false,
      crashed: input.crashed ?? false,
      durationMs: Date.now() - start,
    }
  }

  const declaredNetwork = new Set(input.manifestDeclarations.network ?? [])
  const declaredFs = new Set(input.manifestDeclarations.filesystem ?? [])
  const declaredProcess = input.manifestDeclarations.process ?? false

  // Check undeclared network
  for (const url of input.observedBehavior.networkCalls) {
    if (!declaredNetwork.has(url) && !declaredNetwork.has('*')) {
      const rule = RULES.find(r => r.id === 'R010')
      if (rule) {
        findings.push({
          rule: rule.id, severity: rule.severity, phase: 'dynamic',
          file: 'runtime', description: `Undeclared network access: ${url}`,
          ruleVersion: rule.version,
        })
      }
    }
  }

  // Check undeclared filesystem writes
  for (const path of input.observedBehavior.fsWrites) {
    if (!declaredFs.has(path) && !declaredFs.has('*')) {
      const rule = RULES.find(r => r.id === 'R011')
      if (rule) {
        findings.push({
          rule: rule.id, severity: rule.severity, phase: 'dynamic',
          file: 'runtime', description: `Undeclared filesystem write: ${path}`,
          ruleVersion: rule.version,
        })
      }
    }
  }

  // Check undeclared process spawns
  if (input.observedBehavior.processSpawns.length > 0 && !declaredProcess) {
    const rule = RULES.find(r => r.id === 'R012')
    if (rule) {
      findings.push({
        rule: rule.id, severity: rule.severity, phase: 'dynamic',
        file: 'runtime', description: `Undeclared process spawn: ${input.observedBehavior.processSpawns.join(', ')}`,
        ruleVersion: rule.version,
      })
    }
  }

  const passed = !findings.some(f => f.severity === 'blocking')
  return { findings, passed, timedOut: false, crashed: false, durationMs: Date.now() - start }
}
