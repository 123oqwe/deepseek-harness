 /**
  * Report generator for the Harness Capability Benchmark Framework.
  */

 import type { BenchmarkReport, BenchmarkResult } from './runner.ts'

 /** Format a benchmark report as a human-readable string. */
 export function formatReport(report: BenchmarkReport): string {
   const lines: string[] = []
   lines.push('# Harness Capability Benchmark Report')
   lines.push(`Collected: ${report.collectedAt}`)
   lines.push(`Overall: ${report.overallPassed ? 'PASS' : 'FAIL'}`)
   lines.push('')
   lines.push('| Scenario | Dimensions | Passed | Duration |')
   lines.push('| --- | --- | --- | --- |')
   for (const r of report.results) {
     const dims = Object.entries(r.dimensions).map(([k, v]) => `${k}=${v}`).join(', ')
     lines.push(`| ${r.scenarioId} ${r.scenarioName} | ${dims} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.duration}ms |`)
   }
   lines.push('')
   lines.push('## Thresholds')
   for (const [key, value] of Object.entries(report.thresholds)) {
     lines.push(`- ${key}: ${value}`)
   }
   return lines.join('\n')
 }

 /** Check if a result meets the thresholds. */
 export function meetsThresholds(result: BenchmarkResult, thresholds: Record<string, number | boolean>): boolean {
   for (const [key, threshold] of Object.entries(thresholds)) {
     const actual = result.dimensions[key]
     if (actual === undefined) continue
     if (typeof threshold === 'number' && typeof actual === 'number') {
       if (key === 'task_success_min' && actual < threshold) return false
       if (key !== 'task_success_min' && actual > threshold) return false
     }
     if (typeof threshold === 'boolean' && actual !== threshold) {
       if (key === 'overall_passed' && actual !== threshold) return false
     }
   }
   return true
 }
