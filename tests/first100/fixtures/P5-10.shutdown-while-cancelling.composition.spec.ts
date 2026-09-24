/**
 * BLOCKED-333 (P5-10 must[2]) on the shipped headless composition: a
 * continuable child whose cancellation is still ending when the host shuts
 * down gracefully is reported to its parent as stopped, once, and no later
 * turn of that child reaches the parent before the report.
 *
 * `./loader/p5-10-restart/driver.ts` runs its `shutdown-while-cancelling`
 * restart. Before it, a parent takes one turn, starts a continuable child
 * whose first request the scripted model holds open, cancels the child, and
 * disposes the tree while the cancelled request is still ending. After it, the
 * same working directory boots again, the parent is resumed, the child is sent
 * one prompt, and the user speaks to the parent. The cases read the parent's
 * log, which holds what both processes wrote to it. `P5_10_TRACE_SHUTDOWN=0`
 * leaves out the driver's trace of the continuation registry's private
 * members, which a fix may rename.
 *
 * The last case is BLOCKED-333's second half: a stop the parent is never told
 * of must at least be reported where an operator can see it. It accepts a line
 * that names the child and states that its settlement or stop notice was not
 * written, on either phase's stderr or in any text file the run left in its
 * working directory (a log file, or a session event in `./.sessions`). Prompt
 * text a session records in its `system/message` and `request/header` events
 * is not a report.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p5-10-restart/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p5-10-restart/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for the restart: two phase processes of at most two minutes each. */
const RESTART_TIMEOUT_MS = 300_000

/** The notice a parent gets for a child stopped before it finished. */
const STOPPED = /was stopped before it finished\./u

/** A settlement or stop notice named first, then said not to have been written. */
const WRITE_FAILED = /\b(?:settlement|stop notice|stopped notice)\b.{0,160}?\b(?:not (?:be )?(?:committed|written|recorded|stored|delivered)|(?:could not|cannot|failed to) (?:commit|write|record|store|deliver)|lost)\b/iu
/** The same statement with the failure first. */
const WRITE_FAILED_FIRST = /\b(?:could not|cannot|failed to) (?:commit|write|record|store|deliver)\b.{0,160}?\b(?:settlement|stop notice|stopped notice)\b/iu

/** Largest file the working-directory scan reads. */
const SCAN_LIMIT_BYTES = 8 * 1024 * 1024

/** One line the run left, and where. */
interface ScannedLine {
  /** The file's path relative to the working directory, or which phase's stderr. */
  readonly path: string
  readonly line: string
  /** Whether the line is a session log's `system/message` or `request/header` event, which holds prompt text. */
  readonly prompt: boolean
}

/** One user message in the parent's log, as the driver reports it. */
interface LoggedMessage {
  readonly source: string
  readonly sender: string | null
  readonly text: string
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly before: {
    readonly reading: {
      readonly ids: { readonly parent: string; readonly child: string }
      readonly interrupt: { readonly accepted?: unknown }
      readonly childLive: boolean
      readonly child: { readonly turnEnds: number }
    }
  }
  readonly after: {
    readonly reading: {
      readonly afterResume: { readonly parentLog: readonly LoggedMessage[] | null }
      readonly parentLog: readonly LoggedMessage[] | null
    }
  }
  readonly stderrSettlementLines: { readonly before: readonly string[]; readonly after: readonly string[] }
}

/**
 * Every line that mentions a settlement in the text files under a directory.
 * Files holding a NUL byte (a SQLite store) and files over
 * {@link SCAN_LIMIT_BYTES} are skipped. A `.jsonl` line holding the value
 * `"system/message"` or `"request/header"` is marked as prompt text; the match
 * is on the value, so it does not depend on the log's field names.
 * @param root - the run's working directory.
 * @returns the lines, each with its file's path relative to `root`.
 */
async function settlementLinesUnder(root: string): Promise<ScannedLine[]> {
  const lines: ScannedLine[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if ((await stat(path)).size > SCAN_LIMIT_BYTES) continue
    const content = await readFile(path)
    if (content.includes(0)) continue
    const log = path.endsWith('.jsonl')
    for (const line of content.toString('utf8').split('\n')) {
      if (!/settle/iu.test(line)) continue
      const prompt = log && (line.includes('"system/message"') || line.includes('"request/header"'))
      lines.push({ path: relative(root, path), line, prompt })
    }
  }
  return lines
}

/**
 * Whether a line states that a settlement or stop notice was not written.
 * @param line - one line the run left.
 * @returns whether either wording of that statement matches.
 */
function statesWriteFailure(line: string): boolean {
  return WRITE_FAILED.test(line) || WRITE_FAILED_FIRST.test(line)
}

/**
 * The settlement notices a log holds from one child, in log order.
 * @param log - the parent's logged user messages.
 * @param child - the child's session id.
 * @returns the notices whose sender is that child.
 */
function settlementsFrom(log: readonly LoggedMessage[] | null, child: string): readonly LoggedMessage[] {
  return (log ?? []).filter(message => message.source === 'subagent-settled' && message.sender === child)
}

describe('BLOCKED-333: a child still cancelling when the host shuts down gracefully is reported to its parent as stopped, on the shipped headless profile', () => {
  const reports: Report[] = []
  const fileLines: ScannedLine[] = []
  beforeAll(async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-333 observation: shutdown while cancelling',
      tempDirPrefix: 'p5-10-shutdown-while-cancelling-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [overlay, 'orchestrate', 'shutdown-while-cancelling'],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: RESTART_TIMEOUT_MS,
      env: { P5_10_TRACE_SHUTDOWN: '0' },
      inspect: async (cwd) => { fileLines.push(...await settlementLinesUnder(cwd)) },
    })
    const json = /P5-10-RESTART (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    reports.push(JSON.parse(json) as Report)
  }, RESTART_TIMEOUT_MS + 15_000)

  it('control: the host shuts down while the cancelled child is still resident, and the parent log read after the restart holds what both processes wrote', () => {
    const before = reports[0]?.before.reading
    expect(before?.interrupt.accepted).toBe(true)
    expect(before?.childLive).toBe(true)
    expect(before?.child.turnEnds).toBe(0)
    const log = reports[0]?.after.reading.parentLog ?? []
    expect(log.some(message => message.text.includes('the parent takes one turn before it starts a child')), JSON.stringify(log)).toBe(true)
  })

  it('the parent log holds the stop notice for the child exactly once', () => {
    const log = reports[0]?.after.reading.parentLog ?? null
    const stops = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '').filter(message => STOPPED.test(message.text))
    expect(stops, JSON.stringify(log)).toHaveLength(1)
  })

  it('the stop notice is in the parent log by the time the parent is resumed', () => {
    const log = reports[0]?.after.reading.afterResume.parentLog ?? null
    const stops = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '').filter(message => STOPPED.test(message.text))
    expect(stops.length, JSON.stringify(log)).toBeGreaterThan(0)
  })

  it('a later turn of the child does not reach the parent before the stop notice', () => {
    const log = reports[0]?.after.reading.parentLog ?? null
    const first = settlementsFrom(log, reports[0]?.before.reading.ids.child ?? '')[0]
    expect(first?.text ?? '(no settlement notice from the child)', JSON.stringify(log)).toMatch(STOPPED)
  })

  it('the stop is never lost silently: the parent log holds the stop notice, or a line on stderr, in a log file or in a session event names the child and says its settlement failed', ({ task }) => {
    const child = reports[0]?.before.reading.ids.child ?? '(no child id)'
    const noticed = settlementsFrom(reports[0]?.after.reading.parentLog ?? null, child).some(message => STOPPED.test(message.text))
    const lines = reports[0]?.stderrSettlementLines
    const candidates: ScannedLine[] = [
      ...(lines?.before ?? []).map(line => ({ path: 'stderr before', line, prompt: false })),
      ...(lines?.after ?? []).map(line => ({ path: 'stderr after', line, prompt: false })),
      ...fileLines,
    ].filter(candidate => candidate.line.includes(child))
    const failures = candidates.filter(candidate => !candidate.prompt && statesWriteFailure(candidate.line))
    /**
     * One scanned line as the task records it.
     * @param candidate - the line.
     * @returns its path and its first 600 characters.
     */
    const recorded = (candidate: ScannedLine): { readonly path: string; readonly line: string } =>
      ({ path: candidate.path, line: candidate.line.slice(0, 600) })
    // Recorded on the task, which the JSON reporter carries, so a pass shows what satisfied it.
    Object.assign(task.meta, {
      a389c: {
        noticed,
        reported: failures.map(recorded),
        excluded: candidates.filter(candidate => candidate.prompt).length,
        candidates: candidates.map(recorded),
      },
    })
    expect(noticed || failures.length > 0, JSON.stringify({ noticed, reported: failures.map(recorded) })).toBe(true)
  })
})
