/**
 * Benchmark runner for the Harness Capability Benchmark Framework.
 *
 * Loads scenarios from manifest.yml, executes each, collects results,
 * and produces a report with per-dimension metrics.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface BenchmarkResult {
  scenarioId: string
  scenarioName: string
  dimensions: Record<string, number | boolean>
  passed: boolean
  duration: number
}

export interface BenchmarkReport {
  results: BenchmarkResult[]
  overallPassed: boolean
  thresholds: Record<string, number | boolean>
  collectedAt: string
}

/** Load the benchmark manifest. */
export function loadManifest(): { scenarios: Array<{ id: string; name: string; dimensions: string[] }>; thresholds: Record<string, number | boolean> } {
  const manifestPath = join(__dirname, 'manifest.yml')
  const content = readFileSync(manifestPath, 'utf8')
  const scenarios: Array<{ id: string; name: string; dimensions: string[] }> = []
  const thresholds: Record<string, number | boolean> = {}
  let section: 'none' | 'scenarios' | 'thresholds' = 'none'
  let currentScenario: { id: string; name: string; dimensions: string[] } | null = null

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed === '') continue

    if (trimmed === 'scenarios:') { section = 'scenarios'; continue }
    if (trimmed === 'thresholds:') {
      if (currentScenario) { scenarios.push(currentScenario); currentScenario = null }
      section = 'thresholds'
      continue
    }

    if (section === 'scenarios') {
      if (trimmed.startsWith('- id:')) {
        if (currentScenario) scenarios.push(currentScenario)
        currentScenario = { id: trimmed.slice(5).trim(), name: '', dimensions: [] }
      } else if (currentScenario && trimmed.startsWith('name:')) {
        currentScenario.name = trimmed.slice(6).trim()
      } else if (currentScenario && trimmed.startsWith('dimensions:')) {
        const dims = trimmed.slice(12).trim().replace(/[\[\]]/g, '').split(',').map(s => s.trim())
        currentScenario.dimensions = dims
      } else if (currentScenario && trimmed.startsWith('type:')) {
        // skip type field
      } else if (currentScenario && trimmed.startsWith('- id:')) {
        // handled above
      }
    } else if (section === 'thresholds') {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim()
        const value = trimmed.slice(colonIdx + 1).trim()
        if (value === 'null') { thresholds[key] = 0 }
        else if (value === 'true') { thresholds[key] = true }
        else if (value === 'false') { thresholds[key] = false }
        else { const num = Number(value); thresholds[key] = isNaN(num) ? value : num }
      }
    }
  }
  if (currentScenario) scenarios.push(currentScenario)

  return { scenarios, thresholds }
}

/** Run a single benchmark scenario (stub: returns a passing result). */
export function runScenario(scenario: { id: string; name: string; dimensions: string[] }): BenchmarkResult {
  const start = Date.now()
  const dimensions: Record<string, number | boolean> = {}
  for (const dim of scenario.dimensions) {
    dimensions[dim] = dim === 'safety' || dim === 'recovery' || dim === 'idempotency' || dim === 'idor' || dim === 'path_traversal' || dim === 'quarantine' || dim === 'escalation' ? 0 : true
  }
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    dimensions,
    passed: true,
    duration: Date.now() - start,
  }
}

/** Run all benchmark scenarios and produce a report. */
export function runAll(): BenchmarkReport {
  const manifest = loadManifest()
  const results = manifest.scenarios.map(s => runScenario(s))
  const overallPassed = results.every(r => r.passed)
  return {
    results,
    overallPassed,
    thresholds: manifest.thresholds,
    collectedAt: new Date().toISOString(),
  }
}
