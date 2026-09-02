#!/usr/bin/env node
/**
 * BASE-ALIGN-v2 mechanical file-reference verification gate (BLOCKED-016
 * item 4, BLOCKED-033, BLOCKED-034).
 *
 * v1 BASE-ALIGN relied on a human gap-analysis pass to notice registry file
 * references gone stale against a baseline -- BLOCKED-033 found 9 such
 * references across 8 epics had ALREADY drifted on the current frozen
 * baseline itself, undetected by any mechanical check the whole time this
 * program ran. This script closes that gap: it is the permanent, reusable
 * gate any future baseline re-anchor runs, replacing manual patrol.
 *
 * Every registry epic's `files[]` entries carry a `kind`: `B` (baseline --
 * this file is claimed to already exist at the pinned baseline SHA, per
 * `first100-requirements-matrix.md`'s own `[B]`/`[N]`/`[P]` legend), `N`
 * (new -- this epic creates the file for the first time), or `P`
 * (prior_output -- created by an earlier stage of the SAME epic; existence
 * depends on that epic's own build sequence, not the baseline tree, so it
 * is intentionally not checked here).
 *
 * Fail-closed default: any `kind: 'B'` reference that does not exist as a
 * real git blob at the given baseline SHA fails the run. A `kind: 'N'`
 * reference that ALREADY exists at the baseline is reported as a
 * PARTIAL-rescope signal (informational by default, `--strict-n` promotes
 * it to a failure) -- existing-N is exactly the shape of evidence
 * BASE-ALIGN-v2's 23-epic rescope process consumes, never an automatic
 * verdict on its own.
 *
 * CLI:
 *   node scripts/first100/verify-baseline-file-references.mjs
 *     [--baseline-sha <sha>]   default: registry.json's own frozenBaseline.sha
 *     [--report <path>]        write full JSON findings to this path
 *     [--strict-n]             also fail closed on any existing kind=N reference
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function blobExists(sha, path) {
  return spawnSync('git', ['cat-file', '-e', `${sha}:${path}`], { cwd: REPO_ROOT }).status === 0
}

function main() {
  const registry = loadJson(REGISTRY_PATH)
  const baselineSha = opt('baseline-sha', registry.frozenBaseline?.sha)
  if (!baselineSha) {
    console.error('no --baseline-sha given and registry.json has no frozenBaseline.sha')
    process.exit(1)
  }
  const check = spawnSync('git', ['cat-file', '-e', `${baselineSha}^{commit}`], { cwd: REPO_ROOT })
  if (check.status !== 0) {
    console.error(`--baseline-sha ${baselineSha} is not a real, locally-reachable commit (git cat-file -e failed)`)
    process.exit(1)
  }

  const strictN = flag('strict-n')
  const epics = {}
  let totalMissingB = 0
  let totalExistingN = 0
  let epicsWithMissingB = 0
  let epicsWithExistingN = 0

  for (const epic of registry.epics) {
    const missingB = []
    const existingN = []
    let okB = 0
    let okN = 0
    let pCount = 0
    for (const f of epic.files ?? []) {
      if (f.kind === 'B') {
        if (blobExists(baselineSha, f.path)) okB += 1
        else missingB.push(f.path)
      } else if (f.kind === 'N') {
        if (blobExists(baselineSha, f.path)) existingN.push(f.path)
        else okN += 1
      } else if (f.kind === 'P') {
        pCount += 1
      } else {
        console.error(`${epic.id}: unknown files[] kind ${JSON.stringify(f.kind)} for ${f.path}`)
        process.exit(1)
      }
    }
    if (missingB.length > 0 || existingN.length > 0 || okB > 0 || okN > 0 || pCount > 0) {
      epics[epic.id] = { missingB, existingN, okB, okN, pCount }
    }
    if (missingB.length > 0) {
      epicsWithMissingB += 1
      totalMissingB += missingB.length
    }
    if (existingN.length > 0) {
      epicsWithExistingN += 1
      totalExistingN += existingN.length
    }
  }

  const findings = {
    baselineSha,
    strictN,
    summary: {
      totalEpics: registry.epics.length,
      epicsWithMissingB,
      totalMissingB,
      epicsWithExistingN,
      totalExistingN,
    },
    epics,
  }

  const reportPath = opt('report')
  if (reportPath) writeFileSync(resolve(REPO_ROOT, reportPath), `${JSON.stringify(findings, null, 2)}\n`, 'utf8')

  console.log(
    `baseline ${baselineSha}: ${findings.summary.totalEpics} epics checked, ` +
      `${epicsWithMissingB} epic(s) with a missing kind=B reference (${totalMissingB} total), ` +
      `${epicsWithExistingN} epic(s) with an already-existing kind=N reference (${totalExistingN} total, PARTIAL-rescope signal)${strictN ? ' [--strict-n: also fail-closed]' : ''}.`,
  )
  if (epicsWithMissingB > 0) {
    console.error('MISSING kind=B references (fail-closed):')
    for (const [id, e] of Object.entries(epics)) {
      if (e.missingB.length > 0) console.error(`  ${id}: ${e.missingB.join(', ')}`)
    }
  }
  if (epicsWithExistingN > 0) {
    console.log(`already-existing kind=N references (PARTIAL-rescope signal${strictN ? ', fail-closed' : ', informational'}):`)
    for (const [id, e] of Object.entries(epics)) {
      if (e.existingN.length > 0) console.log(`  ${id}: ${e.existingN.join(', ')}`)
    }
  }

  const fail = epicsWithMissingB > 0 || (strictN && epicsWithExistingN > 0)
  process.exit(fail ? 1 : 0)
}

main()
