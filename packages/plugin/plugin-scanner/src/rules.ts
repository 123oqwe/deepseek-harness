import type { ScanRule } from './types.ts'

export const RULES: readonly ScanRule[] = [
  { id: 'R001', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Direct child_process import' },
  { id: 'R002', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Direct fs write outside workspace' },
  { id: 'R003', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Direct net/http server creation' },
  { id: 'R004', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'eval or vm.runInContext usage' },
  { id: 'R005', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Native addon (node-gyp, .node file)' },
  { id: 'R006', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Dynamic require() with variable argument' },
  { id: 'R007', version: '1.0.0', severity: 'review', phase: 'static', description: 'Environment variable access' },
  { id: 'R008', version: '1.0.0', severity: 'review', phase: 'static', description: 'Process env access' },
  { id: 'R009', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Postinstall script declared' },
  { id: 'R010', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Undeclared network access in dynamic scan' },
  { id: 'R011', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Undeclared filesystem write in dynamic scan' },
  { id: 'R012', version: '1.0.0', severity: 'blocking', phase: 'static', description: 'Undeclared process spawn in dynamic scan' },
  { id: 'R013', version: '1.0.0', severity: 'review', phase: 'static', description: 'Dynamic import() expression' },
  { id: 'R014', version: '1.0.0', severity: 'informational', phase: 'static', description: 'Large dependency count (>50)' },
]

export function getRule(id: string): ScanRule | undefined {
  return RULES.find(r => r.id === id)
}
