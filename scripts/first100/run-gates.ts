/**
 * First-100 recovery gate runner.
 *
 * Each phase gate runs real checks and reports per-issue status from evidence
 * packages. No error swallowing, no continue-on-error, no echo-only
 * placeholders. Every phase that cannot produce evidence exits non-zero.
 *
 * Usage: tsx scripts/first100/run-gates.ts <phase>
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
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

/** Run vitest on a set of test directory patterns. Exits non-zero on failure. */
function runVitest(patterns: string[], label: string): boolean {
  console.log(`\n[gate] ${label}`)
  const args = ['run', '--no-coverage', '--testTimeout=30000', ...patterns]
  const result = spawnSync('npx', ['vitest', ...args], {
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

/** Count issues by status. */
function countByStatus(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of evidenceIssues()) {
    const s = issueStatus(id)
    counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}

// Test directory patterns for each phase — these target the real test files
// that exercise the corresponding first-100 domain. Vitest treats positional
// args as filename substring filters.
const securityPatterns = [
  'packages/sandbox/',
  'packages/attachment/attachment-security/',
  'packages/workspace/workspace-trust/',
  'packages/plugin/plugin-host/',
  'packages/kernel/trust-kernel/',
  'packages/identity/',
  'packages/credentials/',
  'packages/execution/local-isolation/',
  'packages/execution/egress-proxy/',
]

const recoveryPatterns = [
  'packages/run/run/tests/recovery.spec.ts',
  'packages/run/message-bus/tests/crash.spec.ts',
  'packages/workflow/workflow-journal/tests/resume.spec.ts',
  'packages/interaction/approval-store/tests/recovery.spec.ts',
  'packages/llm/llm-retry/tests/transport-recovery.spec.ts',
  'packages/core/agent-loop/tests/resume.spec.ts',
  'packages/schedule/schedule/tests/jsonl-restart.spec.ts',
]

const providerPatterns = [
  'packages/hooks/hooks-codex/',
  'packages/hooks/hooks-claude-code/',
  'packages/sdk/protocol/tests/run-lifecycle.spec.ts',
  'packages/execution/execution-world-container/',
  'packages/execution/execution-world-remote/',
  'packages/subagent/subagent-codex/',
  'packages/subagent/subagent-claude-code/',
  'packages/acp/acp/',
]

const protocolPatterns = [
  'packages/sdk/protocol/tests/version-negotiation.spec.ts',
  'packages/sdk/protocol/tests/resources.contract.spec.ts',
  'packages/sdk/protocol/tests/transport.spec.ts',
  'packages/sdk/protocol/tests/event-stream.spec.ts',
  'packages/hooks/hook-protocol/',
  'packages/typert/protocol/',
]

const scalePatterns = [
  'packages/execution/resource-budget/',
  'packages/settings/settings-file/tests/concurrency.spec.ts',
  'packages/run/scheduler/',
  'packages/workflow/workflow/',
]

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
    success = runVitest(securityPatterns, 'security tests (sandbox, trust, identity, credentials)')
    reportStatus()
    break
  }
  case 'recovery': {
    success = runVitest(recoveryPatterns, 'recovery tests (crash, resume, durable state)')
    reportStatus()
    break
  }
  case 'providers': {
    success = runVitest(providerPatterns, 'provider tests (Codex, Claude Code, ACP, execution worlds)')
    reportStatus()
    break
  }
  case 'protocol': {
    success = runVitest(protocolPatterns, 'protocol tests (version negotiation, transport, streaming)')
    reportStatus()
    break
  }
  case 'capability': {
    success = run('node', ['--import', 'tsx', 'benchmarks/harness-capability/runner.ts'], 'benchmark:harness')
    reportStatus()
    break
  }
  case 'scale': {
    success = runVitest(scalePatterns, 'scale tests (resource budget, scheduler, concurrency)')
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
    const gateResults: Record<string, boolean> = {}
    for (const p of phases) {
      const result = spawnSync('pnpm', ['run', `first100:${p}`], {
        cwd: repoRoot,
        stdio: 'inherit',
        encoding: 'utf8',
      })
      gateResults[p] = result.status === 0
      if (result.status !== 0) {
        console.error(`[gate] FAIL: first100:${p}`)
        success = false
      }
    }
    const verified = allVerified()
    if (!verified) success = false

    // Generate readiness report
    const readinessDir = join(evidenceRoot, 'first100')
    mkdirSync(readinessDir, { recursive: true })
    const counts = countByStatus()
    const readiness = {
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      commit_sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
      upstream_base_sha: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      gate_results: gateResults,
      issue_counts: counts,
      total_issues: evidenceIssues().length,
      all_e2e_verified: verified,
      second_100_implementation: success ? 'GO' : 'NO_GO',
      blocking_reasons: success ? [] : [
        ...Object.entries(gateResults).filter(([, v]) => !v).map(([k]) => `gate first100:${k} FAILED`),
        ...verified ? [] : [`${counts['PARTIALLY_WIRED'] ?? 0} issues still PARTIALLY_WIRED`],
      ],
    }
    writeFileSync(join(readinessDir, 'second100-readiness.json'), JSON.stringify(readiness, null, 2) + '\n')
    console.log('\n[gate] Readiness report written to artifacts/evidence/first100/second100-readiness.json')

    if (success) {
      console.log('\n[gate] SECOND_100_IMPLEMENTATION = GO')
    } else {
      console.error('\n[gate] SECOND_100_IMPLEMENTATION = NO_GO')
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
