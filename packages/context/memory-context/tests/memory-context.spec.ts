/**
 * Real-composition regression for the Memory seam's Usage stage (first100
 * registry P6-01): the shipped headless profile is booted through the Loader
 * with the base bundle's `memory` and `memory-context` rows enabled, one
 * record is seeded through the composed `ctx.memory`, and one turn is driven.
 * Every assertion below reads the durable JSONL session log the run left
 * behind — never an in-process spy — so what is proven is what a later reader
 * of that log can reconstruct.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/memory-context.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The content the driver seeds into memory before the turn runs. */
const SEEDED = 'oxidized-kingfisher'

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

let events: SessionEvent[] = []
let stderr = ''

describe('memory-context through the production headless profile', () => {
  beforeAll(async () => {
    const result = await runLoaderSmoke({
      label: 'memory-context headless smoke',
      tempDirPrefix: 'memory-context-smoke-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    stderr = result.stderr
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('boots the shipped profile with the base bundle memory rows enabled and no unhandled failure', () => {
    expect(stderr).not.toContain('UNHANDLED')
    expect(stderr).not.toContain('MEMORY_PROVIDER_UNAVAILABLE')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('memory/access is a known session event type, so a real log carrying it replays', () => {
    // Registration must precede emission: a log holding an unregistered,
    // non-ignorable type is refused wholesale by the persistence read path.
    expect(KNOWN_SESSION_EVENT_TYPES.has('memory/access')).toBe(true)
  })

  it('recalled memory reaches the model as a durable, source-attributed user message', () => {
    const injected = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'memory-context')
    expect(injected).toHaveLength(1)
    expect(injected[0]!.surfaceOp).toBe('append')
    expect(injected[0]!.data.source).toMatchObject({
      kind: 'plugin',
      plugin: 'memory-context',
      form: 'snapshot',
      sections: [{ name: 'memory-context' }],
    })
    const text = injected[0]!.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(text).toContain(SEEDED)
  })

  it('the same run records a memory/access read event carrying the complete access context', () => {
    const reads = events.filter(
      (event): event is SessionEvent<'memory/access'> => event.type === 'memory/access'
        && event.data.operation === 'query')
    expect(reads).toHaveLength(1)
    const data = reads[0]!.data
    expect(data.operation).toBe('query')
    if (data.operation !== 'query') throw new Error('unreachable: filtered to query above')
    // must[3]: all four read-scoping dimensions are on the record, not merely
    // checked in memory and then discarded.
    expect(data.accessContext.principal).toMatchObject({ tenantId: 't-fixture' })
    expect(data.accessContext.purpose).toBe('recall')
    expect(data.accessContext.scope).toMatchObject({ tenantId: 't-fixture' })
    expect(data.accessContext.contextBudget).toMatchObject({ maxRecords: 5 })
    expect(data.resultCount).toBe(1)
  })

  it('model-visible memory is logged: every recalled record the model saw is reconstructable from the log alone', () => {
    // registry P6-01 validation[3], asserted as a property over one durable
    // log rather than by observing the emitter: the injection and its read
    // event must both be present, and the read event must precede the text
    // the model read.
    const injected = events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'memory-context')
    const read = events.find(event => event.type === 'memory/access')
    expect(injected).toBeDefined()
    expect(read).toBeDefined()
    expect(read!.seq).toBeLessThan(injected!.seq)
  })

  it('memory content never reaches the model outside a logged injection', () => {
    // acceptance[1]'s read-side counterpart: the seeded content appears in the
    // request only through the attributed user message above.
    const headers = events.filter(event => event.type === 'request/header')
    expect(JSON.stringify(headers)).not.toContain(SEEDED)
  })
})
