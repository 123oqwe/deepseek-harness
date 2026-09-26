/**
 * A-463 under P5-10 must[2] (「所有 control message 持久、带 epoch、幂等。」) and
 * acceptance[0] (「取消时同发 steer/continue,不唤醒已取消的子 agent。」) across a
 * host restart, on the shipped headless composition: a continuable child
 * interrupted before the host stops is not woken by a prompt after the
 * restart, and the interrupt, with an epoch, is readable in the child's log
 * after the restart.
 *
 * `./loader/p5-10-restart/driver.ts` runs its `graceful` and `crash`
 * restarts. Before each, a parent takes one turn, starts a continuable child
 * whose first request the scripted model holds open, and cancels it through
 * `interruptByParent`; `graceful` then waits for the child to stop, sends it
 * one prompt and disposes the tree, and `crash` kills its process. After each,
 * the same working directory boots again, the parent is resumed and the child
 * is sent one prompt. The cases read the driver's report and the session logs
 * the run left in its working directory.
 *
 * An interrupt record is an event in the child's log, other than `turn/end`
 * (session repair closes an open turn with reason `interrupted`) and prompt
 * text, whose type or a `kind` in it names an interrupt and which carries a
 * finite number under `epoch` or a key ending in `Epoch`.
 * @module tests/first100/fixtures/P5-10.interrupt-across-restart.composition
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p5-10-restart/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p5-10-restart/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for one restart: two phase processes of at most two minutes each, and the crash restart's wait. */
const RESTART_TIMEOUT_MS = 300_000

/** Largest session log the working-directory scan reads. */
const SCAN_LIMIT_BYTES = 8 * 1024 * 1024

/** Event types that are never an interrupt record: a turn's close, and prompt text. */
const NOT_A_RECORD: ReadonlySet<string> = new Set(['turn/end', 'system/message', 'request/header'])

/** The two restarts these cases run. */
type Variant = 'graceful' | 'crash'

/** How the driver reports one prompt. */
interface Outcome {
  readonly delivered?: string
  readonly refused?: string
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly before: {
    readonly reading: {
      readonly ids: { readonly parent: string; readonly child: string }
      readonly interrupt: { readonly accepted?: unknown; readonly error?: unknown }
      readonly outcome?: Outcome
    }
  }
  readonly after: {
    readonly reading: {
      readonly afterPrompt: { readonly outcome: Outcome; readonly child: { readonly turnStarts: number } }
    }
  }
}

/** One session event as a log row holds it. */
type RowEvent = Readonly<Record<string, unknown>> & { readonly type: string }

/** One event found in a session log the run left, with the log's path relative to the working directory. */
interface LoggedEvent {
  readonly path: string
  readonly event: RowEvent
}

/** What one restart left: the driver's report and every event in the run's session logs. */
interface Run {
  readonly report: Report
  readonly events: readonly LoggedEvent[]
}

const runs = new Map<Variant, Run>()
const failures = new Map<Variant, string>()

/**
 * Whether a value is a plain object.
 * @param value - the value.
 * @returns whether it is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is a session event: an object whose `type` names one, as every session event type holds a `/`.
 * @param value - the value.
 * @returns whether it is an event.
 */
function isEvent(value: unknown): value is RowEvent {
  return isRecord(value) && typeof value.type === 'string' && value.type.includes('/')
}

/**
 * Every event at any depth of one parsed log row, so a packed row's events are found too.
 * @param value - the parsed row.
 * @returns the events, outermost first.
 */
function eventsIn(value: unknown): RowEvent[] {
  if (Array.isArray(value)) return value.flatMap(eventsIn)
  if (!isRecord(value)) return []
  return [...isEvent(value) ? [value] : [], ...Object.values(value).flatMap(eventsIn)]
}

/**
 * Every key and value inside one event, not descending into an event nested in it.
 * @param value - the event, or a value inside it.
 * @param top - whether `value` is the event itself.
 * @returns the pairs.
 */
function pairsOf(value: unknown, top: boolean): (readonly [string, unknown])[] {
  if (Array.isArray(value)) return value.flatMap(item => pairsOf(item, false))
  if (!isRecord(value) || (!top && isEvent(value))) return []
  return Object.entries(value).flatMap(([key, inner]) => [[key, inner] as const, ...pairsOf(inner, false)])
}

/**
 * Whether one event records an interrupt with an epoch, as this file's header defines it.
 * @param event - the event.
 * @returns whether it is an interrupt record.
 */
function isInterruptRecord(event: RowEvent): boolean {
  if (NOT_A_RECORD.has(event.type)) return false
  const pairs = pairsOf(event, true)
  const named = /interrupt/iu.test(event.type) || pairs.some(([key, inner]) => key === 'kind' && typeof inner === 'string' && /interrupt/iu.test(inner))
  const epoch = pairs.some(([key, inner]) => (key === 'epoch' || key.endsWith('Epoch')) && typeof inner === 'number' && Number.isFinite(inner))
  return named && epoch
}

/**
 * Every event in the `.jsonl` session logs under a directory. Logs over {@link SCAN_LIMIT_BYTES} are skipped.
 * @param root - the run's working directory.
 * @returns the events, each with its log's path relative to `root`.
 */
async function loggedEventsUnder(root: string): Promise<LoggedEvent[]> {
  const found: LoggedEvent[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const path = join(entry.parentPath, entry.name)
    if ((await stat(path)).size > SCAN_LIMIT_BYTES) continue
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      if (line.trim().length === 0) continue
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        // A torn last line of a killed process's log is not an event; nothing else in a session log fails to parse.
        continue
      }
      for (const event of eventsIn(row)) found.push({ path: relative(root, path), event })
    }
  }
  return found
}

/**
 * Run one restart through the driver.
 * @param variant - the restart.
 */
async function runRestart(variant: Variant): Promise<void> {
  try {
    const events: LoggedEvent[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: `A-463 interrupt across a ${variant} restart`,
      tempDirPrefix: `p5-10-interrupt-${variant}-`,
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [overlay, 'orchestrate', variant],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: RESTART_TIMEOUT_MS,
      inspect: async (cwd) => { events.push(...await loggedEventsUnder(cwd)) },
    })
    const json = /P5-10-RESTART (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    runs.set(variant, { report: JSON.parse(json) as Report, events })
  } catch (error: unknown) {
    failures.set(variant, error instanceof Error ? error.message : String(error))
  }
}

/**
 * One restart's run, or the reason there is none.
 * @param variant - the restart.
 * @returns the run.
 */
function runOf(variant: Variant): Run {
  const run = runs.get(variant)
  if (run === undefined) throw new Error(failures.get(variant) ?? `no run for the ${variant} restart`)
  return run
}

/**
 * The events in the child's own session logs: the logs one of whose path segments is the child's session id.
 * @param variant - the restart.
 * @returns the child's events.
 */
function childEvents(variant: Variant): RowEvent[] {
  const { report, events } = runOf(variant)
  const child = report.before.reading.ids.child
  return events.filter(logged => logged.path.split(sep).includes(child)).map(logged => logged.event)
}

/**
 * What the prompt after the restart did to the child.
 * @param variant - the restart.
 * @returns whether it was refused or delivered, and how many turns the child started after the restart.
 */
function afterRestart(variant: Variant): { readonly outcome: string; readonly childTurnStarts: number } {
  const { afterPrompt } = runOf(variant).report.after.reading
  return { outcome: afterPrompt.outcome.refused === undefined ? 'delivered' : 'refused', childTurnStarts: afterPrompt.child.turnStarts }
}

/**
 * Check that the child's log, read after the restart, holds an interrupt record, and record what it holds on the task.
 * @param variant - the restart.
 * @param meta - the task's meta, which the JSON reporter carries.
 */
function expectInterruptRecord(variant: Variant, meta: object): void {
  const events = childEvents(variant)
  const records = events.filter(isInterruptRecord)
  const childEventTypes = [...new Set(events.map(event => event.type))]
  Object.assign(meta, { a463: { variant, childEventTypes, records: records.slice(0, 5) } })
  expect(records.length, JSON.stringify({ childEventTypes })).toBeGreaterThan(0)
}

describe('P5-10 A-463: a child interrupted before a graceful host restart, on the shipped headless profile', () => {
  beforeAll(() => runRestart('graceful'), RESTART_TIMEOUT_MS + 15_000)

  it('control: the interrupt is accepted, a prompt sent after it is refused before the restart, and the child\'s log read afterwards holds its turn', () => {
    const { reading } = runOf('graceful').report.before
    expect({
      accepted: reading.interrupt.accepted,
      refusedBeforeRestart: reading.outcome?.refused !== undefined,
      childTurnInLog: childEvents('graceful').some(event => event.type === 'turn/start'),
    }, JSON.stringify(reading)).toEqual({ accepted: true, refusedBeforeRestart: true, childTurnInLog: true })
  })

  it('a prompt after the restart does not wake the interrupted child', () => {
    expect(afterRestart('graceful'), JSON.stringify(runOf('graceful').report.after.reading.afterPrompt)).toEqual({ outcome: 'refused', childTurnStarts: 0 })
  })

  it('the interrupt, with an epoch, is readable in the child\'s log after the restart', ({ task }) => {
    expectInterruptRecord('graceful', task.meta)
  })
})

describe('P5-10 A-463: a child interrupted before its host crashes, on the shipped headless profile', () => {
  beforeAll(() => runRestart('crash'), RESTART_TIMEOUT_MS + 15_000)

  it('control: the interrupt is accepted, and the child\'s log read after the restart holds its turn', () => {
    const { reading } = runOf('crash').report.before
    expect({
      accepted: reading.interrupt.accepted,
      childTurnInLog: childEvents('crash').some(event => event.type === 'turn/start'),
    }, JSON.stringify(reading)).toEqual({ accepted: true, childTurnInLog: true })
  })

  it('a prompt after the restart does not wake the interrupted child', () => {
    expect(afterRestart('crash'), JSON.stringify(runOf('crash').report.after.reading.afterPrompt)).toEqual({ outcome: 'refused', childTurnStarts: 0 })
  })

  it('the interrupt, with an epoch, is readable in the child\'s log after the restart', ({ task }) => {
    expectInterruptRecord('crash', task.meta)
  })
})
