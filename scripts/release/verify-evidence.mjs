/**
 * Evidence verification script: loads an evidence package and verifies
 * all digests, gate results, and integrity.
 *
 * Usage: node scripts/release/verify-evidence.mjs [path/to/evidence-package.json]
 *
 * @module verify-evidence
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function verifyEvidence(evidencePath) {
  const failures = []

  if (!existsSync(evidencePath)) {
    return { verified: false, failures: ['evidence package not found'] }
  }

  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))

  if (evidence.packageDigest) {
    const { packageDigest, ...rest } = evidence
    const computed = sha256(JSON.stringify(rest, Object.keys(rest).sort()))
    if (computed !== packageDigest) {
      failures.push(`package digest mismatch: expected ${packageDigest.slice(0, 16)}, got ${computed.slice(0, 16)}`)
    }
  } else {
    failures.push('package digest missing')
  }

  if (!evidence.gates || evidence.gates.length === 0) {
    failures.push('no gate results found')
  } else {
    for (const gate of evidence.gates) {
      if (gate.blocking && gate.exitCode !== 0) {
        failures.push(`blocking gate '${gate.gate}' failed with exit code ${gate.exitCode}`)
      }
      if (gate.blocking && !gate.accepted) {
        failures.push(`blocking gate '${gate.gate}' was not accepted`)
      }
      if (gate.blocking && gate.skipReason) {
        failures.push(`blocking gate '${gate.gate}' was skipped: ${gate.skipReason}`)
      }
    }
  }

  if (!evidence.accepted) {
    failures.push('evidence package is not accepted')
  }

  if (evidence.buildArtifactDigests) {
    for (const [path, expectedDigest] of Object.entries(evidence.buildArtifactDigests)) {
      const absPath = join(repoRoot, path)
      if (!existsSync(absPath)) {
        failures.push(`build artifact missing: ${path}`)
      } else {
        const actualDigest = sha256(readFileSync(absPath))
        if (actualDigest !== expectedDigest) {
          failures.push(`build artifact digest mismatch for ${path}`)
        }
      }
    }
  }

  if (evidence.baselineFingerprint) {
    const baselinePath = join(repoRoot, '.dsh/baseline.json')
    if (!existsSync(baselinePath)) {
      failures.push('baseline fingerprint referenced but .dsh/baseline.json missing')
    } else {
      const actualFp = sha256(readFileSync(baselinePath, 'utf8'))
      if (actualFp !== evidence.baselineFingerprint) {
        failures.push('baseline fingerprint mismatch')
      }
    }
  }

  return { verified: failures.length === 0, failures }
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('verify-evidence.mjs')) {
  const evidencePath = process.argv[2] ?? join(repoRoot, 'artifacts/evidence/release/evidence-package.json')
  const result = verifyEvidence(evidencePath)
  if (result.verified) {
    console.log('evidence: VERIFIED — all checks passed')
    process.exit(0)
  } else {
    console.error('evidence: VERIFICATION FAILED:')
    for (const f of result.failures) {
      console.error(`  - ${f}`)
    }
    process.exit(1)
  }
}
