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
 * So the check is mechanical and narrow, and it is asked PER EPIC: the union of
 * an epic's live U-stage freeze entries must contain at least one file the
 * registry's own `stages.U` list marks `[B]` — a BASELINE file, one that
 * existed before this epic and belongs to the consumer the plan named.
 *
 * **Per epic, not per entry (§12.24-3).** An early library-level U entry
 * records what was observed at the SHA it was frozen against, and a later
 * supplement that reaches the declared consumer does not make that observation
 * untrue. Asking each entry separately would force the earlier one to be
 * superseded — rewriting provenance to satisfy a check about scope. A stage
 * that as a whole never reaches its consumer is still red, which is the
 * failure this gate exists for.
 *
 * An epic that genuinely should not touch its declared consumer says so in
 * `usage-subject-exemptions.json`, with the BLOCKED entry and the ruling that
 * decided it.
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
 * Epics whose live U-stage entries, taken together, cite none of their
 * declared stage-U baseline files.
 * @param registry - the parsed registry.
 * @param freeze - all freeze entries; superseded ones are skipped here.
 * @param exemptions - `{ "<epic>": { blocked, ruling } }`, keyed by epic since §12.24-3.
 * @returns one finding per unexempted epic.
 */
export function usageEntriesWithoutSubject(registry, freeze, exemptions) {
  const byId = new Map(registry.epics.map(epic => [epic.id, epic]))
  /** Every file cited by an epic's live U entries, and the entry keys behind them. */
  const cited = new Map()
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined || entry.stage !== 'U') continue
    if (!byId.has(entry.epic)) continue
    const seen = cited.get(entry.epic) ?? { files: new Set(), entries: [] }
    for (const path of entry.files ?? []) seen.files.add(path)
    seen.entries.push(entry.supplementSeq === undefined ? `${entry.epic}.U` : `${entry.epic}.U.${String(entry.supplementSeq)}`)
    cited.set(entry.epic, seen)
  }

  const findings = []
  for (const [id, seen] of cited) {
    const subjects = usageBaselineFiles(byId.get(id))
    if (subjects.some(path => seen.files.has(path))) continue
    const exemption = exemptions[id]
    if (exemption !== undefined && typeof exemption.blocked === 'string' && typeof exemption.ruling === 'string') continue
    findings.push({ key: id, subjects, files: [...seen.files], entries: seen.entries })
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
      `verify-usage-stage-subject: ${String(findings.length)} epic(s) whose Usage stage, taken as a whole, touches none of the consumer files its registry row names.\n`
      + 'A Usage stage inside the epic\'s own package proves the library, not the use of it. Touch the declared consumer, or record the entry in\n'
      + 'spec/first100/exec/usage-subject-exemptions.json with the BLOCKED entry and the ruling that says why the registry\'s consumer is wrong.\n',
    )
    for (const { key, subjects, files, entries } of findings) {
      console.error(`  ${key} (live U entries: ${entries.join(', ')})`)
      console.error(`      registry stage-U [B] files: ${subjects.length > 0 ? subjects.join(', ') : '(none — the row names no baseline consumer)'}`)
      console.error(`      frozen files across those entries: ${files.join(', ')}`)
    }
    process.exit(1)
  }
  console.log('verify-usage-stage-subject: every epic\'s live Usage stage touches a consumer file its registry row names, or is exempted with a ruling.')
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
