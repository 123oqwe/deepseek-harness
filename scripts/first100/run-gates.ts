/**
 * First-100 recovery gate runner.
 *
 * Each phase gate runs real checks and reports per-issue status from evidence
 * packages. Unimplemented phases report NOT_RUN. No error swallowing, no
 * continue-on-error, no echo-only placeholders.
 *
 * Usage: tsx scripts/first100/run-gates.ts <phase>
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidenceRoot = join(repoRoot, 'artifacts', 'evidence')

type Phase =
  | 'preflight'
  | 'architecture'
  | 'security'
  | 'recovery'
  | 'providers'
  | 'protocol'
  | 'capability'
  | 'scale'
  | 'gate'

const phase = (process.argv[2] as Phase | undefined) ?? 'gate'

/** Run a shell command, streaming output. Exits non-zero on failure. */
function run(command: string, args: string[], label: string): boolean {
  console.log(`\n[gate] ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(`[gate] FAIL: ${label} (exit ${result.status})`)
    return false
  }
  console.log(`[gate] PASS: ${label}`)
  return true
}

/** Read issue status from evidence package status.json. */
function issueStatus(id: string): string {
  const statusPath = join(evidenceRoot, id, 'status.json')
  if (!existsSync(statusPath)) return 'NOT_RUN'
  try {
    const data: { status?: string } = JSON.parse(readFileSync(statusPath, 'utf8')) as { status?: string }
    return data.status ?? 'NOT_RUN'
  } catch {
    return 'NOT_RUN'
  }
}

/** List all evidence directories. */
function evidenceIssues(): string[] {
  if (!existsSync(evidenceRoot)) return []
  return readdirSync(evidenceRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('P'))
    .map(e => e.name)
    .sort()
}

/** Report status of all issues. */
function reportStatus(): void {
  console.log('\n[gate] Issue status report:')
  const issues = evidenceIssues()
  if (issues.length === 0) {
    console.log('  (no evidence packages found)')
    return
  }
  for (const id of issues) {
    console.log(`  ${id}: ${issueStatus(id)}`)
  }
}

/** Check that all 100 issues have E2E_VERIFIED status. */
function allVerified(): boolean {
  const issues = evidenceIssues()
  if (issues.length === 0) {
    console.error('[gate] No evidence packages found')
    return false
  }
  const notVerified = issues.filter(id => issueStatus(id) !== 'E2E_VERIFIED')
  if (notVerified.length > 0) {
    console.error(`[gate] ${notVerified.length} issues not E2E_VERIFIED:`)
    for (const id of notVerified) {
      console.error(`  ${id}: ${issueStatus(id)}`)
    }
    return false
  }
  console.log(`[gate] All ${issues.length} evidence issues are E2E_VERIFIED`)
  return true
}

let success = true

switch (phase) {
  case 'preflight': {
    success = run('node', ['scripts/release/baseline-fingerprint.mjs', 'verify'], 'baseline:verify')
    reportStatus()
    break
  }
  case 'architecture': {
    success = run('node', ['scripts/architecture/check-capability-seams.mjs'], 'capability-seams')
    if (success) success = run('node', ['scripts/architecture/check-layer-deps.mjs'], 'layer-deps')
    if (success) success = run('pnpm', ['run', 'typecheck'], 'typecheck')
    reportStatus()
    break
  }
  case 'security': {
    console.log('[gate] security phase: NOT_RUN (no security tests implemented yet)')
    reportStatus()
    break
  }
  case 'recovery': {
    console.log('[gate] recovery phase: NOT_RUN (no recovery tests implemented yet)')
    reportStatus()
    break
  }
  case 'providers': {
    console.log('[gate] providers phase: NOT_RUN (no provider tests implemented yet)')
    reportStatus()
    break
  }
  case 'protocol': {
    console.log('[gate] protocol phase: NOT_RUN (no protocol tests implemented yet)')
    reportStatus()
    break
  }
  case 'capability': {
    console.log('[gate] capability phase: NOT_RUN (no capability scenarios implemented yet)')
    reportStatus()
    break
  }
  case 'scale': {
    console.log('[gate] scale phase: NOT_RUN (no scale tests implemented yet)')
    reportStatus()
    break
  }
  case 'gate': {
    console.log('[gate] Running all first100 gates on one commit...')
    const phases: Phase[] = [
      'preflight',
      'architecture',
      'security',
      'recovery',
      'providers',
      'protocol',
      'capability',
      'scale',
    ]
    for (const p of phases) {
      const result = spawnSync('pnpm', ['run', `first100:${p}`], {
        cwd: repoRoot,
        stdio: 'inherit',
        encoding: 'utf8',
      })
      if (result.status !== 0) {
        console.error(`[gate] FAIL: first100:${p}`)
        success = false
      }
    }
    if (success) {
      const verified = allVerified()
      if (!verified) success = false
    }
    if (success) {
      console.log('\n[gate] SECOND_100_IMPLEMENTATION = NO_GO (first-100 not complete)')
    } else {
      console.error('\n[gate] SECOND_100_IMPLEMENTATION = NO_GO (gates failed)')
    }
    break
  }
  default: {
    console.error(`Unknown phase: ${String(phase)}`)
    console.error('Usage: tsx scripts/first100/run-gates.ts <preflight|architecture|security|recovery|providers|protocol|capability|scale|gate>')
    process.exit(1)
  }
}

if (!success) {
  process.exit(1)
}
