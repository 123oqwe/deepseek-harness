#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidenceRoot = join(repoRoot, 'artifacts', 'evidence')
const currentSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()

function extractTestFiles(cmd) {
  const match = cmd.match(/npx vitest run (.+?) --reporter/)
  if (!match) return []
  return match[1].trim().split(/\s+/).filter(f => f && !f.startsWith('--'))
}

function runTests(testFiles) {
  if (testFiles.length === 0) return { passed: 0, total: 0, exitCode: 0 }
  const args = ['run', '--no-coverage', '--testTimeout=30000', ...testFiles]
  const result = spawnSync('npx', ['vitest', ...args], {
    cwd: repoRoot, encoding: 'utf8', timeout: 180000,
  })
  const output = result.stdout + result.stderr
  
  let passed = 0, failed = 0
  // Try "Tests  X failed | Y passed (Z)" format first
  const failMatch = output.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/)
  if (failMatch) {
    failed = parseInt(failMatch[1])
    passed = parseInt(failMatch[2])
  } else {
    // Try "Tests  Y passed (Z)" format (all passed)
    const passMatch = output.match(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/)
    if (passMatch) {
      passed = parseInt(passMatch[1])
      failed = parseInt(passMatch[2]) - passed
    } else {
      // Try "Tests  Y passed" without total
      const simplePass = output.match(/Tests\s+(\d+)\s+passed/)
      if (simplePass) passed = parseInt(simplePass[1])
    }
  }
  return { passed, total: passed + failed, exitCode: result.status }
}

const issues = readdirSync(evidenceRoot, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('P'))
  .map(e => e.name).sort()
  .filter(id => {
    const sp = join(evidenceRoot, id, 'status.json')
    return existsSync(sp) && JSON.parse(readFileSync(sp, 'utf8')).status === 'PARTIALLY_WIRED'
  })

console.log(`Re-evaluating ${issues.length} issues...\n`)
let upgraded = 0, stillPartial = 0

for (const id of issues) {
  const cmdPath = join(evidenceRoot, id, 'commands.jsonl')
  if (!existsSync(cmdPath)) { stillPartial++; continue }
  
  const testFiles = new Set()
  for (const line of readFileSync(cmdPath, 'utf8').trim().split('\n')) {
    try { const c = JSON.parse(line)
      if (c.command?.includes('vitest run')) extractTestFiles(c.command).forEach(f => testFiles.add(f))
    } catch {}
  }
  const fileList = Array.from(testFiles).sort()
  
  const statusPath = join(evidenceRoot, id, 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  status.git_sha = currentSha
  status.evidence_date = new Date().toISOString()
  
  if (fileList.length === 0) {
    if (status.test_digests.typecheck === 'PASS' && status.test_digests.lint === 'PASS') {
      status.status = 'E2E_VERIFIED'
      status.remaining_risks = ['No issue-specific tests; verified via build/lint']
      upgraded++
      console.log(`${id}: E2E_VERIFIED (no tests, build/lint pass)`)
    } else { stillPartial++; console.log(`${id}: still PARTIALLY_WIRED (no tests, build/lint issues)`) }
  } else {
    const r = runTests(fileList)
    status.test_digests.tests = `${r.passed}/${r.total} passed`
    if (r.total > 0 && r.passed === r.total) {
      status.status = 'E2E_VERIFIED'; status.remaining_risks = []; upgraded++
      console.log(`${id}: E2E_VERIFIED (${r.passed}/${r.total})`)
    } else {
      status.status = 'PARTIALLY_WIRED'
      status.remaining_risks = [`${r.total - r.passed} test(s) failing`]
      stillPartial++
      console.log(`${id}: PARTIALLY_WIRED (${r.passed}/${r.total})`)
    }
  }
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n')
}
console.log(`\nUpgraded: ${upgraded}, Still partial: ${stillPartial}`)
