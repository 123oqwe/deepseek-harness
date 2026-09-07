/**
 * Gate (u): a Usage stage must touch the consumer the registry names.
 *
 * A U-stage freeze whose files are all inside the epic's own package proves the
 * epic's library works. It cannot prove the harness USES it, and the difference
 * is not academic — it cost three sign-offs in one afternoon. P2-03's manifest
 * had no constructor on any live path, P5-11's mailbox had no importer but an
 * unmounted bus, and P4-08's journal had none at all, and all three were signed
 * because "usage" had been read as a second layer of unit tests inside the same
 * package.
 *
 * So the check is mechanical and narrow: at least one file in a U-stage freeze
 * entry must be a file the registry's own `stages.U` list marks `[B]` — a
 * BASELINE file, one that existed before this epic and belongs to the consumer
 * the plan named. An epic that genuinely should not touch its declared consumer
 * says so in `usage-subject-exemptions.json`, with the BLOCKED entry and the
 * ruling that decided it.
 *
 * **What this gate does NOT check**: that the touched file is reached at run
 * time. A file can be edited and still be dead. 4.4a — counting a clause
 * subject's production callers before signing — is the human half, and this is
 * the half a machine can hold.
 *
 * Usage: `node scripts/first100/verify-usage-stage-subject.mjs`
 *
 * @module scripts/first100/verify-usage-stage-subject
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const EXEMPTIONS_PATH = join(REPO_ROOT, 'spec/first100/exec/usage-subject-exemptions.json')

const loadJson = path => JSON.parse(readFileSync(path, 'utf8'))

/**
 * The `[B]` baseline files an epic's registry row assigns to its Usage stage.
 *
 * The intersection is the point: `files[]` says which paths are baseline, and
 * `stages.U` says which the Usage stage is about. A stage-U file that is `[N]`
 * is this epic's own new code, and touching only that is exactly the shape this
 * gate exists to catch.
 * @param epic - the registry row.
 * @returns repo-relative paths.
 */
export function usageBaselineFiles(epic) {
  const baseline = new Set((epic.files ?? []).filter(file => file.kind === 'B').map(file => file.path))
  return (epic.stages?.U?.files ?? []).filter(path => baseline.has(path))
}

/**
 * U-stage freeze entries that cite none of their epic's stage-U baseline files.
 * @param registry - the parsed registry.
 * @param freeze - all freeze entries; superseded ones are skipped here.
 * @param exemptions - `{ "<epic>.U[.<seq>]": { blocked, ruling } }`.
 * @returns one finding per unexempted entry.
 */
export function usageEntriesWithoutSubject(registry, freeze, exemptions) {
  const byId = new Map(registry.epics.map(epic => [epic.id, epic]))
  const findings = []
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined || entry.stage !== 'U') continue
    const epic = byId.get(entry.epic)
    if (epic === undefined) continue
    const subjects = usageBaselineFiles(epic)
    if ((entry.files ?? []).some(path => subjects.includes(path))) continue
    const key = entry.supplementSeq === undefined ? `${entry.epic}.U` : `${entry.epic}.U.${String(entry.supplementSeq)}`
    const exemption = exemptions[key]
    if (exemption !== undefined && typeof exemption.blocked === 'string' && typeof exemption.ruling === 'string') continue
    findings.push({ key, subjects, files: entry.files ?? [] })
  }
  return findings
}

function main() {
  const registry = loadJson(REGISTRY_PATH)
  const freeze = loadJson(FREEZE_PATH).entries
  const exemptions = existsSync(EXEMPTIONS_PATH) ? loadJson(EXEMPTIONS_PATH).exemptions ?? {} : {}
  const findings = usageEntriesWithoutSubject(registry, freeze, exemptions)

  if (findings.length > 0) {
    console.error(
      `verify-usage-stage-subject: ${String(findings.length)} Usage-stage freeze entry/entries touch none of the consumer files their registry row names.\n`
      + 'A Usage stage inside the epic\'s own package proves the library, not the use of it. Touch the declared consumer, or record the entry in\n'
      + 'spec/first100/exec/usage-subject-exemptions.json with the BLOCKED entry and the ruling that says why the registry\'s consumer is wrong.\n',
    )
    for (const { key, subjects, files } of findings) {
      console.error(`  ${key}`)
      console.error(`      registry stage-U [B] files: ${subjects.length > 0 ? subjects.join(', ') : '(none — the row names no baseline consumer)'}`)
      console.error(`      frozen files: ${files.join(', ')}`)
    }
    process.exit(1)
  }
  console.log('verify-usage-stage-subject: every live Usage-stage freeze entry touches a consumer file its registry row names, or is exempted with a ruling.')
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
