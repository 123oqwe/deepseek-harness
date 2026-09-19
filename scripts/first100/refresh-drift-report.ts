/**
 * Classify a refresh channel's `fixtures.patch` so a reviewer can tell clock
 * noise from a semantic rewrite.
 *
 * The channel's own self-check: run against a tree whose corpora are already
 * current, any field OTHER than a known clock that drifts means the refresh
 * host differed from the recording host, and a patch like that must not be
 * applied. Run 35467913630 is the worked example — two files had their tool
 * result rewritten to `Error: sandbox mode ... no sandbox backend` because the
 * job lacked a sandbox backend, while six carried nothing but wall clocks and
 * two carried an `idempotencyKey` besides.
 *
 * A re-record round is red here BY DESIGN. A refresh that follows a real
 * product change rewrites payloads on purpose, and this check has no way to
 * tell that from a host mismatch — it is the answer to "did this HOST record
 * what the last one did", asked of a tree that should already be current.
 *
 * Pairing is per HUNK, not per adjacent line. A unified diff groups a hunk's
 * removals before its insertions, so pairing `-` with the `+` that follows it
 * compares unrelated lines and invents changes that are not there — reading
 * that output once produced a "the record type changed" finding that the raw
 * hunk disproved.
 *
 * @module scripts/first100/refresh-drift-report
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Field names whose value is a clock, a duration, or derived from one.
 *
 * A closed list rather than a pattern: "ends in At" would sweep in fields
 * nobody has looked at, and this list decides whether a run is red.
 */
const CLOCK_FIELDS: ReadonlySet<string> = new Set([
  'time', 'time0', 'dt', 'durationMs', 'childCreatedAt',
])

/** One leaf whose value differs between the committed and refreshed line. */
export interface DriftedField {
  /** Repo-relative path of the fixture. */
  readonly file: string
  /** Name the column is decided by: the leaf path's last segment. */
  readonly field: string
  /** Full dotted path, so a reviewer can find the leaf in a long record. */
  readonly leaf?: string
}

/** A classified patch: clock-only drift, and everything else. */
export interface DriftReport {
  /** Drift in {@link CLOCK_FIELDS}, reported but not failing. */
  readonly clock: DriftedField[]
  /** Drift anywhere else, including unpaired hunks. This fails the run. */
  readonly semantic: DriftedField[]
}

/**
 * Every leaf path at which two parsed values differ.
 *
 * Every one, not the first: a line can carry a clock AND a rewritten tool
 * result, and reporting only the first difference sends that whole line to
 * whichever column the first one happens to land in. On run 35467913630's
 * patch the two corrupted `bash-tool` lines each differ at three leaves.
 * @param before - value from the committed line.
 * @param after - value from the refreshed line.
 * @param path - dotted path walked so far, empty at the root.
 * @returns one dotted path per differing leaf, in walk order.
 */
function differingLeaves(before: unknown, after: unknown, path = ''): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [path === '' ? '(array length)' : `${path}[]`]
    return before.flatMap((value, index) => differingLeaves(value, after[index], `${path}[${index}]`))
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys.flatMap((key) => {
      const next = path === '' ? key : `${path}.${key}`
      if (!(key in before) || !(key in after)) return [next]
      return differingLeaves(before[key], after[key], next)
    })
  }
  return before === after ? [] : [path === '' ? '(whole value)' : path]
}

/**
 * Whether a value is a plain object this walk can descend into.
 * @param value - candidate.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The field a dotted leaf path names.
 * @param leaf - a path from {@link differingLeaves}.
 * @returns the last segment, with any array index stripped.
 */
function fieldOf(leaf: string): string {
  return (leaf.split('.').at(-1) ?? leaf).replace(/\[\d+\]$/u, '')
}

/**
 * Compare two JSONL lines, naming every field whose value differs.
 * @param file - the fixture the lines belong to, for the report.
 * @param before - the committed line.
 * @param after - the refreshed line.
 * @returns one entry per differing leaf; a line that will not parse yields one
 *   entry that says so, because an unreadable rewrite is not clock noise.
 */
function compareLines(file: string, before: string, after: string): DriftedField[] {
  let parsedBefore: unknown
  let parsedAfter: unknown
  try {
    parsedBefore = JSON.parse(before)
    parsedAfter = JSON.parse(after)
  } catch {
    return [{ file, field: '(line is not JSON)' }]
  }
  return differingLeaves(parsedBefore, parsedAfter).map(leaf => ({ file, field: fieldOf(leaf), leaf }))
}

/**
 * Classify every change in a unified diff.
 *
 * A change block is a run of removals followed by a run of insertions, and it
 * is entered from EITHER — a hunk that only inserts records never has a `-`
 * line, and a scan that starts only on `-` would not see it at all. Equal
 * counts are compared pairwise; anything else is reported whole, because lines
 * were added or removed rather than rewritten and no clock does that.
 *
 * Every file named by a `diff --git` header must produce at least one entry.
 * A file is in the patch because it CHANGED, so a file this classifier read
 * nothing from is a file it could not read — `fixtures.patch` is generated
 * `--binary`, and a binary delta carries no line starting with `-` or `+`, so
 * the eight images under `snapshots/` would otherwise pass as clean.
 * @param patch - the contents of `fixtures.patch`.
 * @returns the drift, split into clock and semantic.
 */
export function classifyDrift(patch: string): DriftReport {
  const clock: DriftedField[] = []
  const semantic: DriftedField[] = []
  const lines = patch.split('\n')
  const isRemoval = (line: string | undefined): boolean => line !== undefined && line.startsWith('-') && !line.startsWith('---')
  const isInsertion = (line: string | undefined): boolean => line !== undefined && line.startsWith('+') && !line.startsWith('+++')
  const seen = new Set<string>()
  const named: string[] = []
  let file = '(unknown)'
  let i = 0
  const note = (entry: DriftedField, column: DriftedField[]): void => {
    seen.add(entry.file)
    column.push(entry)
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith('diff --git')) {
      file = line.split(' b/').at(-1) ?? file
      if (!named.includes(file)) named.push(file)
    }
    if (!isRemoval(line) && !isInsertion(line)) {
      i += 1
      continue
    }
    const removed: string[] = []
    while (isRemoval(lines[i])) {
      removed.push((lines[i] ?? '').slice(1))
      i += 1
    }
    const added: string[] = []
    while (isInsertion(lines[i])) {
      added.push((lines[i] ?? '').slice(1))
      i += 1
    }
    if (removed.length !== added.length) {
      note({ file, field: `(unpaired hunk: ${removed.length} removed, ${added.length} added)` }, semantic)
      continue
    }
    for (const [index, before] of removed.entries()) {
      for (const drift of compareLines(file, before, added[index] ?? '')) {
        note(drift, CLOCK_FIELDS.has(drift.field) ? clock : semantic)
      }
    }
  }
  for (const name of named) {
    if (!seen.has(name)) semantic.push({ file: name, field: '(changed, but no readable line: a binary delta or an unknown diff form)' })
  }
  return { clock, semantic }
}

/**
 * Render the report a reviewer reads in the artifact.
 * @param report - the classified drift.
 * @returns the report text, ending in a single newline.
 */
export function renderDriftReport(report: DriftReport): string {
  const section = (title: string, rows: readonly DriftedField[]): string =>
    rows.length === 0
      ? `${title}: none\n`
      : `${title}: ${rows.length}\n${rows.map(row => `  ${row.file}  ${row.leaf ?? row.field}\n`).join('')}`
  return section('clock fields (reported, not failing)', report.clock)
    + section('OTHER fields (a refresh on a current tree must show none)', report.semantic)
}

/* v8 ignore start -- the entry guard runs only when this file is the process entry. */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [patchPath, outPath] = process.argv.slice(2)
  if (patchPath === undefined || outPath === undefined) {
    throw new Error('refresh-drift-report: pass <fixtures.patch> <drift-report.txt>')
  }
  const report = classifyDrift(readFileSync(patchPath, 'utf8'))
  writeFileSync(outPath, renderDriftReport(report))
  process.stdout.write(renderDriftReport(report))
  if (report.semantic.length > 0) {
    process.stderr.write('refresh-drift-report: a tree that should be current drifted in non-clock fields; do not apply this patch\n')
    process.exit(1)
  }
}
/* v8 ignore stop */
