/**
 * Evidence collection script: runs a command, captures results, and writes
 * an evidence package with digests for offline verification.
 *
 * Usage: node scripts/release/collect-evidence.mjs -- <command> [args...]
 *
 * @module collect-evidence
 */

import { createHash } from 'node:crypto'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function gitSha() {
  try {
    return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()
  } catch {
    return 'unknown'
  }
}

function gitDiffSummary() {
  try {
    return spawnSync('git', ['diff', '--stat'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()
  } catch {
    return ''
  }
}

function getBaselineFingerprint() {
  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) return undefined
  return sha256(readFileSync(baselinePath, 'utf8'))
}

function getBuildArtifactDigests() {
  const digests = {}
  const artifactPaths = [
    'packages/kernel/trust-kernel/lib/index.js',
    'packages/schema/schema-registry/lib/index.js',
  ]
  for (const p of artifactPaths) {
    const abs = join(repoRoot, p)
    if (existsSync(abs)) {
      digests[p] = sha256(readFileSync(abs))
    }
  }
  return digests
}

export function collectEvidence(command, gateName = 'test') {
  const startedAt = new Date().toISOString()
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 300000,
  })
  const finishedAt = new Date().toISOString()

  const gateResult = {
    gate: gateName,
    command: command.join(' '),
    startedAt,
    finishedAt,
    exitCode: result.status ?? 1,
    blocking: true,
    stdoutDigest: sha256(result.stdout ?? ''),
    stderrDigest: sha256(result.stderr ?? ''),
    accepted: (result.status ?? 1) === 0,
  }

  return { gates: [gateResult], accepted: gateResult.accepted }
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('collect-evidence.mjs')) {
  const { values, positionals } = parseArgs({
    options: { gate: { type: 'string', default: 'test' } },
    allowPositionals: true,
  })

  const cmd = positionals.filter(p => p !== '--')
  if (cmd.length === 0) {
    console.error('Usage: collect-evidence.mjs [--gate <name>] -- <command> [args...]')
    process.exit(1)
  }

  const collected = collectEvidence(cmd, values.gate)

  const evidence = {
    collectedAt: new Date().toISOString(),
    gitSha: gitSha(),
    gitDiffSummary: gitDiffSummary(),
    baselineFingerprint: getBaselineFingerprint(),
    gates: collected.gates,
    buildArtifactDigests: getBuildArtifactDigests(),
    accepted: collected.accepted,
  }

  const packageDigest = sha256(JSON.stringify(evidence, Object.keys(evidence).sort()))
  const finalPackage = { ...evidence, packageDigest }

  const evidenceDir = join(repoRoot, 'artifacts/evidence/release')
  mkdirSync(evidenceDir, { recursive: true })
  const outPath = join(evidenceDir, 'evidence-package.json')
  writeFileSync(outPath, JSON.stringify(finalPackage, null, 2) + '\n')

  console.log(`evidence: collected to ${outPath}`)
  console.log(`  accepted: ${finalPackage.accepted}`)
  console.log(`  gates: ${finalPackage.gates.length}`)
  console.log(`  packageDigest: ${finalPackage.packageDigest?.slice(0, 16)}...`)
}
