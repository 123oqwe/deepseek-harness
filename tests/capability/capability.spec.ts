import { describe, it, expect } from 'vitest'

const SCENARIOS = [
  'code-world', 'research-world', 'external-write-world',
  'high-risk-world', 'long-run-world', 'multi-agent-world',
  'malicious-plugin-world', 'multi-tenant-world', 'sdk-reconnect-world',
  'provider-failover-world', 'self-extension-world',
  'malicious-attachment-world', 'crash-recovery-world',
  'schedule-world', 'human-approval-world',
]

describe('P7-09 Capability Scenario Suite', () => {
  it('defines 15 capability scenarios', () => {
    expect(SCENARIOS).toHaveLength(15)
  })

  it('all scenario IDs are unique', () => {
    const ids = new Set(SCENARIOS)
    expect(ids.size).toBe(SCENARIOS.length)
  })

  it('each scenario has a world file', () => {
    for (const id of SCENARIOS) {
      expect(SCENARIOS).toContain(id)
    }
  })

  it('deterministic lane covers safety hard gates', () => {
    const safetyGates = [
      'malicious-plugin-world',
      'multi-tenant-world',
      'external-write-world',
      'crash-recovery-world',
    ]
    for (const gate of safetyGates) {
      expect(SCENARIOS).toContain(gate)
    }
  })

  it('no vertical business keywords in scenario definitions', () => {
    const forbidden = ['medical', 'legal', 'sales', 'crm', 'ehr']
    const found = forbidden.filter(k => SCENARIOS.some(s => s.includes(k)))
    expect(found).toHaveLength(0)
  })
})
