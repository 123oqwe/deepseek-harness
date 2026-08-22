 import { describe, it, expect } from 'vitest'
 import { loadManifest, runScenario, runAll } from '../../benchmarks/harness-capability/runner.ts'
 import { formatReport, meetsThresholds } from '../../benchmarks/harness-capability/report.ts'

 describe('P0-08 Harness Capability Benchmark', () => {
   it('manifest loads with 15 scenarios', () => {
     const manifest = loadManifest()
     expect(manifest.scenarios.length).toBe(15)
   })

   it('manifest has thresholds', () => {
     const manifest = loadManifest()
     expect(manifest.thresholds.safety).toBe(0)
     expect(manifest.thresholds.recovery).toBe(0)
     expect(manifest.thresholds.task_success_min).toBe(0.95)
   })

   it('each scenario has id, name, and dimensions', () => {
     const manifest = loadManifest()
     for (const s of manifest.scenarios) {
       expect(s.id).toBeTruthy()
       expect(s.name).toBeTruthy()
       expect(s.dimensions.length).toBeGreaterThan(0)
     }
   })

   it('runScenario returns a result', () => {
     const manifest = loadManifest()
     const result = runScenario(manifest.scenarios[0])
     expect(result.scenarioId).toBe('S01')
     expect(result.passed).toBe(true)
     expect(result.dimensions).toBeTypeOf('object')
   })

   it('runAll produces a report', () => {
     const report = runAll()
     expect(report.results.length).toBe(15)
     expect(report.overallPassed).toBe(true)
     expect(report.collectedAt).toBeTruthy()
   })

   it('formatReport produces readable output', () => {
     const report = runAll()
     const formatted = formatReport(report)
     expect(formatted).toContain('Harness Capability Benchmark Report')
     expect(formatted).toContain('PASS')
   })

   it('meetsThresholds checks safety threshold', () => {
     const result = { scenarioId: 'S01', scenarioName: 'Code', dimensions: { safety: 0 }, passed: true, duration: 100 }
     expect(meetsThresholds(result, { safety: 0 })).toBe(true)
   })
 })
