#!/usr/bin/env node
/**
 * BLOCKED-040 mechanical gate: every command-freeze.json frozen expectCases
 * title must either still be collected by its own frozen argv command
 * (a real `vitest run ... --reporter=json` execution, exactly the mechanism
 * generate-ledger.mjs's own cmdGreen/cmdSupplement trust), or have a
 * registered rename in frozen-title-renames.json mapping the old title to
 * the new one.
 *
 * Predicate (iii) in generate-ledger.mjs binds an ACCEPTED cell to the
 * frozen observation report, not to live-tree resolvability -- a later
 * stage renaming an it()/test() title an earlier, already-frozen stage
 * depended on does not invalidate that earlier ACCEPTED cell. But nothing
 * mechanically detected that drift class before BLOCKED-040: P0-05's P-stage
 * work (commit e39d97ad64ab1508094a66b2e67b758e020e1f25) renamed a title
 * P0-05.C's own frozen command-freeze.json entry depends on, and it was
 * found by chance, not by any gate. This script is that gate, run on demand
 * (not wired into slice-gate, matching verify-baseline-file-references.mjs's
 * precedent) against the live working tree.
 *
 * A real `vitest run --reporter=json` execution is required, not a static
 * grep of the target file(s): a materially large fraction of this
 * codebase's frozen titles come from `it.each`/`test.each` printf-style
 * templates (e.g. `it.each([...])('rejects an invalid first version %j', ...)`)
 * whose expanded title text (`rejects an invalid first version {"major":0...}`)
 * exists only at runtime, never as source text. Matching against each
 * assertion's real `title` and `fullName` (vitest's own
 * `ancestorTitles.join(' ') + ' ' + title`) is the same mechanism
 * generate-ledger.mjs's parseVitestJsonReport already trusts, so this gate
 * reuses that definition rather than inventing a second one.
 *
 * Entries with byte-identical argv run once and share the result -- most
 * command-freeze.json entries share a target with a sibling stage.
 *
 * CLI:
 *   node scripts/first100/verify-frozen-titles-resolvable.mjs
 *     [--report <path>]        write full JSON findings to this path
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const RENAMES_PATH = join(REPO_ROOT, 'spec/first100/exec/frozen-title-renames.json')

const cliArgs = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = cliArgs.indexOf(`--${name}`)
  return i >= 0 && cliArgs[i + 1] !== undefined ? cliArgs[i + 1] : fallback
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Runs a frozen entry's own argv and collects every assertion's title/fullName, any status. */
function runAndCollectTitles(argvList) {
  const [cmd, ...args] = argvList
  const result = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) {
    return { ok: false, error: `failed to spawn ${JSON.stringify(argvList)}: ${result.error.message}`, titles: new Set() }
  }
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch (err) {
    return {
      ok: false,
      error: `${JSON.stringify(argvList)} did not produce parseable --reporter=json JSON on stdout (exit ${result.status}): ${err.message}`,
      titles: new Set(),
    }
  }
  const titles = new Set()
  for (const file of report.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (typeof a.title === 'string') titles.add(a.title)
      // vitest's real `--reporter=json` shape: `fullName` is
      // `ancestorTitles.join(' ') + ' ' + title` (space-separated, no
      // delimiter) -- generate-ledger.mjs's parseVitestJsonReport matches on
      // it directly rather than reconstructing it; this gate does the same.
      if (typeof a.fullName === 'string') titles.add(a.fullName)
    }
  }
  return { ok: true, titles }
}

function main() {
  const freeze = loadJson(FREEZE_PATH)
  const renames = loadJson(RENAMES_PATH)

  const renameIndex = new Map()
  for (const r of renames.entries) {
    renameIndex.set(`${r.epic}|${r.stage}|${r.oldTitle}`, r)
  }

  const runCache = new Map()
  const runResultFor = (argvList) => {
    const key = JSON.stringify(argvList)
    if (!runCache.has(key)) {
      console.log(`running ${argvList.join(' ')} ...`)
      runCache.set(key, runAndCollectTitles(argvList))
    }
    return runCache.get(key)
  }

  const entries = {}
  let totalTitles = 0
  let totalUnresolved = 0
  let totalRenameCovered = 0
  let entriesWithProblems = 0

  for (const e of freeze.entries) {
    // A superseded entry's titles are retired by construction: supersession
    // records that a later entry replaced this one for the same (epic, stage),
    // which is a different fact from a title being renamed without a register
    // record. Checking them would report every supersession as drift.
    if (e.supersededBy !== undefined) continue

    const key = `${e.epic}.${e.stage}`
    const run = runResultFor(e.argv)

    if (!run.ok) {
      entriesWithProblems += 1
      entries[key] = { argv: e.argv, runError: run.error, unresolved: [], renameCovered: [] }
      continue
    }

    const unresolved = []
    const renameCovered = []
    for (const title of e.expectCases) {
      totalTitles += 1
      if (run.titles.has(title)) continue
      const renameEntry = renameIndex.get(`${e.epic}|${e.stage}|${title}`)
      if (renameEntry) {
        totalRenameCovered += 1
        if (run.titles.has(renameEntry.newTitle)) {
          renameCovered.push({ oldTitle: title, newTitle: renameEntry.newTitle, renamedInCommit: renameEntry.renamedInCommit })
        } else {
          totalUnresolved += 1
          unresolved.push({
            title,
            reason: `registered rename's newTitle is ALSO not resolvable: ${JSON.stringify(renameEntry.newTitle)}`,
          })
        }
        continue
      }
      totalUnresolved += 1
      unresolved.push({ title, reason: 'not found in the frozen command\'s real vitest --reporter=json output and no registered rename' })
    }

    if (unresolved.length > 0) {
      entriesWithProblems += 1
      entries[key] = { argv: e.argv, unresolved, renameCovered }
    }
  }

  const findings = {
    summary: {
      totalEntries: freeze.entries.length,
      uniqueCommandsRun: runCache.size,
      entriesWithProblems,
      totalTitles,
      totalUnresolved,
      totalRenameCovered,
    },
    entries,
  }

  const reportPath = opt('report')
  if (reportPath) writeFileSync(resolve(REPO_ROOT, reportPath), `${JSON.stringify(findings, null, 2)}\n`, 'utf8')

  console.log(
    `command-freeze.json: ${freeze.entries.length} entries, ${runCache.size} unique command(s) run, ` +
      `${totalTitles} frozen titles, ${totalRenameCovered} covered by a registered rename, ${totalUnresolved} UNRESOLVED.`,
  )
  if (entriesWithProblems > 0) {
    console.error('UNRESOLVED (fail-closed):')
    for (const [key, e] of Object.entries(entries)) {
      if (e.runError) console.error(`  ${key}: ${e.runError}`)
      for (const u of e.unresolved) console.error(`  ${key}: ${JSON.stringify(u.title)} -- ${u.reason}`)
    }
  }

  process.exit(entriesWithProblems > 0 ? 1 : 0)
}

main()
