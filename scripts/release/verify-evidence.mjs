#!/usr/bin/env node
/**
 * `pnpm evidence:verify` (P0-07 P-stage implementation of the C-stage type
 * contract in `packages/assurance/evidence-format/src/types.ts` and
 * `tests/release/evidence-package.spec.ts`).
 *
 * Reads an `EvidencePackage` written by `collect-evidence.mjs` back from
 * disk and independently RECOMPUTES every digest it carries from the real,
 * current bytes of whatever it references — never re-running the gate
 * commands that produced it (acceptance[1]: fully offline verification):
 *
 *   node scripts/release/verify-evidence.mjs --evidence .dsh/evidence/evidence.json
 *
 * For every `GateEvidence` (`requiredGates` and `additionalGates` alike):
 * recomputes `recordDigest` over the record's own other fields and, for a
 * `completed` outcome, re-hashes its captured log
 * (`<sidecar>/logs/<gateId>.log`) and every listed artifact at its real
 * repo-relative path. Re-hashes `.dsh/baseline.json` against
 * `baselineFingerprint.digest`, the sidecar `gitdiff.patch` against
 * `gitDiff.digest`, and every `requiredBuildArtifacts` path. Recomputes the
 * package-level `signature` (a content-integrity digest — see
 * `collect-evidence.mjs`'s module doc for exactly what it does and does not
 * defend against) over the package's own canonical serialization. Any
 * mismatch — a referenced file's bytes changed since collection
 * (acceptance[0]'s tampering scenario), or the package JSON itself was
 * hand-edited — fails verification and names every mismatch found, not just
 * the first.
 *
 * Also re-derives must[2] against the real, loaded data rather than trusting
 * the recorded `accepted` field: when `accepted: true`, every entry in
 * `requiredGates` must genuinely be a passing (`exitCode === 0`)
 * `CompletedGateEvidence`, and every `--required-artifact` path declared at
 * `collect-evidence.mjs init` (`<sidecar>/manifest.json`) must genuinely be
 * present in `requiredBuildArtifacts` — proving must[2] holds for real
 * collected evidence, not only for a compile-time literal.
 *
 * CLI: `node scripts/release/verify-evidence.mjs [--repo-root <path>] --evidence <path>`
 * `--repo-root` defaults to `process.cwd()`. Exits 0 with no mismatches, 1
 * otherwise, printing every mismatch found.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { digestOfFile, digestOfValue, sidecarDir } from './collect-evidence.mjs'

function flagOne(flags, name, fallback) {
  const values = flags.get(name)
  if (values === undefined || values.length === 0) return fallback
  return values[values.length - 1]
}

function parseFlags(argv) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new Error(`verify-evidence: unexpected argument ${JSON.stringify(token)}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`verify-evidence: ${token} requires a value`)
    flags.set(token, [...(flags.get(token) ?? []), value])
    i++
  }
  return flags
}

/** Recomputes one `GateEvidence` record's own `recordDigest` and reports a mismatch. */
function verifyRecordDigest(record, label, mismatches) {
  const { recordDigest, ...rest } = record
  const recomputed = digestOfValue(rest)
  if (recomputed !== recordDigest) mismatches.push(`${label}: recordDigest mismatch (recorded ${recordDigest}, recomputed ${recomputed})`)
}

/** For a `completed` gate, re-hashes its captured log and every listed artifact from their real current bytes. */
function verifyGateFiles(record, repoRoot, dir, label, mismatches) {
  if (record.outcome !== 'completed') return
  const logPath = join(dir, 'logs', `${record.gateId}.log`)
  if (!existsSync(logPath)) {
    mismatches.push(`${label}: log file missing at ${logPath}`)
  } else {
    const recomputed = digestOfFile(logPath)
    if (recomputed !== record.logDigest) mismatches.push(`${label}: logDigest mismatch (recorded ${record.logDigest}, recomputed ${recomputed})`)
  }
  for (const artifact of record.artifacts) {
    const artifactPath = join(repoRoot, artifact.path)
    if (!existsSync(artifactPath)) {
      mismatches.push(`${label}: artifact missing at ${artifact.path}`)
      continue
    }
    const recomputed = digestOfFile(artifactPath)
    if (recomputed !== artifact.digest) mismatches.push(`${label}: artifact ${artifact.path} digest mismatch (recorded ${artifact.digest}, recomputed ${recomputed})`)
  }
}

/** Re-derives must[2] against the real loaded data: an `accepted: true` package must genuinely have every required gate passing and every declared required artifact present. */
function verifyAcceptedInvariant(pkg, requiredArtifactPaths, mismatches) {
  if (pkg.accepted !== true) return
  for (const [gateId, record] of Object.entries(pkg.requiredGates)) {
    if (record.outcome !== 'completed' || record.exitCode !== 0) {
      mismatches.push(`accepted=true but required gate ${gateId} is not a passing CompletedGateEvidence (outcome=${record.outcome}, exitCode=${record.exitCode})`)
    }
  }
  for (const path of requiredArtifactPaths) {
    if (!Object.prototype.hasOwnProperty.call(pkg.requiredBuildArtifacts, path)) {
      mismatches.push(`accepted=true but required build artifact ${path} is not recorded in requiredBuildArtifacts`)
    }
  }
}

/**
 * Verify one evidence package fully offline: recompute every digest it
 * carries from real current bytes on disk, and re-derive must[2] against
 * the real loaded data.
 * @param {string} repoRoot - checkout root artifact/build-artifact paths resolve against.
 * @param {string} evidencePath - path to the evidence package JSON to verify.
 * @returns {{ ok: boolean, mismatches: string[] }}
 */
export function verify(repoRoot, evidencePath) {
  const mismatches = []
  if (!existsSync(evidencePath)) return { ok: false, mismatches: [`no evidence package at ${evidencePath}`] }

  const pkg = JSON.parse(readFileSync(evidencePath, 'utf8'))
  const dir = sidecarDir(evidencePath)

  const { signature, ...rest } = pkg
  const recomputedSignature = digestOfValue(rest)
  if (recomputedSignature !== signature) mismatches.push(`package signature mismatch (recorded ${signature}, recomputed ${recomputedSignature})`)

  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) {
    mismatches.push(`no .dsh/baseline.json at ${baselinePath} to verify baselineFingerprint against`)
  } else {
    const recomputed = digestOfFile(baselinePath)
    if (recomputed !== pkg.baselineFingerprint.digest) {
      mismatches.push(`baselineFingerprint digest mismatch (recorded ${pkg.baselineFingerprint.digest}, recomputed ${recomputed})`)
    }
  }

  const diffPath = join(dir, 'gitdiff.patch')
  if (!existsSync(diffPath)) {
    mismatches.push(`gitDiff sidecar missing at ${diffPath}`)
  } else {
    const recomputed = digestOfFile(diffPath)
    if (recomputed !== pkg.gitDiff.digest) mismatches.push(`gitDiff digest mismatch (recorded ${pkg.gitDiff.digest}, recomputed ${recomputed})`)
  }

  for (const [gateId, record] of Object.entries(pkg.requiredGates)) {
    const label = `requiredGates.${gateId}`
    verifyRecordDigest(record, label, mismatches)
    verifyGateFiles(record, repoRoot, dir, label, mismatches)
  }
  for (const record of pkg.additionalGates) {
    const label = `additionalGates.${record.gateId}`
    verifyRecordDigest(record, label, mismatches)
    verifyGateFiles(record, repoRoot, dir, label, mismatches)
  }

  for (const [path, digest] of Object.entries(pkg.requiredBuildArtifacts)) {
    const artifactPath = join(repoRoot, path)
    if (!existsSync(artifactPath)) {
      mismatches.push(`required build artifact missing at ${path}`)
      continue
    }
    const recomputed = digestOfFile(artifactPath)
    if (recomputed !== digest) mismatches.push(`required build artifact ${path} digest mismatch (recorded ${digest}, recomputed ${recomputed})`)
  }

  const manifestPath = join(dir, 'manifest.json')
  const requiredArtifactPaths = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).requiredArtifactPaths : []
  verifyAcceptedInvariant(pkg, requiredArtifactPaths, mismatches)

  return { ok: mismatches.length === 0, mismatches }
}

function main() {
  const flags = parseFlags(process.argv.slice(2))
  const repoRoot = flagOne(flags, '--repo-root', process.cwd())
  const evidenceArg = flagOne(flags, '--evidence')
  if (evidenceArg === undefined) throw new Error('verify-evidence: --evidence is required')
  const evidencePath = resolve(repoRoot, evidenceArg)

  const result = verify(repoRoot, evidencePath)
  if (result.ok) {
    process.stdout.write(`verify-evidence: ${evidencePath} verified offline, no mismatches\n`)
    process.exit(0)
  }
  process.stdout.write(`verify-evidence: ${evidencePath} FAILED verification:\n${result.mismatches.map(line => `  ${line}`).join('\n')}\n`)
  process.exit(1)
}

if (import.meta.main) main()
